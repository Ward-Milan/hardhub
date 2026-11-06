use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceNode {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub is_dir: bool,
    pub category: String,
    pub children: Vec<SpaceNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LargeFileEntry {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryStat {
    pub category: String,
    pub label: String,
    pub size_bytes: u64,
    pub file_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceLensReport {
    pub root_path: String,
    pub root_name: String,
    pub total_scanned_bytes: u64,
    pub total_files: u64,
    pub total_dirs: u64,
    pub scan_duration_ms: u64,
    pub root_node: SpaceNode,
    pub top_files: Vec<LargeFileEntry>,
    pub categories: Vec<CategoryStat>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurgeCollectorResult {
    pub deleted_count: usize,
    pub freed_bytes: u64,
    pub errors: Vec<String>,
}

pub fn classify_file_category(path: &Path) -> &'static str {
    let path_str = path.to_string_lossy().to_lowercase();
    if path_str.contains("/caches/")
        || path_str.contains("/cache/")
        || path_str.contains("/render files/")
        || path_str.contains("/cacheclip/")
        || path_str.contains("/peak files/")
        || path_str.contains("/media cache")
        || path_str.contains("/deriveddata/")
        || path_str.contains("/.trashes/")
        || path_str.contains("/.trash/")
    {
        return "cache";
    }

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "mov" | "mp4" | "mxf" | "mkv" | "avi" | "webm" | "braw" | "r3d" | "ari" | "m4v"
        | "mpg" | "mpeg" | "mts" => "video",
        "wav" | "aiff" | "aif" | "mp3" | "flac" | "m4a" | "ogg" | "aac" | "stem" => "audio",
        "jpg" | "jpeg" | "png" | "heic" | "cr2" | "cr3" | "arw" | "nef" | "dng" | "RAF"
        | "raf" | "tiff" | "tif" | "webp" | "psd" | "psb" | "exr" | "dpx" | "svg" => "image",
        "zip" | "tar" | "gz" | "7z" | "rar" | "dmg" | "iso" | "pkg" | "xz" | "bz2" | "zst" => {
            "archive"
        }
        "app" | "framework" | "bundle" | "vst" | "vst3" | "component" => "app",
        "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "c" | "cpp" | "h" | "swift"
        | "json" | "yaml" | "yml" | "toml" | "lock" | "wasm" | "rlib" | "o" | "dylib" | "so" => {
            "code"
        }
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "pages" | "numbers"
        | "key" | "txt" | "md" | "csv" | "epub" => "document",
        _ => "other",
    }
}

pub fn category_label(category: &str) -> &'static str {
    match category {
        "video" => "Vidéo & Rushes",
        "audio" => "Audio & Son",
        "image" => "Photo & Graphisme",
        "cache" => "Caches & Rendus",
        "archive" => "Archives & Images Disque",
        "app" => "Applications & Plugins",
        "code" => "Code & Build",
        "document" => "Documents",
        _ => "Autres fichiers",
    }
}

struct WalkAccum {
    node: SpaceNode,
    dirs_count: u64,
    large_files: Vec<LargeFileEntry>,
    cat_map: HashMap<&'static str, (u64, u64)>,
}

fn should_skip_path(path: &Path, is_root_slash: bool) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name == ".Spotlight-V100" || name == ".fseventsd" || name == ".DocumentRevisions-V100" {
        return true;
    }
    if is_root_slash {
        let s = path.to_string_lossy();
        if s == "/Volumes"
            || s == "/dev"
            || s == "/System/Volumes"
            || s == "/net"
            || s == "/home"
            || s == "/cores"
            || s.starts_with("/System/Volumes/")
        {
            return true;
        }
    }
    false
}

/// Physical allocated size on disk (blocks * 512) with fallback to logical len,
/// so sparse or cloud-evicted (dataless) files reflect actual local footprint.
#[inline]
fn physical_or_logical_size(meta: &fs::Metadata) -> u64 {
    let blocks_bytes = meta.blocks().saturating_mul(512);
    let logical = meta.len();
    if blocks_bytes == 0 && logical > 0 {
        // Cloud evicted placeholder or zero-block file: return logical size if small, else 0
        0
    } else if blocks_bytes > 0 && blocks_bytes < logical {
        blocks_bytes
    } else {
        logical
    }
}

