use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhostCategorySummary {
    pub id: String,
    pub label: String,
    pub description: String,
    pub item_count: usize,
    pub total_bytes: u64,
    pub sample_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhostScanReport {
    pub target_path: String,
    pub total_reclaimable_bytes: u64,
    pub total_items: usize,
    pub categories: Vec<GhostCategorySummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhostPurgeReport {
    pub deleted_items: usize,
    pub freed_bytes: u64,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedTestResult {
    pub target_path: String,
    pub write_mbps: f64,
    pub read_mbps: f64,
    pub tested_megabytes: usize,
    pub capability_verdict: String,
    pub is_usb2_limited: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatDriveResult {
    pub bsd_name: String,
    pub new_name: String,
    pub file_system: String,
    pub success: bool,
    pub message: String,
}

struct GhostBucket {
    items: Vec<(PathBuf, u64, bool)>, // (path, size_bytes, is_dir)
}

impl GhostBucket {
    fn new() -> Self {
        Self { items: Vec::new() }
    }
    fn add(&mut self, path: PathBuf, size: u64, is_dir: bool) {
        self.items.push((path, size, is_dir));
    }
    fn total_bytes(&self) -> u64 {
        self.items.iter().map(|(_, s, _)| *s).sum()
    }
}

fn compute_dir_size_bounded(dir: &Path, depth_left: usize) -> u64 {
    if depth_left == 0 {
        return 0;
    }
    let mut sum = 0u64;
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            if let Ok(m) = fs::symlink_metadata(e.path()) {
                if m.is_file() {
                    sum = sum.saturating_add(m.len());
                } else if m.is_dir() {
                    sum = sum.saturating_add(compute_dir_size_bounded(&e.path(), depth_left - 1));
                }
            }
        }
    }
    sum
}

fn collect_ghost_items_recursive(
    dir: &Path,
    depth: usize,
    max_depth: usize,
    apple_double: &mut GhostBucket,
    trashes: &mut GhostBucket,
    spotlight_fs: &mut GhostBucket,
    media_caches: &mut GhostBucket,
) {
    if depth > max_depth {
        return;
    }

    let rd = match fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return,
    };

    for entry in rd.flatten() {
        let p = entry.path();
        let name = match p.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let lower = name.to_lowercase();

        let meta = match fs::symlink_metadata(&p) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() {
            continue;
        }

        if depth == 0 && (name == ".Trashes" || name == ".Trash" || name == ".TemporaryItems") {
            let sz = compute_dir_size_bounded(&p, 4);
            if sz > 0 || meta.is_dir() {
                trashes.add(p, sz, true);
            }
            continue;
        }

        if depth == 0
            && (name == ".Spotlight-V100"
                || name == ".fseventsd"
                || name == ".DocumentRevisions-V100")
        {
            let sz = compute_dir_size_bounded(&p, 4);
            spotlight_fs.add(p, sz, true);
            continue;
        }

        if meta.is_file() {
            if name == ".DS_Store" || name.starts_with("._") || lower == "thumbs.db" {
                apple_double.add(p, meta.len(), false);
            }
            continue;
        }

        if meta.is_dir() {
            // Detect creative media render/cache folders
            if lower == "cacheclip"
                || lower == "render files"
                || lower == "optimized media"
                || lower == "proxy media"
                || lower == "adobe premiere pro media cache files"
                || lower == "media cache files"
                || lower == "peak files"
                || lower == "deriveddata"
            {
                let sz = compute_dir_size_bounded(&p, 4);
                if sz > 0 {
                    media_caches.add(p, sz, true);
                }
                continue;
            }

            collect_ghost_items_recursive(
                &p,
                depth + 1,
                max_depth,
                apple_double,
                trashes,
                spotlight_fs,
                media_caches,
            );
        }
    }
}

pub fn scan_ghost_and_caches(target_path: &str) -> Result<GhostScanReport, String> {
    let resolved = if target_path == "/" {
        std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
    } else {
        target_path.to_string()
    };

    let root = Path::new(&resolved);
    if !root.exists() {
        return Err(format!("Le chemin '{}' est introuvable.", resolved));
    }

    let mut apple_double = GhostBucket::new();
    let mut trashes = GhostBucket::new();
    let mut spotlight_fs = GhostBucket::new();
    let mut media_caches = GhostBucket::new();

    collect_ghost_items_recursive(
        root,
        0,
        5,
        &mut apple_double,
        &mut trashes,
        &mut spotlight_fs,
        &mut media_caches,
    );

    // If scanning user home directory, also inspect ~/.Trash and ~/Library/Caches/ top-level creative caches
    if let Ok(home) = std::env::var("HOME") {
        if resolved == home {
            let user_trash = Path::new(&home).join(".Trash");
            if user_trash.exists() {
                let sz = compute_dir_size_bounded(&user_trash, 3);
                if sz > 0 {
                    trashes.add(user_trash, sz, true);
                }
            }
            let user_caches = Path::new(&home).join("Library/Caches");
            if user_caches.exists() {
                if let Ok(rd) = fs::read_dir(&user_caches) {
                    for e in rd.flatten() {
                        let p = e.path();
                        let folder_name = p
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_lowercase();
                        if folder_name.contains("blackmagic")
                            || folder_name.contains("adobe")
                            || folder_name.contains("apple.finalcut")
                            || folder_name.contains("spotify")
                            || folder_name.contains("chrome")
                            || folder_name.contains("firefox")
                            || folder_name.contains("homebrew")
                            || folder_name.contains("pip")
                            || folder_name.contains("npm")
                        {
                            let sz = compute_dir_size_bounded(&p, 3);
                            if sz > 5 * 1024 * 1024 {
                                media_caches.add(p, sz, true);
                            }
                        }
                    }
                }
            }
        }
    }

    let mut categories = Vec::new();

    categories.push(GhostCategorySummary {
        id: "apple_double".to_string(),
        label: "Fichiers fantômes (._* & .DS_Store)".to_string(),
        description: "Fichiers invisibles macOS qui polluent les TV, clés USB, caméras et PC Windows."
            .to_string(),
        item_count: apple_double.items.len(),
        total_bytes: apple_double.total_bytes(),
        sample_paths: apple_double
            .items
            .iter()
            .take(5)
            .map(|(p, _, _)| p.to_string_lossy().to_string())
            .collect(),
    });

    categories.push(GhostCategorySummary {
        id: "trashes".to_string(),
        label: "Corbeille cachée (.Trashes & .TemporaryItems)".to_string(),
        description: "Fichiers supprimés mais toujours retenus physiquement sur le support."
            .to_string(),
        item_count: trashes.items.len(),
        total_bytes: trashes.total_bytes(),
        sample_paths: trashes
            .items
            .iter()
            .take(5)
            .map(|(p, _, _)| p.to_string_lossy().to_string())
            .collect(),
    });

    categories.push(GhostCategorySummary {
        id: "media_caches".to_string(),
        label: "Caches Vidéo, Rendus & Apps".to_string(),
        description: "Rendus temporaires (Resolve CacheClip, Final Cut Render Files, Adobe, Caches)."
            .to_string(),
        item_count: media_caches.items.len(),
        total_bytes: media_caches.total_bytes(),
        sample_paths: media_caches
            .items
            .iter()
            .take(5)
            .map(|(p, _, _)| p.to_string_lossy().to_string())
            .collect(),
    });

    categories.push(GhostCategorySummary {
        id: "spotlight_fs".to_string(),
        label: "Index Spotlight & Journaux (.Spotlight-V100 / .fseventsd)".to_string(),
        description: "Index de recherche macOS stockés à la racine du disque externe.".to_string(),
        item_count: spotlight_fs.items.len(),
        total_bytes: spotlight_fs.total_bytes(),
        sample_paths: spotlight_fs
            .items
            .iter()
            .take(5)
            .map(|(p, _, _)| p.to_string_lossy().to_string())
            .collect(),
    });

    let total_reclaimable_bytes = categories.iter().map(|c| c.total_bytes).sum();
    let total_items = categories.iter().map(|c| c.item_count).sum();

    Ok(GhostScanReport {
        target_path: resolved,
        total_reclaimable_bytes,
        total_items,
        categories,
    })
}

pub fn execute_ghost_and_cache_purge(
    target_path: &str,
    selected_categories: &[String],
) -> Result<GhostPurgeReport, String> {
    let resolved = if target_path == "/" {
        std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
    } else {
        target_path.to_string()
    };

    let root = Path::new(&resolved);
    if !root.exists() {
        return Err(format!("Le chemin '{}' est introuvable.", resolved));
    }

    let mut apple_double = GhostBucket::new();
    let mut trashes = GhostBucket::new();
    let mut spotlight_fs = GhostBucket::new();
    let mut media_caches = GhostBucket::new();

    collect_ghost_items_recursive(
        root,
        0,
        5,
        &mut apple_double,
        &mut trashes,
        &mut spotlight_fs,
        &mut media_caches,
    );

    if let Ok(home) = std::env::var("HOME") {
        if resolved == home {
            let user_trash = Path::new(&home).join(".Trash");
            if user_trash.exists() {
                let sz = compute_dir_size_bounded(&user_trash, 3);
                trashes.add(user_trash, sz, true);
            }
        }
    }

    let mut to_delete: Vec<(PathBuf, u64, bool)> = Vec::new();
    if selected_categories.iter().any(|c| c == "apple_double") {
        to_delete.extend(apple_double.items);
    }
    if selected_categories.iter().any(|c| c == "trashes") {
        to_delete.extend(trashes.items);
    }
    if selected_categories.iter().any(|c| c == "media_caches") {
        to_delete.extend(media_caches.items);
    }
    if selected_categories.iter().any(|c| c == "spotlight_fs") {
        to_delete.extend(spotlight_fs.items);
    }

    let mut deleted_items = 0usize;
    let mut freed_bytes = 0u64;
    let mut errors = Vec::new();

    for (p, sz, is_dir) in to_delete {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        // For .Trash / .Trashes, empty contents rather than failing on root permission
        if is_dir && (name == ".Trash" || name == ".Trashes") {
            if let Ok(rd) = fs::read_dir(&p) {
                for entry in rd.flatten() {
                    let ep = entry.path();
                    let _ = if ep.is_dir() {
                        fs::remove_dir_all(&ep)
                    } else {
                        fs::remove_file(&ep)
                    };
                }
                deleted_items += 1;
                freed_bytes = freed_bytes.saturating_add(sz);
            }
            continue;
        }

        let res = if is_dir {
            fs::remove_dir_all(&p)
        } else {
            fs::remove_file(&p)
        };

        match res {
            Ok(_) => {
                deleted_items += 1;
                freed_bytes = freed_bytes.saturating_add(sz);
            }
            Err(e) => {
                errors.push(format!("{}: {}", p.display(), e));
            }
        }
    }

    Ok(GhostPurgeReport {
        deleted_items,
        freed_bytes,
        errors,
    })
}

/// Hardware sequential Read/Write benchmark bypassing macOS unified RAM cache via F_NOCACHE.
pub fn run_drive_speedtest(target_path: &str) -> Result<SpeedTestResult, String> {
    let resolved = if target_path == "/" {
        std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string())
    } else {
        target_path.to_string()
    };

    let dir = Path::new(&resolved);
    if !dir.exists() {
        return Err(format!("Le support '{}' est introuvable.", resolved));
    }

    let bench_file_path = dir.join(".hardhub_speedtest_probe.tmp");
    let chunk_size: usize = 8 * 1024 * 1024; // 8 MB per chunk
    let chunks_count: usize = 8; // 64 MB total for fast, responsive real hardware probe
    let total_bytes = (chunk_size * chunks_count) as f64;
    let total_mb = (chunk_size * chunks_count) / (1024 * 1024);

    // Prepare non-trivial pattern buffer so APFS/SSD controller doesn't compress all-zeros
    let mut buffer = vec![0u8; chunk_size];
    for (i, byte) in buffer.iter_mut().enumerate() {
        *byte = ((i.wrapping_mul(31).wrapping_add(17)) & 0xFF) as u8;
    }

    // 1. Sequential Write Test with F_NOCACHE
    let write_start = Instant::now();
    {
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&bench_file_path)
            .map_err(|e| format!("Impossible d'écrire sur ce support (lecture seule ?) : {}", e))?;

        unsafe {
            libc::fcntl(file.as_raw_fd(), libc::F_NOCACHE, 1);
        }

        for _ in 0..chunks_count {
            file.write_all(&buffer).map_err(|e| {
                let _ = fs::remove_file(&bench_file_path);
                format!("Erreur d'écriture: {}", e)
            })?;
        }
        let _ = file.sync_all();
    }
    let write_secs = write_start.elapsed().as_secs_f64().max(0.001);
    let write_mbps = (total_bytes / (1024.0 * 1024.0)) / write_secs;

    // 2. Sequential Read Test with F_NOCACHE
    let read_start = Instant::now();
    {
        let mut file = OpenOptions::new()
            .read(true)
            .open(&bench_file_path)
            .map_err(|e| {
                let _ = fs::remove_file(&bench_file_path);
                format!("Erreur d'ouverture lecture: {}", e)
            })?;

        unsafe {
            libc::fcntl(file.as_raw_fd(), libc::F_NOCACHE, 1);
        }
        let _ = file.seek(SeekFrom::Start(0));

        let mut read_buf = vec![0u8; chunk_size];
        for _ in 0..chunks_count {
            file.read_exact(&mut read_buf).map_err(|e| {
                let _ = fs::remove_file(&bench_file_path);
                format!("Erreur de lecture: {}", e)
            })?;
        }
    }
    let read_secs = read_start.elapsed().as_secs_f64().max(0.001);
    let read_mbps = (total_bytes / (1024.0 * 1024.0)) / read_secs;

    // Always clean up temporary file
    let _ = fs::remove_file(&bench_file_path);

    let min_speed = write_mbps.min(read_mbps);
    let is_usb2_limited = read_mbps < 48.0 && write_mbps < 48.0;

    let capability_verdict = if is_usb2_limited {
        "Bridé USB 2.0 (< 45 Mo/s) — Vérifiez votre câble USB-C !".to_string()
    } else if min_speed >= 800.0 {
        "Ultra-Rapide NVMe / Thunderbolt — Prêt pour 8K RAW & Multi-Cam".to_string()
    } else if min_speed >= 300.0 {
        "SSD Rapide USB 3.2 — Prêt pour Montage 4K ProRes & Photo RAW".to_string()
    } else if min_speed >= 90.0 {
        "Débit Standard (HDD / Carte SD UHS-I) — Stockage & Sauvegarde".to_string()
    } else {
        "Support Lent — Usage bureautique ou archivage léger".to_string()
    };

    Ok(SpeedTestResult {
        target_path: resolved,
        write_mbps: (write_mbps * 10.0).round() / 10.0,
        read_mbps: (read_mbps * 10.0).round() / 10.0,
        tested_megabytes: total_mb,
        capability_verdict,
        is_usb2_limited,
    })
}

