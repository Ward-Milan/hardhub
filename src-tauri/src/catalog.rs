use crate::space_lens::classify_file_category;
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub name: String,
    pub rel_path: String,
    pub parent_rel_path: String,
    pub size_bytes: u64,
    pub is_dir: bool,
    pub category: String,
    pub modified_ts: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogVolumeSnapshot {
    pub volume_id: String,
    pub volume_name: String,
    pub device_type: String,
    pub file_system: String,
    pub last_mount_point: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub indexed_at: String,
    pub total_files_indexed: usize,
    pub total_dirs_indexed: usize,
    pub entries: Vec<CatalogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogVolumeSummary {
    pub volume_id: String,
    pub volume_name: String,
    pub device_type: String,
    pub file_system: String,
    pub last_mount_point: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub indexed_at: String,
    pub total_files_indexed: usize,
    pub total_dirs_indexed: usize,
    pub is_online: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSearchResult {
    pub volume_id: String,
    pub volume_name: String,
    pub device_type: String,
    pub is_online: bool,
    pub last_mount_point: String,
    pub name: String,
    pub rel_path: String,
    pub full_path_if_online: String,
    pub size_bytes: u64,
    pub is_dir: bool,
    pub category: String,
    pub modified_ts: u64,
}

fn catalog_storage_dir() -> Result<PathBuf, String> {
    let base = std::env::var("HOME")
        .ok()
        .map(|h| PathBuf::from(h).join("Library/Application Support"))
        .ok_or_else(|| "Impossible de localiser le dossier Application Support".to_string())?;
    let dir = base.join("HardHub").join("catalog");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

pub fn make_volume_slug(volume_name: &str, mount_point: &str) -> String {
    let raw = format!("{}_{}", volume_name, mount_point);
    let sanitized: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();
    sanitized.trim_matches('_').to_string()
}

fn should_skip_catalog_entry(name: &str) -> bool {
    name == ".DS_Store"
        || name.starts_with("._")
        || name == ".Spotlight-V100"
        || name == ".fseventsd"
        || name == ".Trashes"
        || name == ".Trash"
        || name == ".DocumentRevisions-V100"
        || name == ".TemporaryItems"
        || name == "node_modules"
        || name == ".git"
        || name == "target"
}

const MAX_CATALOG_ENTRIES: usize = 35_000;
const MAX_CATALOG_DEPTH: usize = 6;

fn collect_entries_recursive(
    root: &Path,
    current: &Path,
    depth: usize,
    entries: &mut Vec<CatalogEntry>,
    files_count: &mut usize,
    dirs_count: &mut usize,
) {
    if depth > MAX_CATALOG_DEPTH || entries.len() >= MAX_CATALOG_ENTRIES {
        return;
    }

    let rd = match fs::read_dir(current) {
        Ok(r) => r,
        Err(_) => return,
    };

    for entry in rd.flatten() {
        if entries.len() >= MAX_CATALOG_ENTRIES {
            break;
        }
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };

        if should_skip_catalog_entry(&name) {
            continue;
        }

        let ft = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }

        let rel_path = path
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| name.clone());

        let parent_rel_path = path
            .parent()
            .and_then(|p| p.strip_prefix(root).ok())
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let meta = entry.metadata().ok();
        let modified_ts = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let is_app_bundle = name.ends_with(".app") || name.ends_with(".photoslibrary");

        if ft.is_dir() {
            *dirs_count += 1;
            let dir_size = if is_app_bundle {
                compute_quick_dir_size(&path, 2)
            } else {
                0
            };
            entries.push(CatalogEntry {
                name: name.clone(),
                rel_path: rel_path.clone(),
                parent_rel_path,
                size_bytes: dir_size,
                is_dir: true,
                category: if is_app_bundle {
                    "app".to_string()
                } else {
                    "folder".to_string()
                },
                modified_ts,
            });

            if !is_app_bundle {
                collect_entries_recursive(root, &path, depth + 1, entries, files_count, dirs_count);
            }
        } else if ft.is_file() {
            let size_bytes = meta.map(|m| m.len()).unwrap_or(0);
            *files_count += 1;
            let cat = classify_file_category(&path).to_string();
            entries.push(CatalogEntry {
                name,
                rel_path,
                parent_rel_path,
                size_bytes,
                is_dir: false,
                category: cat,
                modified_ts,
            });
        }
    }
}