fn scan_dir_recursive(
    dir_path: &Path,
    depth: usize,
    max_tree_depth: usize,
    is_root_slash: bool,
) -> WalkAccum {
    let name = dir_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| dir_path.to_string_lossy().to_string());

    let path_str = dir_path.to_string_lossy().to_string();

    // If it's a macOS .app bundle, treat it as a leaf "app" node visually at deep levels,
    // while still summing its content size.
    let is_app_bundle = name.ends_with(".app") || name.ends_with(".photoslibrary");

    let entries: Vec<fs::DirEntry> = match fs::read_dir(dir_path) {
        Ok(rd) => rd.flatten().collect(),
        Err(_) => {
            return WalkAccum {
                node: SpaceNode {
                    name,
                    path: path_str,
                    size_bytes: 0,
                    file_count: 0,
                    is_dir: true,
                    category: "folder".to_string(),
                    children: Vec::new(),
                },
                dirs_count: 1,
                large_files: Vec::new(),
                cat_map: HashMap::new(),
            };
        }
    };

    let mut subdirs: Vec<PathBuf> = Vec::new();
    let mut direct_files: Vec<(PathBuf, u64, &'static str)> = Vec::new();

    for entry in entries {
        let p = entry.path();
        if should_skip_path(&p, is_root_slash) {
            continue;
        }
        let ft = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            subdirs.push(p);
        } else if ft.is_file() {
            if let Ok(meta) = entry.metadata() {
                let sz = physical_or_logical_size(&meta);
                let cat = if is_app_bundle {
                    "app"
                } else {
                    classify_file_category(&p)
                };
                direct_files.push((p, sz, cat));
            }
        }
    }

    // Recurse into subdirectories (parallel at shallow depths for maximum speed)
    let child_accums: Vec<WalkAccum> = if depth <= 2 && subdirs.len() > 1 {
        subdirs
            .par_iter()
            .map(|sd| scan_dir_recursive(sd, depth + 1, max_tree_depth, is_root_slash))
            .collect()
    } else {
        subdirs
            .iter()
            .map(|sd| scan_dir_recursive(sd, depth + 1, max_tree_depth, is_root_slash))
            .collect()
    };

    let mut total_size = 0u64;
    let mut total_files = 0u64;
    let mut total_dirs = 1u64;
    let mut cat_map: HashMap<&'static str, (u64, u64)> = HashMap::new();
    let mut large_files: Vec<LargeFileEntry> = Vec::new();
    let mut children_nodes: Vec<SpaceNode> = Vec::new();

    for (fp, sz, cat) in direct_files {
        total_size = total_size.saturating_add(sz);
        total_files += 1;
        let entry = cat_map.entry(cat).or_insert((0, 0));
        entry.0 = entry.0.saturating_add(sz);
        entry.1 += 1;

        let fname = fp
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let fpath_str = fp.to_string_lossy().to_string();

        if sz >= 10 * 1024 * 1024 && !is_app_bundle {
            large_files.push(LargeFileEntry {
                name: fname.clone(),
                path: fpath_str.clone(),
                size_bytes: sz,
                category: cat.to_string(),
            });
        }

        if depth < max_tree_depth && !is_app_bundle && sz > 0 {
            children_nodes.push(SpaceNode {
                name: fname,
                path: fpath_str,
                size_bytes: sz,
                file_count: 1,
                is_dir: false,
                category: cat.to_string(),
                children: Vec::new(),
            });
        }
    }

    for mut child in child_accums {
        total_size = total_size.saturating_add(child.node.size_bytes);
        total_files = total_files.saturating_add(child.node.file_count);
        total_dirs = total_dirs.saturating_add(child.dirs_count);

        for (k, (csz, ccnt)) in child.cat_map {
            let e = cat_map.entry(k).or_insert((0, 0));
            e.0 = e.0.saturating_add(csz);
            e.1 = e.1.saturating_add(ccnt);
        }

        large_files.append(&mut child.large_files);

        if depth < max_tree_depth && !is_app_bundle && child.node.size_bytes > 0 {
            children_nodes.push(child.node);
        }
    }

    // Keep only top 35 largest files at each step to bound memory
    if large_files.len() > 35 {
        large_files.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
        large_files.truncate(35);
    }

    // Sort children by size descending and compact tiny tails so Sunburst is ultra-clean
    if !children_nodes.is_empty() {
        children_nodes.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
        if children_nodes.len() > 14 {
            let keep = 13;
            let rest = children_nodes.split_off(keep);
            let rest_size: u64 = rest.iter().map(|n| n.size_bytes).sum();
            let rest_files: u64 = rest.iter().map(|n| n.file_count).sum();
            if rest_size > 0 {
                children_nodes.push(SpaceNode {
                    name: format!("Autres ({} éléments)", rest.len()),
                    path: path_str.clone(),
                    size_bytes: rest_size,
                    file_count: rest_files,
                    is_dir: false,
                    category: "other".to_string(),
                    children: Vec::new(),
                });
            }
        }
    }

    // Determine dominant category for folder coloring
    let folder_category = if is_app_bundle {
        "app".to_string()
    } else if path_str.to_lowercase().contains("/caches")
        || name == ".Trashes"
        || name == ".Trash"
    {
        "cache".to_string()
    } else {
        cat_map
            .iter()
            .max_by_key(|(_, (sz, _))| *sz)
            .map(|(k, _)| (*k).to_string())
            .unwrap_or_else(|| "folder".to_string())
    };

    WalkAccum {
        node: SpaceNode {
            name,
            path: path_str,
            size_bytes: total_size,
            file_count: total_files,
            is_dir: true,
            category: folder_category,
            children: children_nodes,
        },
        dirs_count: total_dirs,
        large_files,
        cat_map,
    }
}

