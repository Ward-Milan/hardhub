use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeFileItem {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub category: String, // "installer" | "video" | "archive" | "ios_backup" | "disk_image" | "other"
    pub last_modified: u64,
    pub age_days: u32,
    pub age_category: String, // "older_than_year" | "older_than_6m" | "older_than_3m" | "recent"
    pub is_selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeFilesReport {
    pub target_path: String,
    pub total_scanned_files: usize,
    pub matched_files_count: usize,
    pub total_matched_bytes: u64,
    pub items: Vec<LargeFileItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeFilesPurgeReport {
    pub deleted_count: usize,
    pub freed_bytes: u64,
    pub errors: Vec<String>,
}

fn classify_large_file_category(p: &Path) -> String {
    let p_str = p.to_string_lossy();
    if p_str.contains("MobileSync/Backup") || p_str.contains("Apple/MobileSync") {
        return "ios_backup".to_string();
    }

    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "dmg" | "pkg" | "iso" => "installer".to_string(),
        "mov" | "mp4" | "mkv" | "avi" | "braw" | "r3d" | "m4v" | "webm" | "prores" => {
            "video".to_string()
        }
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" => "archive".to_string(),
        "img" | "sparseimage" | "sparsebundle" | "vdi" | "vmdk" | "qcow2" => {
            "disk_image".to_string()
        }
        _ => "other".to_string(),
    }
}

pub fn scan_large_and_old_files(
    target_path: &str,
    min_size_bytes: u64,
) -> Result<LargeFilesReport, String> {
    let resolved = if target_path == "/" {
        std::env::var("HOME").unwrap_or_else(|_| "/Users".to_string())
    } else {
        target_path.to_string()
    };

    let root = Path::new(&resolved);
    if !root.exists() {
        return Err(format!("Le chemin '{}' est introuvable.", resolved));
    }

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    // Collect candidate paths
    let mut total_scanned = 0usize;
    let mut candidates = Vec::new();

    for entry in WalkDir::new(root)
        .max_depth(8)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            if name.starts_with('.') && name != ".Trash" && name != ".Trashes" {
                return false;
            }
            let p = e.path();
            let p_str = p.to_string_lossy();
            !(p_str.starts_with("/System")
                || p_str.starts_with("/private")
                || p_str.starts_with("/dev")
                || p_str.starts_with("/proc")
                || p_str.contains("/.Spotlight-V100")
                || p_str.contains("/.fseventsd"))
        })
        .flatten()
    {
        total_scanned += 1;
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                if meta.len() >= min_size_bytes {
                    candidates.push((entry.into_path(), meta.len()));
                }
            }
        }
    }

    // Process matched files in parallel
    let mut items: Vec<LargeFileItem> = candidates
        .into_par_iter()
        .filter_map(|(p, size_bytes)| {
            let meta = p.metadata().ok()?;
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            let age_secs = now_secs.saturating_sub(modified);
            let age_days = (age_secs / 86400) as u32;

            let age_category = if age_days >= 365 {
                "older_than_year".to_string()
            } else if age_days >= 180 {
                "older_than_6m".to_string()
            } else if age_days >= 90 {
                "older_than_3m".to_string()
            } else {
                "recent".to_string()
            };

            let name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Fichier")
                .to_string();

            let category = classify_large_file_category(&p);

            Some(LargeFileItem {
                path: p.to_string_lossy().to_string(),
                name,
                size_bytes,
                category,
                last_modified: modified,
                age_days,
                age_category,
                is_selected: false,
            })
        })
        .collect();

    // Sort: largest files first
    items.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

    let matched_files_count = items.len();
    let total_matched_bytes: u64 = items.iter().map(|i| i.size_bytes).sum();

    Ok(LargeFilesReport {
        target_path: resolved,
        total_scanned_files: total_scanned,
        matched_files_count,
        total_matched_bytes,
        items,
    })
}

pub fn purge_large_files_list(
    paths_to_delete: &[String],
    move_to_trash: bool,
) -> LargeFilesPurgeReport {
    let mut deleted_count = 0usize;
    let mut freed_bytes = 0u64;
    let mut errors = Vec::new();

    for path_str in paths_to_delete {
        let p = Path::new(path_str);
        if !p.exists() {
            continue;
        }

        // Safety: protect root and system paths
        if path_str == "/"
            || path_str.starts_with("/System")
            || path_str.starts_with("/Applications")
            || path_str.starts_with("/Library")
        {
            errors.push(format!("Sécurité : suppression refusée sur '{}'.", path_str));
            continue;
        }

        let size = p.metadata().map(|m| m.len()).unwrap_or(0);

        if move_to_trash {
            #[cfg(target_os = "macos")]
            {
                let script = format!(
                    "tell application \"Finder\" to delete POSIX file \"{}\"",
                    path_str.replace('"', "\\\"")
                );
                let res = std::process::Command::new("osascript")
                    .args(["-e", &script])
                    .output();
                match res {
                    Ok(out) if out.status.success() => {
                        deleted_count += 1;
                        freed_bytes = freed_bytes.saturating_add(size);
                    }
                    _ => {
                        // Fallback to direct deletion if Finder fails
                        if let Err(e) = fs::remove_file(p) {
                            errors.push(format!("{}: {}", path_str, e));
                        } else {
                            deleted_count += 1;
                            freed_bytes = freed_bytes.saturating_add(size);
                        }
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                if let Err(e) = fs::remove_file(p) {
                    errors.push(format!("{}: {}", path_str, e));
                } else {
                    deleted_count += 1;
                    freed_bytes = freed_bytes.saturating_add(size);
                }
            }
        } else if let Err(e) = fs::remove_file(p) {
            errors.push(format!("{}: {}", path_str, e));
        } else {
            deleted_count += 1;
            freed_bytes = freed_bytes.saturating_add(size);
        }
    }

    LargeFilesPurgeReport {
        deleted_count,
        freed_bytes,
        errors,
    }
}
