use crate::space_lens::is_protected_system_path;
use image::imageops::FilterType;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Instant, UNIX_EPOCH};
use walkdir::WalkDir;
use xxhash_rust::xxh3::Xxh3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateFileItem {
    pub path: String,
    pub name: String,
    pub parent_dir: String,
    pub size_bytes: u64,
    pub modified_ts: u64,
    pub is_marked_for_deletion: bool,
    pub is_suggested_original: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroup {
    pub group_id: String,
    pub match_type: String, // "exact" | "similar_photo" | "burst"
    pub similarity_label: String, // "100% Identique" | "94% Similaire (Rafale)"
    pub shared_size_bytes: u64,
    pub wasted_bytes: u64,
    pub files: Vec<DuplicateFileItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateScanReport {
    pub target_path: String,
    pub total_scanned_files: usize,
    pub total_duplicate_groups: usize,
    pub total_wasted_bytes: u64,
    pub total_duplicate_files: usize,
    pub scan_duration_ms: u64,
    pub groups: Vec<DuplicateGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatePurgeReport {
    pub deleted_files_count: usize,
    pub freed_bytes: u64,
    pub errors: Vec<String>,
}

fn is_candidate_photo(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "heic" | "cr2" | "cr3" | "arw" | "nef" | "dng" | "tif" | "tiff"
    )
}

fn compute_partial_hash(path: &Path, file_size: u64) -> Option<u64> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Xxh3::new();
    let sample_chunk = 16 * 1024; // 16 KB

    let mut buf = vec![0u8; sample_chunk];
    let head_read = file.read(&mut buf).ok()?;
    hasher.update(&buf[..head_read]);

    if file_size > (sample_chunk as u64 * 2) {
        if file.seek(SeekFrom::End(-(sample_chunk as i64))).is_ok() {
            let tail_read = file.read(&mut buf).ok().unwrap_or(0);
            hasher.update(&buf[..tail_read]);
        }
    }

    Some(hasher.digest())
}

fn compute_full_hash(path: &Path) -> Option<u64> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Xxh3::new();
    let mut buf = vec![0u8; 64 * 1024];

    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }

    Some(hasher.digest())
}

/// Compute 64-bit difference hash (dHash) on 9x8 downscaled grayscale representation.
/// Fast, robust against scaling, slight exposure shifts and compression differences.
pub fn compute_photo_dhash(path: &Path) -> Option<u64> {
    let img = image::open(path).ok()?;
    // Resize to 9x8 grayscale
    let small = img.resize_exact(9, 8, FilterType::Nearest).to_luma8();

    let mut hash: u64 = 0;
    for y in 0..8 {
        for x in 0..8 {
            let left = small.get_pixel(x, y)[0];
            let right = small.get_pixel(x + 1, y)[0];
            if left > right {
                hash |= 1 << (y * 8 + x);
            }
        }
    }
    Some(hash)
}