pub fn validate_safe_format_target(bsd_name: &str, mount_point: &str, is_removable: bool) -> Result<(), String> {
    if !is_removable {
        return Err("Sécurité HardHub : le formatage des disques internes est strictement verrouillé.".to_string());
    }
    if mount_point == "/" || mount_point.starts_with("/System") {
        return Err("Sécurité HardHub : impossible de formater le volume système.".to_string());
    }
    if bsd_name.is_empty()
        || bsd_name == "disk0"
        || bsd_name.starts_with("disk0s")
        || bsd_name == "disk1"
        || bsd_name.starts_with("disk1s")
        || bsd_name == "disk2"
        || bsd_name.starts_with("disk2s")
        || bsd_name == "disk3"
        || bsd_name.starts_with("disk3s")
    {
        return Err(format!(
            "Sécurité HardHub : le périphérique /dev/{} appartient au conteneur interne macOS.",
            bsd_name
        ));
    }
    Ok(())
}

pub fn format_external_drive(
    bsd_name: &str,
    mount_point: &str,
    is_removable: bool,
    file_system: &str,
    new_volume_name: &str,
) -> Result<FormatDriveResult, String> {
    validate_safe_format_target(bsd_name, mount_point, is_removable)?;

    let clean_name: String = new_volume_name
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-' || *c == ' ')
        .take(24)
        .collect();

    if clean_name.is_empty() {
        return Err("Veuillez saisir un nom de volume valide.".to_string());
    }

    let diskutil_fs = match file_system.to_uppercase().as_str() {
        "APFS" => "APFS",
        "EXFAT" => "ExFAT",
        "FAT32" | "MS-DOS" => "MS-DOS",
        _ => return Err(format!("Système de fichiers '{}' non supporté.", file_system)),
    };

    let dev_node = format!("/dev/{}", bsd_name);
    let output = Command::new("/usr/sbin/diskutil")
        .args(["eraseVolume", diskutil_fs, &clean_name, &dev_node])
        .output()
        .map_err(|e| format!("Échec d'exécution diskutil: {}", e))?;

    if output.status.success() {
        Ok(FormatDriveResult {
            bsd_name: bsd_name.to_string(),
            new_name: clean_name.clone(),
            file_system: diskutil_fs.to_string(),
            success: true,
            message: format!(
                "Volume formaté en {} sous le nom « {} ».",
                diskutil_fs, clean_name
            ),
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(format!(
            "Formatage refusé par macOS : {}",
            if !stderr.is_empty() { stderr } else { stdout }
        ))
    }
}