fn compute_quick_dir_size(dir: &Path, max_depth: usize) -> u64 {
    if max_depth == 0 {
        return 0;
    }
    let mut sum = 0u64;
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            if let Ok(m) = e.metadata() {
                if m.is_file() {
                    sum = sum.saturating_add(m.len());
                } else if m.is_dir() {
                    sum = sum.saturating_add(compute_quick_dir_size(&e.path(), max_depth - 1));
                }
            }
        }
    }
    sum
}

pub fn index_volume_snapshot(
    mount_point: &str,
    volume_name: &str,
    device_type: &str,
    file_system: &str,
    total_bytes: u64,
    used_bytes: u64,
    available_bytes: u64,
) -> Result<CatalogVolumeSummary, String> {
    let root = Path::new(mount_point);
    if !root.exists() {
        return Err(format!("Le support '{}' n'est pas accessible.", mount_point));
    }

    let volume_id = make_volume_slug(volume_name, mount_point);
    let mut entries = Vec::new();
    let mut files_count = 0usize;
    let mut dirs_count = 0usize;

    collect_entries_recursive(
        root,
        root,
        0,
        &mut entries,
        &mut files_count,
        &mut dirs_count,
    );

    // Compute top-level & second-level folder sizes from indexed files so browsing offline shows folder sizes
    let file_sizes: Vec<(String, u64)> = entries
        .iter()
        .filter(|e| !e.is_dir && e.size_bytes > 0)
        .map(|e| (e.rel_path.clone(), e.size_bytes))
        .collect();

    for entry in entries.iter_mut() {
        if entry.is_dir && entry.size_bytes == 0 {
            let prefix = format!("{}/", entry.rel_path);
            let sum: u64 = file_sizes
                .iter()
                .filter(|(p, _)| p.starts_with(&prefix))
                .map(|(_, s)| *s)
                .sum();
            entry.size_bytes = sum;
        }
    }

    let indexed_at = Local::now().format("%d/%m/%Y %H:%M").to_string();

    let snapshot = CatalogVolumeSnapshot {
        volume_id: volume_id.clone(),
        volume_name: volume_name.to_string(),
        device_type: device_type.to_string(),
        file_system: file_system.to_string(),
        last_mount_point: mount_point.to_string(),
        total_bytes,
        used_bytes,
        available_bytes,
        indexed_at: indexed_at.clone(),
        total_files_indexed: files_count,
        total_dirs_indexed: dirs_count,
        entries,
    };

    let dir = catalog_storage_dir()?;
    let file_path = dir.join(format!("{}.json", volume_id));
    let json = serde_json::to_string(&snapshot).map_err(|e| e.to_string())?;
    fs::write(&file_path, json).map_err(|e| e.to_string())?;

    Ok(CatalogVolumeSummary {
        volume_id,
        volume_name: volume_name.to_string(),
        device_type: device_type.to_string(),
        file_system: file_system.to_string(),
        last_mount_point: mount_point.to_string(),
        total_bytes,
        used_bytes,
        available_bytes,
        indexed_at,
        total_files_indexed: files_count,
        total_dirs_indexed: dirs_count,
        is_online: true,
    })
}

