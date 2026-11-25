use serde::{Deserialize, Serialize};
use std::ffi::CString;
use std::process::Command;

#[repr(C)]
#[derive(Debug, Default, Clone, Copy)]
struct HardHubNvmeSmartResult {
    ok: i32,
    critical_warning: u8,
    temperature_kelvin: u16,
    available_spare: u8,
    available_spare_threshold: u8,
    percentage_used: u8,
    data_units_read_lo: u64,
    data_units_read_hi: u64,
    data_units_written_lo: u64,
    data_units_written_hi: u64,
    host_read_commands_lo: u64,
    host_write_commands_lo: u64,
    power_cycles_lo: u64,
    power_on_hours_lo: u64,
    unsafe_shutdowns_lo: u64,
    media_errors_lo: u64,
}

#[cfg(target_os = "macos")]
extern "C" {
    fn hardhub_read_nvme_smart(
        bsd_name: *const std::os::raw::c_char,
        out: *mut HardHubNvmeSmartResult,
    ) -> i32;
}

#[cfg(target_os = "macos")]
fn query_native_nvme_smart(base_disk: &str) -> Option<HardHubNvmeSmartResult> {
    let c_bsd = CString::new(base_disk).ok()?;
    let mut res = HardHubNvmeSmartResult::default();
    let rc = unsafe { hardhub_read_nvme_smart(c_bsd.as_ptr(), &mut res) };
    if rc == 0 && res.ok == 1 {
        Some(res)
    } else {
        None
    }
}

