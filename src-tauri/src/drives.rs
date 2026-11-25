use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use sysinfo::Disks;

static USB_SPEEDS_CACHE: Mutex<Option<(Instant, HashMap<String, u32>)>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageDriveInfo {
    pub id: String,
    pub name: String,
    pub mount_point: String,
    pub bsd_name: String,
    pub file_system: String,
    pub device_type: String, // "internal_ssd" | "external_ssd" | "external_hdd" | "sd_card" | "cloud_drive"
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
    pub is_removable: bool,
    pub is_read_only: bool,
    pub is_cloud: bool,
    pub protocol: String,
    pub link_speed_label: String,
    pub link_speed_mbps: u32,
    pub is_cable_bottlenecked: bool,
    pub cable_warning: Option<String>,
    pub hidden_trash_bytes: u64,
    pub is_encrypted: bool,
    pub encryption_status: String,
    pub can_encrypt: bool,
}

#[derive(Debug, Clone)]
struct DiskutilMetadata {
    bsd_name: String,
    protocol: String,
    solid_state: bool,
    removable_media: bool,
    device_model: String,
    is_encrypted: bool,
    filevault_enabled: bool,
}

/// Parses `diskutil info <mount_point>` for accurate macOS hardware metadata.
fn query_diskutil_info(mount_point: &str) -> DiskutilMetadata {
    let mut meta = DiskutilMetadata {
        bsd_name: String::from("disk"),
        protocol: String::new(),
        solid_state: true,
        removable_media: mount_point != "/",
        device_model: String::new(),
        is_encrypted: false,
        filevault_enabled: false,
    };

    let output = Command::new("/usr/sbin/diskutil")
        .args(["info", mount_point])
        .output();

    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            let trimmed = line.trim();
            if let Some((k, v)) = trimmed.split_once(':') {
                let key = k.trim();
                let val = v.trim();
                match key {
                    "Device Identifier" => meta.bsd_name = val.to_string(),
                    "Protocol" => meta.protocol = val.to_string(),
                    "Solid State" => meta.solid_state = val.eq_ignore_ascii_case("Yes"),
                    "Removable Media" => {
                        if val.eq_ignore_ascii_case("Removable") || val.eq_ignore_ascii_case("Yes") {
                            meta.removable_media = true;
                        }
                    }
                    "Device / Media Name" | "Media Name" => {
                        if meta.device_model.is_empty() {
                            meta.device_model = val.to_string();
                        }
                    }
                    "Encrypted" => {
                        if val.eq_ignore_ascii_case("Yes") {
                            meta.is_encrypted = true;
                        }
                    }
                    "FileVault" => {
                        if val.eq_ignore_ascii_case("Yes") {
                            meta.filevault_enabled = true;
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    meta
}

/// Queries USB bus link speeds via `system_profiler SPUSBDataType` to detect USB 2.0 cable bottlenecks (cached 30s).
fn query_usb_bus_speeds() -> HashMap<String, u32> {
    if let Ok(guard) = USB_SPEEDS_CACHE.lock() {
        if let Some((cached_at, ref map)) = *guard {
            if cached_at.elapsed() < Duration::from_secs(30) {
                return map.clone();
            }
        }
    }

    let mut map = HashMap::new();
    let output = Command::new("/usr/sbin/system_profiler")
        .args(["SPUSBDataType", "-detailLevel", "mini"])
        .output();

    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        let mut current_speed_mbps: u32 = 0;
        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("Speed:") {
                if trimmed.contains("480 Mb") {
                    current_speed_mbps = 480;
                } else if trimmed.contains("5 Gb") {
                    current_speed_mbps = 5000;
                } else if trimmed.contains("10 Gb") {
                    current_speed_mbps = 10000;
                } else if trimmed.contains("20 Gb") {
                    current_speed_mbps = 20000;
                } else if trimmed.contains("40 Gb") {
                    current_speed_mbps = 40000;
                }
            } else if trimmed.starts_with("BSD Name:") {
                if let Some((_, bsd)) = trimmed.split_once(':') {
                    let bsd_clean = bsd.trim().to_string();
                    if current_speed_mbps > 0 {
                        map.insert(bsd_clean, current_speed_mbps);
                    }
                }
            }
        }
    }

    if let Ok(mut guard) = USB_SPEEDS_CACHE.lock() {
        *guard = Some((Instant::now(), map.clone()));
    }

    map
}

/// Computes the physical size of hidden `.Trashes` on an external drive (bounded traversal for instant UI response).
fn calculate_hidden_trash_bytes(mount_point: &str) -> u64 {
    if mount_point == "/" {
        // For internal Mac drive, check ~/.Trash
        if let Ok(home) = std::env::var("HOME") {
            let user_trash = PathBuf::from(home).join(".Trash");
            return fast_dir_size(&user_trash, 400);
        }
        return 0;
    }

    let trashes = Path::new(mount_point).join(".Trashes");
    fast_dir_size(&trashes, 400)
}

fn fast_dir_size(path: &Path, max_entries: usize) -> u64 {
    if !path.exists() {
        return 0;
    }
    let mut total = 0u64;
    for (idx, entry) in walkdir::WalkDir::new(path)
        .max_depth(5)
        .into_iter()
        .flatten()
        .enumerate()
    {
        if idx >= max_entries {
            break;
        }
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

/// Determines link speed label, Mbps, and whether a fast drive is bottlenecked by a slow USB 2.0 cable.
pub fn evaluate_link_speed(
    protocol: &str,
    device_type: &str,
    bsd_name: &str,
    usb_speeds: &HashMap<String, u32>,
) -> (String, u32, bool, Option<String>) {
    let base_disk = bsd_name
        .trim_start_matches("disk")
        .split('s')
        .next()
        .map(|n| format!("disk{}", n))
        .unwrap_or_else(|| bsd_name.to_string());

    let usb_mbps = usb_speeds
        .get(bsd_name)
        .or_else(|| usb_speeds.get(&base_disk))
        .copied();

    let proto_lower = protocol.to_lowercase();
    if proto_lower.contains("apple fabric") || proto_lower.contains("pci") || proto_lower.contains("nvme") {
        return ("Apple NVMe Interne (64 Gbps)".to_string(), 64000, false, None);
    }
    if proto_lower.contains("thunderbolt") {
        return ("Thunderbolt (40 Gbps)".to_string(), 40000, false, None);
    }
    if device_type == "cloud_drive" {
        return ("Volume Cloud / Virtuel".to_string(), 1000, false, None);
    }

    if let Some(mbps) = usb_mbps {
        if mbps <= 480 && (device_type == "external_ssd" || device_type == "external_hdd") {
            return (
                "USB 2.0 (480 Mbps — Bridé)".to_string(),
                480,
                true,
                Some("Câble USB 2.0 détecté (limité à ~40 Mo/s). Utilisez un câble USB 3.2 / Thunderbolt.".to_string()),
            );
        }
        let label = match mbps {
            480 => "USB 2.0 (480 Mbps)".to_string(),
            5000 => "USB 3.1 Gen 1 (5 Gbps)".to_string(),
            10000 => "USB 3.2 Gen 2 (10 Gbps)".to_string(),
            20000 => "USB 3.2 Gen 2x2 (20 Gbps)".to_string(),
            40000 => "USB4 / Thunderbolt (40 Gbps)".to_string(),
            _ => format!("USB ({} Mbps)", mbps),
        };
        return (label, mbps, false, None);
    }

    if device_type == "sd_card" {
        return ("Lecteur Carte SD / UHS-II".to_string(), 2500, false, None);
    }
    if proto_lower.contains("usb") {
        return ("USB 3.2 (10 Gbps)".to_string(), 10000, false, None);
    }

    ("Bus Système Direct".to_string(), 10000, false, None)
}

pub fn list_all_storage_drives() -> Vec<StorageDriveInfo> {
    let disks = Disks::new_with_refreshed_list();
    let usb_speeds = query_usb_bus_speeds();
    let mut results = Vec::new();
    let mut seen_mounts = std::collections::HashSet::new();

    for disk in disks.list() {
        let mount_point = disk.mount_point().to_string_lossy().to_string();

        // Filter out macOS internal system subvolumes (/System/Volumes/*)
        if mount_point.starts_with("/System/Volumes")
            || mount_point.starts_with("/private")
            || mount_point.starts_with("/dev")
        {
            continue;
        }
        if !seen_mounts.insert(mount_point.clone()) {
            continue;
        }

        let total_bytes = disk.total_space();
        if total_bytes == 0 {
            continue;
        }
        let available_bytes = disk.available_space();
        let used_bytes = total_bytes.saturating_sub(available_bytes);

        let meta = query_diskutil_info(&mount_point);
        let name = if mount_point == "/" {
            let raw_name = disk.name().to_string_lossy().to_string();
            if raw_name.is_empty() {
                "Macintosh HD".to_string()
            } else {
                raw_name
            }
        } else {
            Path::new(&mount_point)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| disk.name().to_string_lossy().to_string())
        };

        let fs_name = disk.file_system().to_string_lossy().to_uppercase();
        let file_system = if fs_name.is_empty() {
            "APFS".to_string()
        } else {
            fs_name
        };

        let is_internal = mount_point == "/";
        let name_lower = name.to_lowercase();
        let model_lower = meta.device_model.to_lowercase();
        let proto_lower = meta.protocol.to_lowercase();

        let device_type = if is_internal {
            "internal_ssd".to_string()
        } else if proto_lower.contains("secure digital")
            || model_lower.contains("sd")
            || model_lower.contains("reader")
            || name_lower.contains("eos")
            || name_lower.contains("lumix")
            || name_lower.contains("sony")
            || name_lower.contains("dji")
            || (file_system.contains("EXFAT") && total_bytes <= 512 * 1024 * 1024 * 1024)
        {
            "sd_card".to_string()
        } else if !meta.solid_state {
            "external_hdd".to_string()
        } else {
            "external_ssd".to_string()
        };

        let (link_speed_label, link_speed_mbps, is_cable_bottlenecked, cable_warning) =
            evaluate_link_speed(&meta.protocol, &device_type, &meta.bsd_name, &usb_speeds);

        let hidden_trash_bytes = calculate_hidden_trash_bytes(&mount_point);

        let is_encrypted = meta.is_encrypted || meta.filevault_enabled;
        let encryption_status = if is_encrypted {
            "Chiffré (Sécurisé)".to_string()
        } else {
            "Non chiffré (Données en clair)".to_string()
        };
        let can_encrypt = !is_encrypted && file_system.starts_with("APFS") && !is_internal;

        results.push(StorageDriveInfo {
            id: format!("drive-{}", meta.bsd_name),
            name,
            mount_point,
            bsd_name: meta.bsd_name,
            file_system,
            device_type,
            total_bytes,
            available_bytes,
            used_bytes,
            is_removable: !is_internal,
            is_read_only: disk.is_read_only(),
            is_cloud: false,
            protocol: if meta.protocol.is_empty() {
                "NVMe / USB".to_string()
            } else {
                meta.protocol
            },
            link_speed_label,
            link_speed_mbps,
            is_cable_bottlenecked,
            cable_warning,
            hidden_trash_bytes,
            is_encrypted,
            encryption_status,
            can_encrypt,
        });
    }

    results
}

/// Validates that a BSD disk identifier strictly matches `disk<N>` or `disk<N>s<M>(s<P>)`.
pub fn is_valid_bsd_name(name: &str) -> bool {
    let trimmed = name.trim().trim_start_matches("/dev/");
    let Some(rest) = trimmed.strip_prefix("disk") else {
        return false;
    };
    if rest.is_empty() {
        return false;
    }
    let mut parts = rest.split('s');
    let Some(disk_num) = parts.next() else {
        return false;
    };
    if disk_num.is_empty() || !disk_num.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    for slice_part in parts {
        if slice_part.is_empty() || !slice_part.chars().all(|c| c.is_ascii_digit()) {
            return false;
        }
    }
    true
}

/// Extracts the base whole-disk BSD identifier (e.g. `disk5` from `/dev/disk5s1` or `disk3s1s1`).
pub fn extract_base_whole_disk(bsd_name: &str) -> String {
    let clean = bsd_name.trim().trim_start_matches("/dev/");
    if let Some(rest) = clean.strip_prefix("disk") {
        let num: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if !num.is_empty() {
            return format!("disk{}", num);
        }
    }
    clean.to_string()
}

/// Resolves a BSD identifier or mount point (including synthesized APFS volumes/containers)
/// down to its underlying physical whole-disk BSD name (e.g. `disk3s1s1` -> `disk0`, `disk6s2` -> `disk5`).
pub fn resolve_physical_whole_disk(bsd_or_mount: &str) -> Option<String> {
    let mut current = bsd_or_mount.trim().to_string();
    if current.is_empty() {
        return None;
    }

    let mut last_valid_disk: Option<String> = None;
    for _ in 0..3 {
        let output = Command::new("/usr/sbin/diskutil")
            .args(["info", &current])
            .output()
            .ok()?;
        if !output.status.success() {
            break;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let mut device_id: Option<String> = None;
        let mut apfs_store: Option<String> = None;

        for line in text.lines() {
            let trimmed = line.trim();
            let Some((k, v)) = trimmed.split_once(':') else {
                continue;
            };
            let key = k.trim();
            let val = v.trim();
            match key {
                "Device Identifier" => {
                    let cand = val.trim_start_matches("/dev/").trim();
                    if is_valid_bsd_name(cand) {
                        device_id = Some(cand.to_string());
                    }
                }
                "APFS Physical Store" => {
                    let cand = val.trim_start_matches("/dev/").trim();
                    if is_valid_bsd_name(cand) {
                        apfs_store = Some(cand.to_string());
                    }
                }
                _ => {}
            }
        }

        if let Some(id) = device_id {
            last_valid_disk = Some(extract_base_whole_disk(&id));
        }

        if let Some(store) = apfs_store {
            current = extract_base_whole_disk(&store);
        } else {
            break;
        }
    }

    last_valid_disk
}

/// Evaluates raw `diskutil info` text to decide whether a device is an internal/system disk
/// (`Ok(true)`), a safe external/removable device (`Ok(false)`), or requires recursing into an
/// `APFS Physical Store` (`Err(store_bsd)`).
pub fn classify_diskutil_info_internal(text: &str) -> Result<bool, String> {
    let mut seen_external = false;
    let mut seen_removable = false;
    let mut protocol_lower = String::new();
    let mut apfs_physical_store: Option<String> = None;

    for line in text.lines() {
        let trimmed = line.trim();
        let Some((k, v)) = trimmed.split_once(':') else {
            continue;
        };
        let key = k.trim();
        let val = v.trim();
        match key {
            "Mount Point" => {
                if val == "/" || val.starts_with("/System") {
                    return Ok(true);
                }
            }
            "Device Location" => {
                let lower = val.to_ascii_lowercase();
                if lower.contains("external") {
                    seen_external = true;
                }
            }
            "Internal" => {
                if val.eq_ignore_ascii_case("No") {
                    seen_external = true;
                }
            }
            "Removable Media" => {
                if val.eq_ignore_ascii_case("Removable") {
                    seen_removable = true;
                }
            }
            "Protocol" => {
                protocol_lower = val.to_ascii_lowercase();
            }
            "APFS Physical Store" => {
                let candidate = val.trim_start_matches("/dev/").trim();
                if is_valid_bsd_name(candidate) {
                    apfs_physical_store = Some(candidate.to_string());
                }
            }
            _ => {}
        }
    }

    if let Some(store) = apfs_physical_store {
        return Err(store);
    }

    // Built-in MacBook SDXC card readers report `Device Location: Internal` together with
    // `Removable Media: Removable` and `Protocol: Secure Digital`. Allow those explicitly
    // while keeping internal fixed storage (`Apple Fabric` / `PCI-Express` / `Fixed`) strictly locked.
    let is_removable_sd_or_external_bus = seen_removable
        && (protocol_lower.contains("secure digital")
            || protocol_lower.contains("usb")
            || protocol_lower.contains("thunderbolt")
            || protocol_lower == "sd");

    if seen_external || is_removable_sd_or_external_bus {
        Ok(false)
    } else {
        Ok(true)
    }
}

/// Authoritatively checks via macOS `diskutil info` whether a BSD device or mount point belongs
/// to an internal/system disk. Fails closed (`Ok(true)`) if the device cannot be verified as external
/// or removable SD media.
pub fn is_bsd_disk_internal_or_system(bsd_or_mount: &str) -> Result<bool, String> {
    let target = bsd_or_mount.trim();
    if target.is_empty() || target == "/" || target.starts_with("/System") {
        return Ok(true);
    }

    let query_arg = if target.starts_with("/Volumes/") {
        target.to_string()
    } else {
        let stripped = target.trim_start_matches("/dev/");
        if !is_valid_bsd_name(stripped) {
            return Err(format!("Identifiant de disque invalide : {}", bsd_or_mount));
        }
        stripped.to_string()
    };

    check_diskutil_internal_recursive(&query_arg, 0)
}

fn check_diskutil_internal_recursive(target: &str, depth: u8) -> Result<bool, String> {
    if depth > 2 {
        return Ok(true);
    }

    let output = Command::new("/usr/sbin/diskutil")
        .args(["info", target])
        .output()
        .map_err(|e| format!("Erreur d'exécution diskutil : {}", e))?;

    if !output.status.success() {
        return Ok(true);
    }

    let text = String::from_utf8_lossy(&output.stdout);
    match classify_diskutil_info_internal(&text) {
        Ok(is_internal) => Ok(is_internal),
        Err(apfs_store) => check_diskutil_internal_recursive(&apfs_store, depth + 1),
    }
}

/// Safely moves a file or directory to the macOS Trash via Finder AppleScript `argv` passing
/// (immune to shell/AppleScript quoting injection), with a safe same-filesystem `~/.Trash` rename fallback.
/// Never falls back silently to permanent deletion.
pub fn move_path_to_macos_trash(path: &Path) -> Result<(), String> {
    let path_str = path
        .to_str()
        .ok_or_else(|| "Chemin UTF-8 invalide pour la Corbeille.".to_string())?;

    #[cfg(target_os = "macos")]
    {
        let output = Command::new("/usr/bin/osascript")
            .args([
                "-e",
                "on run argv",
                "-e",
                "tell application \"Finder\" to delete POSIX file (item 1 of argv)",
                "-e",
                "end run",
                "--",
                path_str,
            ])
            .output();

        if let Ok(out) = output {
            if out.status.success() {
                return Ok(());
            }
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        let home_path = Path::new(&home);
        if path.starts_with(home_path) {
            let trash_dir = home_path.join(".Trash");
            if trash_dir.exists() || std::fs::create_dir_all(&trash_dir).is_ok() {
                let fname = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .ok_or_else(|| "Nom de fichier invalide.".to_string())?;
                let mut dest = trash_dir.join(fname);
                if dest.exists() {
                    let stamp = chrono::Local::now().format("%Y%m%d_%H%M%S_%3f");
                    dest = trash_dir.join(format!("{}_{}", stamp, fname));
                }
                if std::fs::rename(path, &dest).is_ok() {
                    return Ok(());
                }
            }
        }
    }

    Err(format!(
        "Impossible de déplacer '{}' vers la Corbeille sans risquer une perte définitive.",
        path.display()
    ))
}