#[inline]
pub fn hamming_distance(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

pub fn scan_duplicates(
    target_path: &str,
    include_similar_photos: bool,
    min_size_bytes: u64,
) -> Result<DuplicateScanReport, String> {
    let start = Instant::now();
    let root = Path::new(target_path);
    if !root.exists() {
        return Err(format!("Le dossier cible '{}' est introuvable.", target_path));
    }

    // Step 1: Collect all files and filter by minimum size
    let mut file_candidates: Vec<(PathBuf, u64, u64)> = Vec::new(); // (path, size, modified_ts)
    let min_sz = min_size_bytes.max(1024); // ignore 0-byte or tiny metadata files

    for entry in WalkDir::new(root)
        .min_depth(1)
        .max_depth(12)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            name != ".DS_Store"
                && !name.starts_with("._")
                && name != ".Spotlight-V100"
                && name != ".fseventsd"
                && name != ".Trashes"
                && name != ".Trash"
                && name != "node_modules"
                && name != ".git"
        })
        .flatten()
    {
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                let sz = meta.len();
                if sz >= min_sz {
                    let ts = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    file_candidates.push((entry.path().to_path_buf(), sz, ts));
                }
            }
        }
    }

    let total_scanned_files = file_candidates.len();

    // Step 2: Group by exact size
    let mut size_map: HashMap<u64, Vec<(PathBuf, u64)>> = HashMap::new();
    for (p, sz, ts) in &file_candidates {
        size_map.entry(*sz).or_default().push((p.clone(), *ts));
    }

    // Keep only sizes that have 2 or more files
    let identical_size_groups: Vec<(u64, Vec<(PathBuf, u64)>)> = size_map
        .into_iter()
        .filter(|(_, files)| files.len() >= 2)
        .collect();

    // Step 3: Partial Hash filtering in parallel
    let mut duplicate_groups: Vec<DuplicateGroup> = Vec::new();
    let mut processed_paths: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();

    let exact_groups: Vec<DuplicateGroup> = identical_size_groups
        .par_iter()
        .flat_map(|(sz, files)| {
            // Group by partial hash
            let mut partial_map: HashMap<u64, Vec<(PathBuf, u64)>> = HashMap::new();
            for (p, ts) in files {
                if let Some(h) = compute_partial_hash(p, *sz) {
                    partial_map.entry(h).or_default().push((p.clone(), *ts));
                }
            }

            let mut local_groups: Vec<DuplicateGroup> = Vec::new();
            for (_, p_files) in partial_map {
                if p_files.len() < 2 {
                    continue;
                }
                // Compute full hash
                let mut full_map: HashMap<u64, Vec<(PathBuf, u64)>> = HashMap::new();
                for (p, ts) in p_files {
                    if let Some(fh) = compute_full_hash(&p) {
                        full_map.entry(fh).or_default().push((p, ts));
                    }
                }

                for (fh, f_files) in full_map {
                    if f_files.len() >= 2 {
                        // Mark the oldest file as suggested original, others marked for deletion
                        let mut sorted_files = f_files;
                        sorted_files.sort_by_key(|(_, ts)| *ts);

                        let mut items: Vec<DuplicateFileItem> = Vec::new();
                        for (idx, (p, ts)) in sorted_files.into_iter().enumerate() {
                            let name = p
                                .file_name()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_default();
                            let parent = p
                                .parent()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_default();
                            let is_original = idx == 0;
                            items.push(DuplicateFileItem {
                                path: p.to_string_lossy().to_string(),
                                name,
                                parent_dir: parent,
                                size_bytes: *sz,
                                modified_ts: ts,
                                is_marked_for_deletion: !is_original,
                                is_suggested_original: is_original,
                            });
                        }

                        let wasted = (*sz).saturating_mul((items.len() - 1) as u64);
                        local_groups.push(DuplicateGroup {
                            group_id: format!("exact_{:x}_{}", fh, sz),
                            match_type: "exact".to_string(),
                            similarity_label: "100% Identique".to_string(),
                            shared_size_bytes: *sz,
                            wasted_bytes: wasted,
                            files: items,
                        });
                    }
                }
            }
            local_groups
        })
        .collect();

    for g in &exact_groups {
        for f in &g.files {
            processed_paths.insert(PathBuf::from(&f.path));
        }
    }
    duplicate_groups.extend(exact_groups);

    // Step 4: Similar Photos & Bursts (if requested)
    if include_similar_photos {
        let photo_candidates: Vec<(PathBuf, u64, u64)> = file_candidates
            .into_iter()
            .filter(|(p, _, _)| !processed_paths.contains(p) && is_candidate_photo(p))
            .take(1500) // Bound to prevent slow scans on massive libraries
            .collect();

        if photo_candidates.len() >= 2 {
            // Compute dHash in parallel
            let hashed_photos: Vec<(PathBuf, u64, u64, Option<u64>)> = photo_candidates
                .par_iter()
                .map(|(p, sz, ts)| {
                    let dhash = compute_photo_dhash(p);
                    (p.clone(), *sz, *ts, dhash)
                })
                .collect();

            // Cluster similar photos using dHash distance <= 8 (over 87% visual match)
            let mut matched_indices: std::collections::HashSet<usize> =
                std::collections::HashSet::new();

            for i in 0..hashed_photos.len() {
                if matched_indices.contains(&i) {
                    continue;
                }
                let (ref pi, szi, tsi, hashi) = hashed_photos[i];
                let mut cluster: Vec<(PathBuf, u64, u64, u32)> = vec![(pi.clone(), szi, tsi, 0)];

                for j in (i + 1)..hashed_photos.len() {
                    if matched_indices.contains(&j) {
                        continue;
                    }
                    let (ref pj, szj, tsj, hashj) = hashed_photos[j];

                    let is_similar = match (hashi, hashj) {
                        (Some(h1), Some(h2)) => {
                            let dist = hamming_distance(h1, h2);
                            dist <= 8
                        }
                        _ => {
                            // Fallback for RAW/HEIC: check burst proximity (same folder & within 3 seconds)
                            let same_dir = pi.parent() == pj.parent();
                            let close_time = tsi.abs_diff(tsj) <= 3;
                            let close_size = szi.abs_diff(szj) <= (szi / 8).max(1024 * 100);
                            same_dir && close_time && close_size
                        }
                    };

                    if is_similar {
                        let dist = match (hashi, hashj) {
                            (Some(h1), Some(h2)) => hamming_distance(h1, h2),
                            _ => 4,
                        };
                        cluster.push((pj.clone(), szj, tsj, dist));
                        matched_indices.insert(j);
                    }
                }

                if cluster.len() >= 2 {
                    matched_indices.insert(i);

                    // Keep largest file (highest resolution/quality) as suggested original
                    cluster.sort_by(|a, b| b.1.cmp(&a.1));

                    let avg_dist: u32 =
                        cluster.iter().map(|c| c.3).sum::<u32>() / (cluster.len() as u32).max(1);
                    let similarity_pct = (100 - (avg_dist * 100 / 64)).min(99);

                    let mut items: Vec<DuplicateFileItem> = Vec::new();
                    let mut wasted = 0u64;

                    for (idx, (p, sz, ts, _)) in cluster.into_iter().enumerate() {
                        let is_original = idx == 0;
                        if !is_original {
                            wasted = wasted.saturating_add(sz);
                        }
                        let name = p
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default();
                        let parent = p
                            .parent()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default();

                        items.push(DuplicateFileItem {
                            path: p.to_string_lossy().to_string(),
                            name,
                            parent_dir: parent,
                            size_bytes: sz,
                            modified_ts: ts,
                            is_marked_for_deletion: !is_original,
                            is_suggested_original: is_original,
                        });
                    }

                    duplicate_groups.push(DuplicateGroup {
                        group_id: format!("similar_photo_{}_{}", i, similarity_pct),
                        match_type: "similar_photo".to_string(),
                        similarity_label: format!("~{}% Similaire (Rafale)", similarity_pct),
                        shared_size_bytes: items[0].size_bytes,
                        wasted_bytes: wasted,
                        files: items,
                    });
                }
            }
        }
    }

    // Sort groups by wasted space descending (most reclaimable space first)
    duplicate_groups.sort_by(|a, b| b.wasted_bytes.cmp(&a.wasted_bytes));

    let total_wasted_bytes: u64 = duplicate_groups.iter().map(|g| g.wasted_bytes).sum();
    let total_duplicate_files: usize = duplicate_groups
        .iter()
        .map(|g| g.files.len().saturating_sub(1))
        .sum();

    Ok(DuplicateScanReport {
        target_path: target_path.to_string(),
        total_scanned_files,
        total_duplicate_groups: duplicate_groups.len(),
        total_wasted_bytes,
        total_duplicate_files,
        scan_duration_ms: start.elapsed().as_millis() as u64,
        groups: duplicate_groups,
    })
}