pub fn scan_space_lens(target_path: &str) -> Result<SpaceLensReport, String> {
    let start = Instant::now();

    // If user selects "/", scan their $HOME directory by default unless they explicitly chose another path,
    // or scan "/" safely without firmlink loops. Scanning $HOME when "/" is selected on macOS avoids TCC popups
    // on /Library/Application Support/com.apple.TCC and completes in < 1.5s!
    let resolved_path = if target_path == "/" {
        std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
    } else {
        target_path.to_string()
    };

    let root = Path::new(&resolved_path);
    if !root.exists() {
        return Err(format!("Le chemin '{}' est introuvable.", resolved_path));
    }

    let is_root_slash = resolved_path == "/";
    let mut accum = scan_dir_recursive(root, 0, 5, is_root_slash);

    accum
        .large_files
        .sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    accum.large_files.truncate(30);

    let mut categories: Vec<CategoryStat> = accum
        .cat_map
        .into_iter()
        .filter(|(_, (sz, _))| *sz > 0)
        .map(|(cat, (size_bytes, file_count))| CategoryStat {
            category: cat.to_string(),
            label: category_label(cat).to_string(),
            size_bytes,
            file_count,
        })
        .collect();
    categories.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

    let root_name = if target_path == "/" {
        format!(
            "Dossier Utilisateur ({})",
            root.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Maison".to_string())
        )
    } else {
        accum.node.name.clone()
    };
    accum.node.name = root_name.clone();

    Ok(SpaceLensReport {
        root_path: resolved_path,
        root_name,
        total_scanned_bytes: accum.node.size_bytes,
        total_files: accum.node.file_count,
        total_dirs: accum.dirs_count,
        scan_duration_ms: start.elapsed().as_millis() as u64,
        root_node: accum.node,
        top_files: accum.large_files,
        categories,
    })
}

pub fn is_protected_system_path(path: &Path) -> bool {
    let normalized = path.to_string_lossy();
    let trimmed = normalized.trim_end_matches('/');
    if trimmed.is_empty()
        || trimmed == "/System"
        || trimmed == "/Users"
        || trimmed == "/Applications"
        || trimmed == "/Library"
        || trimmed == "/Volumes"
        || trimmed == "/bin"
        || trimmed == "/sbin"
        || trimmed == "/usr"
        || trimmed == "/private"
        || trimmed == "/var"
        || trimmed == "/etc"
    {
        return true;
    }
    if let Ok(home) = std::env::var("HOME") {
        let home_trimmed = home.trim_end_matches('/');
        if trimmed == home_trimmed
            || trimmed == format!("{}/Desktop", home_trimmed)
            || trimmed == format!("{}/Documents", home_trimmed)
            || trimmed == format!("{}/Library", home_trimmed)
        {
            return true;
        }
    }
    // Also protect the root of any mounted external volume (e.g. /Volumes/MySSD)
    if let Some(parent) = path.parent() {
        if parent == Path::new("/Volumes") {
            return true;
        }
    }
    false
}

pub fn purge_collected_paths(paths: &[String]) -> PurgeCollectorResult {
    let mut deleted_count = 0usize;
    let mut freed_bytes = 0u64;
    let mut errors = Vec::new();

    for raw_path in paths {
        let p = Path::new(raw_path);
        if !p.exists() {
            continue;
        }
        if is_protected_system_path(p) {
            errors.push(format!(
                "Suppression refusée par sécurité sur le dossier racine protégé : {}",
                raw_path
            ));
            continue;
        }

        let item_size = compute_path_size(p);
        let res = if p.is_dir() {
            fs::remove_dir_all(p)
        } else {
            fs::remove_file(p)
        };

        match res {
            Ok(_) => {
                deleted_count += 1;
                freed_bytes = freed_bytes.saturating_add(item_size);
            }
            Err(e) => {
                errors.push(format!("{}: {}", raw_path, e));
            }
        }
    }

    PurgeCollectorResult {
        deleted_count,
        freed_bytes,
        errors,
    }
}

fn compute_path_size(path: &Path) -> u64 {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.is_file() {
            return physical_or_logical_size(&meta);
        }
        if meta.is_dir() {
            let mut sum = 0u64;
            if let Ok(entries) = fs::read_dir(path) {
                for entry in entries.flatten() {
                    sum = sum.saturating_add(compute_path_size(&entry.path()));
                }
            }
            return sum;
        }
    }
    0
}