#[cfg(not(target_os = "macos"))]
fn query_native_nvme_smart(_base_disk: &str) -> Option<HardHubNvmeSmartResult> {
    None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SsdHealthReport {
    pub bsd_name: String,
    pub model_name: String,
    pub protocol: String,
    pub is_ssd: bool,
    pub total_bytes: u64,
    pub bytes_written: u64,
    pub bytes_read: u64,
    pub tbw_written: f64,
    pub tbr_read: f64,
    pub write_ops: u64,
    pub read_ops: u64,
    pub errors_count: u64,
    pub smart_status: String,
    pub health_percent: u32,
    pub rated_tbw: f64,
    pub temperature_celsius: Option<u32>,
    pub status_verdict: String,
    pub status_advice: String,
    /// `"lifetime_nvme_smart"` when read directly from hardware NVMe S.M.A.R.T. Log Page 02h,
    /// `"session_only"` when only macOS boot-session I/O counters are available, or `"unavailable"`.
    pub telemetry_scope: String,
    pub is_lifetime_telemetry: bool,
    pub percentage_used: Option<u32>,
    pub available_spare: Option<u32>,
    pub power_on_hours: Option<u64>,
    pub power_cycles: Option<u64>,
    pub unsafe_shutdowns: Option<u64>,
    pub critical_warning: Option<u8>,
}

pub fn get_disk_health(bsd_or_mount: &str) -> Result<SsdHealthReport, String> {
    let trimmed = bsd_or_mount.trim();
    if trimmed.is_empty() {
        return Err("Support cible invalide pour l'analyse S.M.A.R.T.".to_string());
    }

    // Resolve synthesized APFS volumes/containers or mount points down to the physical whole disk
    // (e.g. `/` or `disk3s1s1` -> `disk0`, `/Volumes/Lexar` or `disk6s2` -> `disk5`).
    let resolved_disk = crate::drives::resolve_physical_whole_disk(trimmed)
        .unwrap_or_else(|| crate::drives::extract_base_whole_disk(trimmed));
    let base_disk = resolved_disk.as_str();

    // 1. Query diskutil info on the physical whole disk
    let output = Command::new("/usr/sbin/diskutil")
        .args(["info", base_disk])
        .output()
        .map_err(|e| format!("Erreur exécution diskutil: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut model_name = "Disque".to_string();
    let mut protocol = "Inconnu".to_string();
    let mut smart_status = "Non supporté".to_string();
    let mut is_ssd = false;
    let mut total_bytes: u64 = 0;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Device / Media Name:") {
            model_name = trimmed
                .trim_start_matches("Device / Media Name:")
                .trim()
                .to_string();
        } else if trimmed.starts_with("Protocol:") {
            protocol = trimmed.trim_start_matches("Protocol:").trim().to_string();
        } else if trimmed.starts_with("SMART Status:") {
            smart_status = trimmed.trim_start_matches("SMART Status:").trim().to_string();
        } else if trimmed.starts_with("Solid State:") {
            is_ssd = trimmed
                .trim_start_matches("Solid State:")
                .trim()
                .eq_ignore_ascii_case("Yes");
        } else if trimmed.starts_with("Disk Size:") {
            total_bytes = parse_bytes_from_disk_size(trimmed);
        }
    }

    // Reference TBW endurance rating (decimal TB, standard SSD manufacturer scale):
    // ~150 TBW for 256GB, ~300 TBW for 512GB, ~600 TBW for 1TB, ~1200 TBW for 2TB
    let rated_tbw = if total_bytes >= 1_800_000_000_000 {
        1200.0
    } else if total_bytes >= 900_000_000_000 {
        600.0
    } else if total_bytes >= 450_000_000_000 {
        300.0
    } else {
        150.0
    };

    // 2. Primary source: real hardware NVMe S.M.A.R.T. Log Page 02h via Apple IOKit NVMeSMARTLib
    if let Some(nvme) = query_native_nvme_smart(base_disk) {
        // NVMe Spec: 1 Data Unit = 1,000 * 512 bytes = 512,000 bytes (cumulative lifetime since factory)
        let units_written =
            ((nvme.data_units_written_hi as u128) << 64) | (nvme.data_units_written_lo as u128);
        let units_read =
            ((nvme.data_units_read_hi as u128) << 64) | (nvme.data_units_read_lo as u128);

        let bytes_written_u128 = units_written.saturating_mul(512_000);
        let bytes_read_u128 = units_read.saturating_mul(512_000);

        let bytes_written = bytes_written_u128.min(u64::MAX as u128) as u64;
        let bytes_read = bytes_read_u128.min(u64::MAX as u128) as u64;

        // Decimal TB (10^12) matching smartctl and manufacturer TBW ratings
        let tbw_written = (bytes_written_u128 as f64) / 1_000_000_000_000.0;
        let tbr_read = (bytes_read_u128 as f64) / 1_000_000_000_000.0;

        let pct_used = nvme.percentage_used as u32;
        let health_percent = if smart_status.eq_ignore_ascii_case("Failing")
            || nvme.critical_warning != 0
        {
            100u32.saturating_sub(pct_used).min(15)
        } else {
            100u32.saturating_sub(pct_used)
        };

        let temperature_celsius = if (250..=410).contains(&nvme.temperature_kelvin) {
            Some((nvme.temperature_kelvin - 273) as u32)
        } else {
            None
        };

        let errors_count = nvme.media_errors_lo;

        let (status_verdict, status_advice) = if smart_status.eq_ignore_ascii_case("Failing")
            || nvme.critical_warning != 0
        {
            (
                "Critique (Alerte matérielle S.M.A.R.T.)".to_string(),
                "Le contrôleur NVMe signale un avertissement critique. Sauvegardez immédiatement ce disque.".to_string(),
            )
        } else if errors_count > 0 {
            (
                "À surveiller (Erreurs média NAND)".to_string(),
                "Le contrôleur NVMe a enregistré des erreurs d'intégrité média. Vérifiez vos sauvegardes régulièrement.".to_string(),
            )
        } else if health_percent >= 90 {
            (
                "Excellent (Usure usine minime)".to_string(),
                format!(
                    "Lecture directe S.M.A.R.T. NVMe : {} % d'usure consommée sur la durée de vie réelle du SSD ({} % de blocs de réserve disponibles).",
                    pct_used, nvme.available_spare
                ),
            )
        } else if health_percent >= 70 {
            (
                "Bon état opérationnel".to_string(),
                format!(
                    "Usure réelle rapportée par le contrôleur NVMe : {} % ({} % de réserve flash disponible).",
                    pct_used, nvme.available_spare
                ),
            )
        } else {
            (
                "Usure avancée".to_string(),
                format!(
                    "Le contrôleur NVMe indique {} % d'endurance consommée. Prévoyez un renouvellement ou renforcez vos sauvegardes.",
                    pct_used
                ),
            )
        };

        return Ok(SsdHealthReport {
            bsd_name: base_disk.to_string(),
            model_name,
            protocol,
            is_ssd: true,
            total_bytes,
            bytes_written,
            bytes_read,
            tbw_written: (tbw_written * 100.0).round() / 100.0,
            tbr_read: (tbr_read * 100.0).round() / 100.0,
            write_ops: nvme.host_write_commands_lo,
            read_ops: nvme.host_read_commands_lo,
            errors_count,
            smart_status,
            health_percent,
            rated_tbw,
            temperature_celsius,
            status_verdict,
            status_advice,
            telemetry_scope: "lifetime_nvme_smart".to_string(),
            is_lifetime_telemetry: true,
            percentage_used: Some(pct_used),
            available_spare: Some(nvme.available_spare as u32),
            power_on_hours: Some(nvme.power_on_hours_lo),
            power_cycles: Some(nvme.power_cycles_lo),
            unsafe_shutdowns: Some(nvme.unsafe_shutdowns_lo),
            critical_warning: Some(nvme.critical_warning),
        });
    }

    // 3. Fallback for USB bridges / SD readers without NVMe S.M.A.R.T. passthrough:
    // Query macOS IOBlockStorageDriver statistics (strictly boot-session counters — NEVER fake lifetime TBW!).
    let (bytes_written, bytes_read, write_ops, read_ops, errors_count) =
        query_ioreg_storage_stats(base_disk);

    let tbw_written = (bytes_written as f64) / 1_000_000_000_000.0;
    let tbr_read = (bytes_read as f64) / 1_000_000_000_000.0;

    let has_session_stats = bytes_written > 0 || bytes_read > 0 || write_ops > 0 || read_ops > 0;
    let telemetry_scope = if has_session_stats {
        "session_only".to_string()
    } else {
        "unavailable".to_string()
    };

    let health_percent = if smart_status.eq_ignore_ascii_case("Failing") {
        15
    } else {
        0
    };

    let (status_verdict, status_advice) = if smart_status.eq_ignore_ascii_case("Failing") {
        (
            "Critique (S.M.A.R.T. Défaillant)".to_string(),
            "Le contrôleur signale une défaillance matérielle imminente. Sauvegardez immédiatement ce support.".to_string(),
        )
    } else if errors_count > 0 {
        (
            "À surveiller (Erreurs I/O session)".to_string(),
            "Des erreurs de lecture/écriture ont été signalées par macOS depuis le branchement. Vérifiez le câble et sauvegardez vos données.".to_string(),
        )
    } else {
        (
            "Endurance usine non exposée par le pont USB / lecteur SD".to_string(),
            "macOS ne peut pas lire les compteurs S.M.A.R.T. à vie (TBW / usure) à travers ce pont USB ou lecteur SD sans pilote SAT spécifique. Seule l'activité de la session actuelle est visible.".to_string(),
        )
    };

    Ok(SsdHealthReport {
        bsd_name: base_disk.to_string(),
        model_name,
        protocol,
        is_ssd,
        total_bytes,
        bytes_written,
        bytes_read,
        tbw_written: (tbw_written * 100.0).round() / 100.0,
        tbr_read: (tbr_read * 100.0).round() / 100.0,
        write_ops,
        read_ops,
        errors_count,
        smart_status,
        health_percent,
        rated_tbw,
        temperature_celsius: None,
        status_verdict,
        status_advice,
        telemetry_scope,
        is_lifetime_telemetry: false,
        percentage_used: None,
        available_spare: None,
        power_on_hours: None,
        power_cycles: None,
        unsafe_shutdowns: None,
        critical_warning: None,
    })
}

fn parse_bytes_from_disk_size(line: &str) -> u64 {
    if let Some(start) = line.find('(') {
        let sub = &line[start + 1..];
        let mut digits = String::new();
        for c in sub.chars() {
            if c.is_ascii_digit() {
                digits.push(c);
            } else if !digits.is_empty() {
                break;
            }
        }
        digits.parse::<u64>().unwrap_or(0)
    } else {
        0
    }
}

fn query_ioreg_storage_stats(target_bsd: &str) -> (u64, u64, u64, u64, u64) {
    let output = Command::new("/usr/sbin/ioreg")
        .args(["-c", "IOBlockStorageDriver", "-r", "-l"])
        .output();

    let text = match output {
        Ok(out) => String::from_utf8_lossy(&out.stdout).to_string(),
        Err(_) => return (0, 0, 0, 0, 0),
    };

    let sections: Vec<&str> = text.split("+-o IOBlockStorageDriver").collect();
    for sec in sections.into_iter().skip(1) {
        if sec.contains(&format!("\"BSD Name\" = \"{}\"", target_bsd))
            || sec.contains(&format!("\"BSD Name\"=\"{}\"", target_bsd))
        {
            return parse_statistics_block(sec);
        }
    }

    (0, 0, 0, 0, 0)
}

fn parse_statistics_block(sec: &str) -> (u64, u64, u64, u64, u64) {
    let stat_idx = match sec.find("\"Statistics\" = {") {
        Some(idx) => idx,
        None => return (0, 0, 0, 0, 0),
    };

    let stat_sub = &sec[stat_idx..];
    let end_idx = match stat_sub.find('}') {
        Some(idx) => idx,
        None => return (0, 0, 0, 0, 0),
    };

    let body = &stat_sub[..end_idx];

    let bw = extract_stat_number(body, "\"Bytes (Write)\"=");
    let br = extract_stat_number(body, "\"Bytes (Read)\"=");
    let wo = extract_stat_number(body, "\"Operations (Write)\"=");
    let ro = extract_stat_number(body, "\"Operations (Read)\"=");
    let ew = extract_stat_number(body, "\"Errors (Write)\"=");
    let er = extract_stat_number(body, "\"Errors (Read)\"=");

    (bw, br, wo, ro, ew + er)
}

fn extract_stat_number(body: &str, key: &str) -> u64 {
    if let Some(idx) = body.find(key) {
        let start = idx + key.len();
        let sub = &body[start..];
        let mut num = String::new();
        for c in sub.chars() {
            if c.is_ascii_digit() {
                num.push(c);
            } else if !num.is_empty() {
                break;
            }
        }
        num.parse::<u64>().unwrap_or(0)
    } else {
        0
    }
}