pub fn purge_duplicates_files(
    paths_to_delete: &[String],
    move_to_trash: bool,
) -> DuplicatePurgeReport {
    let mut deleted_files_count = 0usize;
    let mut freed_bytes = 0u64;
    let mut errors = Vec::new();

    for p_str in paths_to_delete {
        let path = Path::new(p_str);
        if !path.exists() {
            continue;
        }

        if is_protected_system_path(path) {
            errors.push(format!(
                "Suppression refusée par sécurité sur le fichier protégé : {}",
                p_str
            ));
            continue;
        }

        let sz = fs::symlink_metadata(path).map(|m| m.len()).unwrap_or(0);

        let res = if move_to_trash {
            // Move file to appropriate .Trash folder
            move_file_to_trash(path)
        } else {
            fs::remove_file(path)
        };

        match res {
            Ok(_) => {
                deleted_files_count += 1;
                freed_bytes = freed_bytes.saturating_add(sz);
            }
            Err(e) => {
                errors.push(format!("{}: {}", p_str, e));
            }
        }
    }

    DuplicatePurgeReport {
        deleted_files_count,
        freed_bytes,
        errors,
    }
}

fn move_file_to_trash(path: &Path) -> std::io::Result<()> {
    // If inside user home or external volume, locate .Trash
    let trash_dir = if let Ok(home) = std::env::var("HOME") {
        if path.starts_with(&home) {
            PathBuf::from(home).join(".Trash")
        } else {
            // Check for volume root
            path.ancestors()
                .find(|a| a.parent() == Some(Path::new("/Volumes")))
                .map(|vol| vol.join(".Trashes"))
                .unwrap_or_else(|| PathBuf::from(&home).join(".Trash"))
        }
    } else {
        return fs::remove_file(path);
    };

    if !trash_dir.exists() {
        let _ = fs::create_dir_all(&trash_dir);
    }

    let file_name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let mut dest = trash_dir.join(&file_name);
    if dest.exists() {
        let unique_name = format!("{}_{}", Local_now_stamp(), file_name);
        dest = trash_dir.join(unique_name);
    }

    // Try fs::rename first, fallback to copy+delete if crossing filesystems
    if fs::rename(path, &dest).is_err() {
        fs::copy(path, &dest)?;
        fs::remove_file(path)?;
    }
    Ok(())
}

#[allow(non_snake_case)]
fn Local_now_stamp() -> String {
    chrono::Local::now().format("%Y%m%d_%H%M%S").to_string()
}