fn load_all_snapshots() -> Result<Vec<CatalogVolumeSnapshot>, String> {
    let dir = catalog_storage_dir()?;
    let mut snapshots = Vec::new();
    let rd = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in rd.flatten() {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Ok(raw) = fs::read_to_string(&p) {
                if let Ok(snap) = serde_json::from_str::<CatalogVolumeSnapshot>(&raw) {
                    snapshots.push(snap);
                }
            }
        }
    }
    snapshots.sort_by(|a, b| a.volume_name.to_lowercase().cmp(&b.volume_name.to_lowercase()));
    Ok(snapshots)
}

pub fn list_catalog_summaries() -> Result<Vec<CatalogVolumeSummary>, String> {
    let snapshots = load_all_snapshots()?;
    let summaries = snapshots
        .into_iter()
        .map(|s| {
            let is_online = Path::new(&s.last_mount_point).exists();
            CatalogVolumeSummary {
                volume_id: s.volume_id,
                volume_name: s.volume_name,
                device_type: s.device_type,
                file_system: s.file_system,
                last_mount_point: s.last_mount_point,
                total_bytes: s.total_bytes,
                used_bytes: s.used_bytes,
                available_bytes: s.available_bytes,
                indexed_at: s.indexed_at,
                total_files_indexed: s.total_files_indexed,
                total_dirs_indexed: s.total_dirs_indexed,
                is_online,
            }
        })
        .collect();
    Ok(summaries)
}

pub fn browse_snapshot_directory(
    volume_id: &str,
    parent_rel_path: &str,
) -> Result<Vec<CatalogEntry>, String> {
    let dir = catalog_storage_dir()?;
    let file_path = dir.join(format!("{}.json", volume_id));
    let raw = fs::read_to_string(&file_path)
        .map_err(|_| "Catalogue introuvable pour ce volume.".to_string())?;
    let snap: CatalogVolumeSnapshot =
        serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    let mut items: Vec<CatalogEntry> = snap
        .entries
        .into_iter()
        .filter(|e| e.parent_rel_path == parent_rel_path)
        .collect();

    items.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| b.size_bytes.cmp(&a.size_bytes))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(items)
}

pub fn search_across_catalog(
    query: &str,
    volume_filter: Option<&str>,
    category_filter: Option<&str>,
) -> Result<Vec<CatalogSearchResult>, String> {
    let snapshots = load_all_snapshots()?;
    let tokens: Vec<String> = query
        .trim()
        .to_lowercase()
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();

    let mut results = Vec::new();

    for snap in snapshots {
        if let Some(vf) = volume_filter {
            if !vf.is_empty() && vf != "all" && snap.volume_id != vf {
                continue;
            }
        }

        let is_online = Path::new(&snap.last_mount_point).exists();

        for entry in snap.entries {
            if let Some(cf) = category_filter {
                if !cf.is_empty() && cf != "all" && entry.category != cf {
                    continue;
                }
            }

            if !tokens.is_empty() {
                let hay = format!(
                    "{} {} {}",
                    entry.name.to_lowercase(),
                    entry.rel_path.to_lowercase(),
                    snap.volume_name.to_lowercase()
                );
                if !tokens.iter().all(|t| hay.contains(t)) {
                    continue;
                }
            }

            let full_path_if_online = format!(
                "{}/{}",
                snap.last_mount_point.trim_end_matches('/'),
                entry.rel_path
            );

            results.push(CatalogSearchResult {
                volume_id: snap.volume_id.clone(),
                volume_name: snap.volume_name.clone(),
                device_type: snap.device_type.clone(),
                is_online,
                last_mount_point: snap.last_mount_point.clone(),
                name: entry.name,
                rel_path: entry.rel_path,
                full_path_if_online,
                size_bytes: entry.size_bytes,
                is_dir: entry.is_dir,
                category: entry.category,
                modified_ts: entry.modified_ts,
            });
        }
    }

    results.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    results.truncate(150);

    Ok(results)
}

pub fn delete_catalog_snapshot(volume_id: &str) -> Result<(), String> {
    let dir = catalog_storage_dir()?;
    let file_path = dir.join(format!("{}.json", volume_id));
    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
