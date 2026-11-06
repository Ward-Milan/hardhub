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

        let device_type = if is_internal {
            "internal_ssd".to_string()
        } else if model_lower.contains("sd")
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

