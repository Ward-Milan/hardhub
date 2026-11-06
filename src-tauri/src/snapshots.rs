use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApfsSnapshotItem {
    pub uuid: String,
    pub name: String,
    pub date_label: String,
    pub is_purgeable: bool,
    pub is_system_root: bool,
    pub volume_mount: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotReport {
    pub mount_point: String,
    pub is_apfs: bool,
    pub total_snapshots: usize,
    pub purgeable_snapshots: usize,
    pub snapshots: Vec<ApfsSnapshotItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotPurgeResult {
    pub deleted_count: usize,
    pub message: String,
    pub success: bool,
}

fn parse_diskutil_snapshots_output(output: &str, mount_point: &str) -> Vec<ApfsSnapshotItem> {
    let mut items = Vec::new();
    let mut current_uuid = String::new();
    let mut current_name = String::new();
    let mut current_purgeable = true;

    for raw_line in output.lines() {
        let line = raw_line.trim();

        if line.starts_with("+-- ") {
            if !current_uuid.is_empty() || !current_name.is_empty() {
                items.push(build_snapshot_item(
                    &current_uuid,
                    &current_name,
                    current_purgeable,
                    mount_point,
                ));
            }
            current_uuid = line.trim_start_matches("+-- ").trim().to_string();
            current_name = String::new();
            current_purgeable = true;
        } else if line.starts_with("Name:") {
            current_name = line.trim_start_matches("Name:").trim().to_string();
        } else if line.starts_with("Purgeable:") {
            let val = line.trim_start_matches("Purgeable:").trim();
            current_purgeable = val.eq_ignore_ascii_case("yes");
        }
    }

    if !current_uuid.is_empty() || !current_name.is_empty() {
        items.push(build_snapshot_item(
            &current_uuid,
            &current_name,
            current_purgeable,
            mount_point,
        ));
    }

    items
}

fn build_snapshot_item(
    uuid: &str,
    name: &str,
    is_purgeable: bool,
    mount_point: &str,
) -> ApfsSnapshotItem {
    let is_system_root = name.starts_with("com.apple.os.update") || !is_purgeable;

    // Extract readable date label from Time Machine naming convention e.g. com.apple.TimeMachine.2026-11-04-143021.local
    let date_label = if let Some(idx) = name.find("com.apple.TimeMachine.") {
        let sub = &name[idx + "com.apple.TimeMachine.".len()..];
        let date_part = sub.trim_end_matches(".local");
        // format YYYY-MM-DD-HHMMSS to YYYY-MM-DD HH:MM
        if date_part.len() >= 17 {
            format!(
                "{} {}:{}",
                &date_part[0..10],
                &date_part[11..13],
                &date_part[13..15]
            )
        } else {
            date_part.to_string()
        }
    } else if is_system_root {
        "Système macOS (SSV scellé)".to_string()
    } else {
        name.to_string()
    };

    ApfsSnapshotItem {
        uuid: uuid.to_string(),
        name: name.to_string(),
        date_label,
        is_purgeable: !is_system_root,
        is_system_root,
        volume_mount: mount_point.to_string(),
    }
}

pub fn list_volume_snapshots(mount_point: &str) -> Result<SnapshotReport, String> {
    let resolved = if mount_point == "/" { "/" } else { mount_point };

    // Inspect via diskutil apfs listSnapshots
    let output = Command::new("/usr/sbin/diskutil")
        .args(["apfs", "listSnapshots", resolved])
        .output()
        .map_err(|e| format!("Erreur exécution diskutil: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut snapshots = parse_diskutil_snapshots_output(&stdout, resolved);

    // If root volume on modern macOS, also inspect Data volume where user snapshots reside
    if resolved == "/" && Path::new("/System/Volumes/Data").exists() {
        if let Ok(data_out) = Command::new("/usr/sbin/diskutil")
            .args(["apfs", "listSnapshots", "/System/Volumes/Data"])
            .output()
        {
            let data_stdout = String::from_utf8_lossy(&data_out.stdout);
            let mut data_snapshots =
                parse_diskutil_snapshots_output(&data_stdout, "/System/Volumes/Data");
            for s in data_snapshots.drain(..) {
                if !snapshots.iter().any(|existing| existing.uuid == s.uuid) {
                    snapshots.push(s);
                }
            }
        }
    }

    // Also inspect tmutil listlocalsnapshots to ensure any Time Machine snapshot is listed
    if let Ok(tm_out) = Command::new("/usr/bin/tmutil")
        .args(["listlocalsnapshots", resolved])
        .output()
    {
        let tm_stdout = String::from_utf8_lossy(&tm_out.stdout);
        for line in tm_stdout.lines() {
            let trimmed = line.trim();
            if trimmed.contains("com.apple.TimeMachine.") {
                let name = trimmed.to_string();
                if !snapshots.iter().any(|s| s.name == name) {
                    snapshots.push(build_snapshot_item("", &name, true, resolved));
                }
            }
        }
    }

    let is_apfs = !stdout.contains("is not an APFS");
    let purgeable_snapshots = snapshots.iter().filter(|s| s.is_purgeable).count();

    Ok(SnapshotReport {
        mount_point: resolved.to_string(),
        is_apfs,
        total_snapshots: snapshots.len(),
        purgeable_snapshots,
        snapshots,
    })
}

pub fn delete_single_snapshot(
    mount_point: &str,
    name: &str,
    uuid: &str,
) -> Result<SnapshotPurgeResult, String> {
    if name.starts_with("com.apple.os.update") {
        return Err("Protection macOS : l'instantané système racine ne peut pas être supprimé.".to_string());
    }

    // Try tmutil deletelocalsnapshots first if it's a TimeMachine snapshot
    if name.contains("com.apple.TimeMachine.") {
        let sub = &name[name.find("com.apple.TimeMachine.").unwrap() + "com.apple.TimeMachine.".len()..];
        let date_part = sub.trim_end_matches(".local");
        let output = Command::new("/usr/bin/tmutil")
            .args(["deletelocalsnapshots", date_part])
            .output();

        if let Ok(out) = output {
            let out_str = String::from_utf8_lossy(&out.stdout);
            if out.status.success() || out_str.contains("Deleted local snapshot") {
                return Ok(SnapshotPurgeResult {
                    deleted_count: 1,
                    message: format!("Instantané Time Machine « {} » supprimé.", date_part),
                    success: true,
                });
            }
        }
    }

    // Fallback to diskutil apfs deleteSnapshot by UUID or Name
    let mut cmd = Command::new("/usr/sbin/diskutil");
    cmd.arg("apfs").arg("deleteSnapshot").arg(mount_point);
    if !uuid.is_empty() {
        cmd.arg("-uuid").arg(uuid);
    } else {
        cmd.arg("-name").arg(name);
    }

    let output = cmd.output().map_err(|e| format!("Erreur diskutil: {}", e))?;
    if output.status.success() {
        Ok(SnapshotPurgeResult {
            deleted_count: 1,
            message: format!("Instantané APFS « {} » supprimé.", name),
            success: true,
        })
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("Échec de suppression de l'instantané : {}", err.trim()))
    }
}

pub fn thin_and_purge_all_snapshots(mount_point: &str) -> Result<SnapshotPurgeResult, String> {
    let resolved = if mount_point == "/" { "/" } else { mount_point };

    // 1. Force tmutil thinlocalsnapshots to reclaim all purgeable snapshot storage (urgency level 4)
    let thin_output = Command::new("/usr/bin/tmutil")
        .args(["thinlocalsnapshots", resolved, "999999999999999", "4"])
        .output();

    let mut thinned_lines_count = 0;
    if let Ok(out) = thin_output {
        let stdout = String::from_utf8_lossy(&out.stdout);
        thinned_lines_count = stdout
            .lines()
            .filter(|l| l.contains("com.apple.TimeMachine."))
            .count();
    }

    // 2. Also delete any remaining purgeable snapshot found in list_volume_snapshots
    let mut manual_deleted = 0;
    if let Ok(rep) = list_volume_snapshots(resolved) {
        for s in rep.snapshots {
            if s.is_purgeable && !s.is_system_root {
                if delete_single_snapshot(resolved, &s.name, &s.uuid).is_ok() {
                    manual_deleted += 1;
                }
            }
        }
    }

    let total = thinned_lines_count + manual_deleted;
    Ok(SnapshotPurgeResult {
        deleted_count: total,
        message: if total > 0 {
            format!("{} instantané(s) APFS purgé(s). L'espace système fantôme est libéré.", total)
        } else {
            "Aucun instantané Time Machine ne retenait d'espace système.".to_string()
        },
        success: true,
    })
}

