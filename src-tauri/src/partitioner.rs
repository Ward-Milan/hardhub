use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApfsVolumeItem {
    pub bsd_name: String,
    pub name: String,
    pub mount_point: String,
    pub role: String,
    pub capacity_consumed_bytes: u64,
    pub is_encrypted: bool,
    pub is_system_locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApfsContainerInfo {
    pub container_id: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub free_bytes: u64,
    pub physical_store: String,
    pub is_internal: bool,
    pub volumes: Vec<ApfsVolumeItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddVolumeRequest {
    pub container_id: String,
    pub volume_name: String,
    pub volume_format: String, // "APFS" | "APFS_CASE_SENSITIVE"
    pub role_type: String,     // "standard" | "backup"
    pub quota_gb: Option<u64>,
    pub reserve_gb: Option<u64>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitPartitionRequest {
    pub parent_disk: String, // e.g. "disk4"
    pub is_removable: bool,
    pub partition1_name: String,
    pub partition1_fs: String, // "APFS" | "ExFAT"
    pub partition1_pct: u32,
    pub partition2_name: String,
    pub partition2_fs: String, // "ExFAT" | "APFS"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartitionActionResult {
    pub success: bool,
    pub message: String,
}

pub fn parse_apfs_containers_text(output: &str) -> Vec<ApfsContainerInfo> {
    let mut containers = Vec::new();

    let mut current_container: Option<ApfsContainerInfo> = None;
    let mut current_volume: Option<ApfsVolumeItem> = None;

    for raw_line in output.lines() {
        let line = raw_line.trim();

        // Check container header
        if line.starts_with("+-- Container ") || line.starts_with("APFS Container Reference:") {
            if let Some(vol) = current_volume.take() {
                if let Some(ref mut c) = current_container {
                    c.volumes.push(vol);
                }
            }
            if let Some(c) = current_container.take() {
                containers.push(c);
            }

            let id = if line.starts_with("+-- Container ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                parts.get(2).unwrap_or(&"").to_string()
            } else {
                line.trim_start_matches("APFS Container Reference:")
                    .trim()
                    .to_string()
            };

            current_container = Some(ApfsContainerInfo {
                container_id: id,
                total_bytes: 0,
                used_bytes: 0,
                free_bytes: 0,
                physical_store: String::new(),
                is_internal: true,
                volumes: Vec::new(),
            });
            continue;
        }

        // Inside container metadata
        if let Some(ref mut c) = current_container {
            if line.starts_with("Size (Capacity Ceiling):") {
                c.total_bytes = parse_byte_number(line);
            } else if line.starts_with("Capacity In Use By Volumes:") {
                c.used_bytes = parse_byte_number(line);
            } else if line.starts_with("Capacity Not Allocated:") {
                c.free_bytes = parse_byte_number(line);
            } else if line.starts_with("APFS Physical Store Disk:") {
                let store = line
                    .trim_start_matches("APFS Physical Store Disk:")
                    .trim()
                    .to_string();
                c.is_internal = true;
                c.physical_store = store;
            }

            // Volume header: "+-> Volume disk3s1"
            if line.starts_with("+-> Volume ") {
                if let Some(vol) = current_volume.take() {
                    c.volumes.push(vol);
                }

                let parts: Vec<&str> = line.split_whitespace().collect();
                let bsd_name = parts.get(2).unwrap_or(&"").to_string();

                current_volume = Some(ApfsVolumeItem {
                    bsd_name,
                    name: String::new(),
                    mount_point: "Non monté".to_string(),
                    role: "Standard".to_string(),
                    capacity_consumed_bytes: 0,
                    is_encrypted: false,
                    is_system_locked: false,
                });
                continue;
            }

            // Inside volume metadata
            if let Some(ref mut v) = current_volume {
                if line.starts_with("APFS Volume Disk (Role):") {
                    let sub = line.trim_start_matches("APFS Volume Disk (Role):").trim();
                    if let Some(paren_idx) = sub.find('(') {
                        v.role = sub[paren_idx + 1..].trim_end_matches(')').trim().to_string();
                    }
                } else if line.starts_with("Name:") {
                    let raw_name = line.trim_start_matches("Name:").trim();
                    v.name = if let Some(idx) = raw_name.find('(') {
                        raw_name[..idx].trim().to_string()
                    } else {
                        raw_name.to_string()
                    };
                } else if line.starts_with("Mount Point:") {
                    v.mount_point = line.trim_start_matches("Mount Point:").trim().to_string();
                } else if line.starts_with("Snapshot Mount Point:") {
                    if v.mount_point == "Non monté" || v.mount_point == "Not Mounted" {
                        v.mount_point = line.trim_start_matches("Snapshot Mount Point:").trim().to_string();
                    }
                } else if line.starts_with("Capacity Consumed:") {
                    v.capacity_consumed_bytes = parse_byte_number(line);
                } else if line.starts_with("FileVault:") || line.starts_with("Encrypted:") {
                    if line.contains("Yes") {
                        v.is_encrypted = true;
                    }
                }
            }
        }
    }

    if let Some(vol) = current_volume.take() {
        if let Some(ref mut c) = current_container {
            c.volumes.push(vol);
        }
    }
    if let Some(c) = current_container.take() {
        containers.push(c);
    }

    // Apply system lock detection on volumes
    for c in &mut containers {
        for v in &mut c.volumes {
            let bsd = &v.bsd_name;
            let mp = &v.mount_point;
            let r = v.role.to_lowercase();

            v.is_system_locked = mp == "/"
                || mp.starts_with("/System")
                || r == "system"
                || r == "preboot"
                || r == "recovery"
                || r == "vm"
                || (c.container_id == "disk3" && (bsd == "disk3s1" || bsd == "disk3s5"));
        }
    }

    containers
}

fn parse_byte_number(line: &str) -> u64 {
    let mut num_str = String::new();
    let mut found_digit = false;
    for c in line.chars() {
        if c.is_ascii_digit() {
            num_str.push(c);
            found_digit = true;
        } else if found_digit {
            break;
        }
    }
    num_str.parse::<u64>().unwrap_or(0)
}

pub fn list_apfs_containers() -> Result<Vec<ApfsContainerInfo>, String> {
    let output = Command::new("/usr/sbin/diskutil")
        .args(["apfs", "list"])
        .output()
        .map_err(|e| format!("Erreur exécution diskutil: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut containers = parse_apfs_containers_text(&stdout);
    for c in &mut containers {
        let probe = if !c.physical_store.is_empty() {
            c.physical_store.as_str()
        } else {
            c.container_id.as_str()
        };
        c.is_internal = crate::drives::is_bsd_disk_internal_or_system(probe).unwrap_or(true);
    }
    Ok(containers)
}

pub fn add_apfs_volume(req: AddVolumeRequest) -> Result<PartitionActionResult, String> {
    if !crate::drives::is_valid_bsd_name(&req.container_id) {
        return Err("Identifiant de conteneur APFS invalide.".to_string());
    }

    let clean_name: String = req
        .volume_name
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-' || *c == ' ')
        .take(24)
        .collect();

    if clean_name.is_empty() {
        return Err("Veuillez saisir un nom de volume valide.".to_string());
    }

    let fs_arg = match req.volume_format.as_str() {
        "APFS_CASE_SENSITIVE" => "APFSX",
        _ => "APFS",
    };

    let mut cmd = Command::new("/usr/sbin/diskutil");
    cmd.args(["apfs", "addVolume", &req.container_id, fs_arg, &clean_name]);

    if req.role_type == "backup" {
        cmd.args(["-role", "T"]);
    }

    if let Some(quota) = req.quota_gb {
        if quota > 0 {
            cmd.args(["-quota", &format!("{}g", quota)]);
        }
    }

    if let Some(reserve) = req.reserve_gb {
        if reserve > 0 {
            cmd.args(["-reserve", &format!("{}g", reserve)]);
        }
    }

    let clean_pwd = req
        .passphrase
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(str::to_string);

    let output = if let Some(pwd) = clean_pwd {
        cmd.arg("-stdinpassphrase")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Impossible de démarrer diskutil: {}", e))?;
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(pwd.as_bytes());
            let _ = stdin.write_all(b"\n");
        }
        child
            .wait_with_output()
            .map_err(|e| format!("Erreur diskutil: {}", e))?
    } else {
        cmd.output().map_err(|e| format!("Erreur diskutil: {}", e))?
    };

    if output.status.success() {
        Ok(PartitionActionResult {
            success: true,
            message: format!(
                "Volume partagé « {} » créé avec succès dans le conteneur {}.",
                clean_name, req.container_id
            ),
        })
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        let raw_err = err.trim();
        if raw_err.contains("-69464") || raw_err.to_ascii_lowercase().contains("restricted by sandbox") {
            return Err(format!(
                "Autorisation macOS requise (-69464) : activez HardHub dans Réglages Système > Confidentialité et sécurité > Accès complet au disque et Fichiers et dossiers, puis relancez HardHub. ({})",
                raw_err
            ));
        }
        Err(format!("Échec de création du volume APFS : {}", raw_err))
    }
}

pub fn delete_apfs_volume(bsd_name: &str, mount_point: &str) -> Result<PartitionActionResult, String> {
    if !crate::drives::is_valid_bsd_name(bsd_name) {
        return Err("Identifiant de volume APFS invalide.".to_string());
    }
    if mount_point == "/" || mount_point.starts_with("/System") {
        return Err("Sécurité macOS : impossible de supprimer le volume système actif.".to_string());
    }

    if let Ok(info_out) = Command::new("/usr/sbin/diskutil")
        .args(["info", bsd_name])
        .output()
    {
        let info_text = String::from_utf8_lossy(&info_out.stdout);
        for line in info_text.lines() {
            let trimmed = line.trim();
            if let Some((k, v)) = trimmed.split_once(':') {
                let key = k.trim();
                let val = v.trim();
                if key == "Mount Point" && (val == "/" || val.starts_with("/System")) {
                    return Err("Sécurité macOS : suppression refusée sur un volume système.".to_string());
                }
                if key.contains("Role") {
                    let role_lower = val.to_ascii_lowercase();
                    if role_lower.contains("system")
                        || role_lower.contains("preboot")
                        || role_lower.contains("recovery")
                        || role_lower.contains("vm")
                        || role_lower.contains("data")
                    {
                        return Err(format!(
                            "Sécurité macOS : le volume {} possède le rôle système protégé ({}).",
                            bsd_name, val
                        ));
                    }
                }
            }
        }
    }

    let output = Command::new("/usr/sbin/diskutil")
        .args(["apfs", "deleteVolume", bsd_name])
        .output()
        .map_err(|e| format!("Erreur diskutil: {}", e))?;

    if output.status.success() {
        Ok(PartitionActionResult {
            success: true,
            message: format!("Volume APFS {} supprimé. L'espace a été restitué au conteneur partagé.", bsd_name),
        })
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        let raw_err = err.trim();
        if raw_err.contains("-69464") || raw_err.to_ascii_lowercase().contains("restricted by sandbox") {
            return Err(format!(
                "Autorisation macOS requise (-69464) : activez HardHub dans Réglages Système > Confidentialité et sécurité > Accès complet au disque et Fichiers et dossiers, puis relancez HardHub. ({})",
                raw_err
            ));
        }
        Err(format!("Échec de suppression du volume : {}", raw_err))
    }
}

pub fn split_dual_partition(req: SplitPartitionRequest) -> Result<PartitionActionResult, String> {
    if !req.is_removable {
        return Err("Sécurité HardHub : le partitionnement hybride est strictement réservé aux disques externes.".to_string());
    }

    let raw_dev = req.parent_disk.trim().trim_start_matches("/dev/");
    let resolved_dev = crate::drives::resolve_physical_whole_disk(raw_dev)
        .unwrap_or_else(|| crate::drives::extract_base_whole_disk(raw_dev));
    let base_dev = resolved_dev.as_str();

    if !crate::drives::is_valid_bsd_name(base_dev) {
        return Err("Identifiant de disque parent invalide.".to_string());
    }
    if crate::drives::is_bsd_disk_internal_or_system(base_dev)? {
        return Err("Sécurité : partitionnement refusé sur le disque interne ou non vérifié.".to_string());
    }

    let p1_pct = req.partition1_pct.clamp(10, 90);
    let p2_pct = 100 - p1_pct;

    let p1_fs = match req.partition1_fs.to_uppercase().as_str() {
        "EXFAT" => "ExFAT",
        _ => "APFS",
    };
    let p2_fs = match req.partition2_fs.to_uppercase().as_str() {
        "EXFAT" => "ExFAT",
        _ => "APFS",
    };

    let clean_vol_name = |raw: &str, fallback: &str| -> String {
        let cleaned: String = raw
            .trim()
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-' || *c == ' ')
            .take(24)
            .collect();
        let trimmed = cleaned.trim_start_matches('-').trim();
        if trimmed.is_empty() {
            fallback.to_string()
        } else {
            trimmed.to_string()
        }
    };

    let p1_name = clean_vol_name(&req.partition1_name, "Mac_Data");
    let p2_name = clean_vol_name(&req.partition2_name, "PC_CrossShared");

    let output = Command::new("/usr/sbin/diskutil")
        .args([
            "partitionDisk",
            &format!("/dev/{}", base_dev),
            "GPT",
            p1_fs,
            &p1_name,
            &format!("{}%", p1_pct),
            p2_fs,
            &p2_name,
            &format!("{}%", p2_pct),
        ])
        .output()
        .map_err(|e| format!("Erreur diskutil: {}", e))?;

    if output.status.success() {
        Ok(PartitionActionResult {
            success: true,
            message: format!(
                "Disque partitionné en 2 volumes : {} ({}%) et {} ({}%).",
                p1_fs, p1_pct, p2_fs, p2_pct
            ),
        })
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        let out = String::from_utf8_lossy(&output.stdout);
        let raw_err = if !err.trim().is_empty() { err.trim() } else { out.trim() };
        if raw_err.contains("-69464") || raw_err.to_ascii_lowercase().contains("restricted by sandbox") {
            return Err(format!(
                "Autorisation macOS requise (-69464) : activez HardHub dans Réglages Système > Confidentialité et sécurité > Accès complet au disque et Fichiers et dossiers, puis relancez HardHub. ({})",
                raw_err
            ));
        }
        Err(format!("Échec du partitionnement : {}", raw_err))
    }
}

pub fn encrypt_apfs_volume(bsd_name: &str, passphrase: &str) -> Result<PartitionActionResult, String> {
    if passphrase.trim().len() < 4 {
        return Err("Le mot de passe de protection doit comporter au moins 4 caractères.".to_string());
    }

    let raw_bsd = bsd_name.trim().trim_start_matches("/dev/");
    if !crate::drives::is_valid_bsd_name(raw_bsd) {
        return Err("Identifiant de volume BSD invalide.".to_string());
    }
    if crate::drives::is_bsd_disk_internal_or_system(raw_bsd)? {
        return Err("Sécurité HardHub : impossible de chiffrer le disque système interne via cet outil.".to_string());
    }

    // Pass passphrase securely via stdin
    let mut child = Command::new("/usr/sbin/diskutil")
        .args(["apfs", "encryptVolume", raw_bsd, "-user", "disk", "-stdinpassphrase"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Impossible de démarrer diskutil: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        let _ = stdin.write_all(passphrase.as_bytes());
        let _ = stdin.write_all(b"\n");
    }

    let output = child.wait_with_output().map_err(|e| format!("Erreur diskutil: {}", e))?;

    if output.status.success() {
        Ok(PartitionActionResult {
            success: true,
            message: format!("Chiffrement APFS activé avec succès sur {}. Vos données sont protégées par mot de passe.", raw_bsd),
        })
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        let out = String::from_utf8_lossy(&output.stdout);
        let details = if !err.trim().is_empty() { err.trim() } else { out.trim() };
        if details.contains("-69464") || details.to_ascii_lowercase().contains("restricted by sandbox") {
            return Err(format!(
                "Autorisation macOS requise (-69464) : activez HardHub dans Réglages Système > Confidentialité et sécurité > Accès complet au disque et Fichiers et dossiers, puis relancez HardHub. ({})",
                details
            ));
        }
        Err(format!("Échec du chiffrement du volume : {}", details))
    }
}
