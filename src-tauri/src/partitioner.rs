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
                c.is_internal = !store.starts_with("disk4") && !store.starts_with("disk5") && !store.starts_with("disk6");
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
    Ok(parse_apfs_containers_text(&stdout))
}

pub fn add_apfs_volume(req: AddVolumeRequest) -> Result<PartitionActionResult, String> {
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

    if let Some(pwd) = req.passphrase {
        if !pwd.trim().is_empty() {
            cmd.args(["-passphrase", pwd.trim()]);
        }
    }

    let output = cmd.output().map_err(|e| format!("Erreur diskutil: {}", e))?;

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
        Err(format!("Échec de création du volume APFS : {}", err.trim()))
    }
}

pub fn delete_apfs_volume(bsd_name: &str, mount_point: &str) -> Result<PartitionActionResult, String> {
    if mount_point == "/" || mount_point.starts_with("/System") {
        return Err("Sécurité macOS : impossible de supprimer le volume système actif.".to_string());
    }

    if bsd_name.is_empty()
        || bsd_name == "disk3s1"
        || bsd_name == "disk3s5"
        || bsd_name == "disk1s1"
        || bsd_name == "disk0s1"
    {
        return Err(format!("Sécurité : suppression refusée sur le volume système {}.", bsd_name));
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
        Err(format!("Échec de suppression du volume : {}", err.trim()))
    }
}

pub fn split_dual_partition(req: SplitPartitionRequest) -> Result<PartitionActionResult, String> {
    if !req.is_removable {
        return Err("Sécurité HardHub : le partitionnement hybride est strictement réservé aux disques externes.".to_string());
    }

    let raw_dev = req.parent_disk.trim_start_matches("/dev/");
    let base_dev = if let Some(idx) = raw_dev.find('s') {
        if idx >= 4 && raw_dev.starts_with("disk") {
            &raw_dev[..idx]
        } else {
            raw_dev
        }
    } else {
        raw_dev
    };

    if base_dev.is_empty()
        || base_dev == "disk0"
        || base_dev == "disk1"
        || base_dev == "disk2"
        || base_dev == "disk3"
    {
        return Err("Sécurité : partitionnement refusé sur le disque interne.".to_string());
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

    let p1_name = req.partition1_name.trim();
    let p2_name = req.partition2_name.trim();

    let output = Command::new("/usr/sbin/diskutil")
        .args([
            "partitionDisk",
            &format!("/dev/{}", base_dev),
            "GPT",
            p1_fs,
            if p1_name.is_empty() { "Mac_Data" } else { p1_name },
            &format!("{}%", p1_pct),
            p2_fs,
            if p2_name.is_empty() { "PC_CrossShared" } else { p2_name },
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
        Err(format!(
            "Échec du partitionnement : {}",
            if !err.trim().is_empty() { err.trim() } else { out.trim() }
        ))
    }
}

pub fn encrypt_apfs_volume(bsd_name: &str, passphrase: &str) -> Result<PartitionActionResult, String> {
    if passphrase.trim().len() < 4 {
        return Err("Le mot de passe de protection doit comporter au moins 4 caractères.".to_string());
    }

    let raw_bsd = bsd_name.trim().trim_start_matches("/dev/");
    if raw_bsd.is_empty()
        || raw_bsd == "disk0"
        || raw_bsd == "disk1"
        || raw_bsd == "disk2"
        || raw_bsd == "disk3"
        || raw_bsd.starts_with("disk0s")
        || raw_bsd.starts_with("disk1s")
        || raw_bsd.starts_with("disk2s")
        || raw_bsd.starts_with("disk3s")
    {
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
        Err(format!("Échec du chiffrement du volume : {}", details))
    }
}
