use plist::Value;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;
use sysinfo::System;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppResidualItem {
    pub path: String,
    pub label: String,
    pub category: String, // "app_bundle" | "app_support" | "caches" | "containers" | "preferences" | "logs"
    pub size_bytes: u64,
    pub is_dir: bool,
    pub is_selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAppSummary {
    pub id: String,
    pub name: String,
    pub bundle_id: String,
    pub version: String,
    pub app_path: String,
    pub app_size_bytes: u64,
    pub total_footprint_bytes: u64,
    pub residuals_count: usize,
    pub is_system_protected: bool,
    pub is_running: bool,
    pub last_modified: u64,
    pub icon_data_url: Option<String>,
}

extern "C" {
    fn extract_mac_app_icon_png(
        app_path: *const std::os::raw::c_char,
        out_png_path: *const std::os::raw::c_char,
    ) -> std::os::raw::c_int;
}

fn to_base64(data: &[u8]) -> String {
    const CHARSET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARSET[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARSET[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARSET[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARSET[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

pub fn get_or_extract_app_icon(app_path: &str, app_id: &str) -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let icon_dir = Path::new(&home).join(".hardhub").join("app_icons");
    let _ = fs::create_dir_all(&icon_dir);

    let clean_id = app_id.replace(['/', ':', ' '], "_");
    let out_png = icon_dir.join(format!("{}.png", clean_id));

    if !out_png.exists() {
        use std::ffi::CString;
        let c_app = CString::new(app_path).ok()?;
        let c_out = CString::new(out_png.to_string_lossy().as_ref()).ok()?;
        let res = unsafe { extract_mac_app_icon_png(c_app.as_ptr(), c_out.as_ptr()) };
        if res != 0 {
            return None;
        }
    }

    if let Ok(bytes) = fs::read(&out_png) {
        if !bytes.is_empty() {
            return Some(format!("data:image/png;base64,{}", to_base64(&bytes)));
        }
    }
    None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDetails {
    pub app: InstalledAppSummary,
    pub items: Vec<AppResidualItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallReport {
    pub app_name: String,
    pub deleted_items_count: usize,
    pub freed_bytes: u64,
    pub errors: Vec<String>,
}

fn compute_path_size_fast(path: &Path, max_depth: usize) -> u64 {
    if max_depth == 0 {
        return 0;
    }
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.is_file() {
            return meta.len();
        }
        if meta.is_dir() {
            let mut sum = 0u64;
            if let Ok(rd) = fs::read_dir(path) {
                for entry in rd.flatten() {
                    let ep = entry.path();
                    if let Ok(emeta) = entry.metadata() {
                        if emeta.is_file() {
                            sum = sum.saturating_add(emeta.len());
                        } else if emeta.is_dir() {
                            sum = sum.saturating_add(compute_path_size_fast(&ep, max_depth - 1));
                        }
                    }
                }
            }
            return sum;
        }
    }
    0
}

fn is_system_protected_app(path: &Path, bundle_id: &str) -> bool {
    let p_str = path.to_string_lossy();
    if p_str.starts_with("/System")
        || p_str.starts_with("/System/Applications")
        || p_str.starts_with("/System/Library")
    {
        return true;
    }

    let b_lower = bundle_id.to_lowercase();
    matches!(
        b_lower.as_str(),
        "com.apple.finder"
            | "com.apple.safari"
            | "com.apple.systempreferences"
            | "com.apple.systemsettings"
            | "com.apple.appstore"
            | "com.apple.terminal"
            | "com.apple.activitymonitor"
            | "com.apple.keychainaccess"
            | "com.apple.diskutility"
    )
}

fn parse_app_info_plist(app_path: &Path) -> (String, String, String) {
    let plist_path = app_path.join("Contents/Info.plist");
    let folder_name = app_path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Application".to_string());

    if let Ok(val) = Value::from_file(&plist_path) {
        let name = val
            .as_dictionary()
            .and_then(|d| {
                d.get("CFBundleDisplayName")
                    .or_else(|| d.get("CFBundleName"))
                    .and_then(|v| v.as_string())
            })
            .map(|s| s.to_string())
            .unwrap_or_else(|| folder_name.clone());

        let bundle_id = val
            .as_dictionary()
            .and_then(|d| d.get("CFBundleIdentifier").and_then(|v| v.as_string()))
            .map(|s| s.to_string())
            .unwrap_or_default();

        let version = val
            .as_dictionary()
            .and_then(|d| {
                d.get("CFBundleShortVersionString")
                    .or_else(|| d.get("CFBundleVersion"))
                    .and_then(|v| v.as_string())
            })
            .map(|s| s.to_string())
            .unwrap_or_else(|| "1.0".to_string());

        (name, bundle_id, version)
    } else {
        (folder_name, String::new(), "1.0".to_string())
    }
}

pub fn scan_installed_applications() -> Vec<InstalledAppSummary> {
    let mut search_dirs = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/Applications/Utilities"),
    ];

    if let Ok(home) = std::env::var("HOME") {
        let user_apps = PathBuf::from(&home).join("Applications");
        if user_apps.exists() {
            search_dirs.push(user_apps);
        }
    }

    let mut app_paths: Vec<PathBuf> = Vec::new();
    for dir in search_dirs {
        if let Ok(rd) = fs::read_dir(&dir) {
            for entry in rd.flatten() {
                let p = entry.path();
                if p.is_dir() && p.extension().and_then(|e| e.to_str()) == Some("app") {
                    app_paths.push(p);
                }
            }
        }
    }

    // Check running processes once
    let sys = System::new_all();
    let running_exes: Vec<String> = sys
        .processes()
        .values()
        .filter_map(|proc| proc.exe().and_then(|e| e.to_str()).map(|s| s.to_string()))
        .collect();

    // Inspect each app in parallel
    let mut list: Vec<InstalledAppSummary> = app_paths
        .par_iter()
        .filter_map(|app_path| {
            let (name, bundle_id, version) = parse_app_info_plist(app_path);
            let is_system_protected = is_system_protected_app(app_path, &bundle_id);

            let meta = app_path.metadata().ok()?;
            let last_modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            let app_size_bytes = compute_path_size_fast(app_path, 4);
            let app_path_str = app_path.to_string_lossy().to_string();

            // Quick residuals probe to calculate total footprint
            let residuals = find_app_residuals(app_path, &name, &bundle_id);
            let residuals_size: u64 = residuals.iter().map(|r| r.size_bytes).sum();
            let total_footprint_bytes = app_size_bytes.saturating_add(residuals_size);

            let is_running = running_exes.iter().any(|exe| exe.starts_with(&app_path_str));

            let id = format!("{}_{}", name, bundle_id);
            let icon_data_url = get_or_extract_app_icon(&app_path_str, &id);

            Some(InstalledAppSummary {
                id,
                name,
                bundle_id,
                version,
                app_path: app_path_str,
                app_size_bytes,
                total_footprint_bytes,
                residuals_count: residuals.len(),
                is_system_protected,
                is_running,
                last_modified,
                icon_data_url,
            })
        })
        .collect();

    // Sort by largest footprint first
    list.sort_by(|a, b| b.total_footprint_bytes.cmp(&a.total_footprint_bytes));
    list
}

fn collect_matching_residuals(
    parent: &Path,
    category: &str,
    label_prefix: &str,
    app_path: &Path,
    name_lower: &str,
    bundle_lower: &str,
    items: &mut Vec<AppResidualItem>,
) {
    if !parent.exists() {
        return;
    }
    if let Ok(rd) = fs::read_dir(parent) {
        for entry in rd.flatten() {
            let p = entry.path();
            let fname = match p.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            let f_lower = fname.to_lowercase();

            let is_match = (!bundle_lower.is_empty() && f_lower.contains(bundle_lower))
                || (!name_lower.is_empty()
                    && (f_lower == name_lower
                        || f_lower.starts_with(&format!("{}.", name_lower))
                        || f_lower.starts_with(&format!("{}_", name_lower))));

            if is_match && p != app_path {
                let sz = compute_path_size_fast(&p, 4);
                let is_dir = p.is_dir();
                items.push(AppResidualItem {
                    path: p.to_string_lossy().to_string(),
                    label: format!("{} ({})", label_prefix, fname),
                    category: category.to_string(),
                    size_bytes: sz,
                    is_dir,
                    is_selected: true,
                });
            }
        }
    }
}

pub fn find_app_residuals(app_path: &Path, name: &str, bundle_id: &str) -> Vec<AppResidualItem> {
    let mut items = Vec::new();

    let home = match std::env::var("HOME") {
        Ok(h) => PathBuf::from(h),
        Err(_) => return items,
    };

    let name_lower = name.to_lowercase();
    let bundle_lower = bundle_id.to_lowercase();

    // 1. Application Support (~/Library/Application Support)
    collect_matching_residuals(
        &home.join("Library/Application Support"),
        "app_support",
        "Données & Profils",
        app_path,
        &name_lower,
        &bundle_lower,
        &mut items,
    );

    // 2. Caches (~/Library/Caches)
    collect_matching_residuals(
        &home.join("Library/Caches"),
        "caches",
        "Caches & WebKit",
        app_path,
        &name_lower,
        &bundle_lower,
        &mut items,
    );

    // 3. Containers (~/Library/Containers)
    collect_matching_residuals(
        &home.join("Library/Containers"),
        "containers",
        "Conteneur Sandbox",
        app_path,
        &name_lower,
        &bundle_lower,
        &mut items,
    );

    // 4. Group Containers (~/Library/Group Containers)
    collect_matching_residuals(
        &home.join("Library/Group Containers"),
        "containers",
        "Group Containers",
        app_path,
        &name_lower,
        &bundle_lower,
        &mut items,
    );

    // 5. Saved Application State (~/Library/Saved Application State)
    collect_matching_residuals(
        &home.join("Library/Saved Application State"),
        "preferences",
        "État de session",
        app_path,
        &name_lower,
        &bundle_lower,
        &mut items,
    );

    // 6. Preferences (~/Library/Preferences)
    if !bundle_id.is_empty() {
        let pref_file = home
            .join("Library/Preferences")
            .join(format!("{}.plist", bundle_id));
        if pref_file.exists() {
            let sz = pref_file.metadata().map(|m| m.len()).unwrap_or(0);
            items.push(AppResidualItem {
                path: pref_file.to_string_lossy().to_string(),
                label: format!("Préférences ({}.plist)", bundle_id),
                category: "preferences".to_string(),
                size_bytes: sz,
                is_dir: false,
                is_selected: true,
            });
        }
    }

    // 7. Logs (~/Library/Logs)
    collect_matching_residuals(
        &home.join("Library/Logs"),
        "logs",
        "Journaux d'erreurs",
        app_path,
        &name_lower,
        &bundle_lower,
        &mut items,
    );

    // 8. HTTPStorages & WebKit
    collect_matching_residuals(
        &home.join("Library/HTTPStorages"),
        "caches",
        "Stockage HTTP",
        app_path,
        &name_lower,
        &bundle_lower,
        &mut items,
    );
    collect_matching_residuals(
        &home.join("Library/WebKit"),
        "caches",
        "Données WebKit",
        app_path,
        &name_lower,
        &bundle_lower,
        &mut items,
    );

    // Sort items: largest first
    items.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    items
}

pub fn get_app_details(app_path: &str) -> Result<AppDetails, String> {
    let p = Path::new(app_path);
    if !p.exists() {
        return Err(format!("L'application '{}' est introuvable.", app_path));
    }

    let (name, bundle_id, version) = parse_app_info_plist(p);
    let is_system_protected = is_system_protected_app(p, &bundle_id);
    let app_size_bytes = compute_path_size_fast(p, 4);

    let meta = p.metadata().map_err(|e| e.to_string())?;
    let last_modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let sys = System::new_all();
    let is_running = sys
        .processes()
        .values()
        .filter_map(|proc| proc.exe().and_then(|e| e.to_str()))
        .any(|exe| exe.starts_with(app_path));

    let residuals = find_app_residuals(p, &name, &bundle_id);
    let residuals_size: u64 = residuals.iter().map(|r| r.size_bytes).sum();
    let total_footprint_bytes = app_size_bytes.saturating_add(residuals_size);

    let mut all_items = Vec::new();
    // App Bundle itself is the main item
    all_items.push(AppResidualItem {
        path: app_path.to_string(),
        label: format!("Application (.app) — {}", name),
        category: "app_bundle".to_string(),
        size_bytes: app_size_bytes,
        is_dir: true,
        is_selected: true,
    });
    all_items.extend(residuals);

    let id = format!("{}_{}", name, bundle_id);
    let icon_data_url = get_or_extract_app_icon(app_path, &id);

    let summary = InstalledAppSummary {
        id,
        name,
        bundle_id,
        version,
        app_path: app_path.to_string(),
        app_size_bytes,
        total_footprint_bytes,
        residuals_count: all_items.len() - 1,
        is_system_protected,
        is_running,
        last_modified,
        icon_data_url,
    };

    Ok(AppDetails {
        app: summary,
        items: all_items,
    })
}

pub fn quit_running_app(app_path: &str) -> Result<(), String> {
    let sys = System::new_all();
    let mut found = false;
    for (pid, proc) in sys.processes() {
        if let Some(exe) = proc.exe().and_then(|e| e.to_str()) {
            if exe.starts_with(app_path) {
                let _ = Command::new("kill")
                    .arg("-15")
                    .arg(pid.to_string())
                    .output();
                found = true;
            }
        }
    }
    if !found {
        return Ok(());
    }
    // Give macOS 500ms to terminate
    std::thread::sleep(std::time::Duration::from_millis(500));
    Ok(())
}

pub fn uninstall_app_items(
    app_path: &str,
    paths_to_delete: &[String],
    move_to_trash: bool,
) -> UninstallReport {
    let mut deleted_items_count = 0usize;
    let mut freed_bytes = 0u64;
    let mut errors = Vec::new();

    let p = Path::new(app_path);
    let app_name = p
        .file_stem()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Application".to_string());

    // Quit if running
    let _ = quit_running_app(app_path);

    let trash_dir = std::env::var("HOME")
        .ok()
        .map(|h| PathBuf::from(h).join(".Trash"));

    for item_str in paths_to_delete {
        let item_path = Path::new(item_str);
        if !item_path.exists() {
            continue;
        }

        // System protection
        if item_str.starts_with("/System") || item_str == "/Applications" || item_str == "/" {
            errors.push(format!("Suppression interdite sur le système : {}", item_str));
            continue;
        }

        let item_size = compute_path_size_fast(item_path, 4);

        let res = if move_to_trash && trash_dir.is_some() {
            let t_dir = trash_dir.as_ref().unwrap();
            let fname = item_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let mut dest = t_dir.join(&fname);
            if dest.exists() {
                dest = t_dir.join(format!("{}_{}", chrono::Local::now().format("%Y%m%d_%H%M%S"), fname));
            }
            if fs::rename(item_path, &dest).is_err() {
                if item_path.is_dir() {
                    fs::remove_dir_all(item_path)
                } else {
                    fs::remove_file(item_path)
                }
            } else {
                Ok(())
            }
        } else if item_path.is_dir() {
            fs::remove_dir_all(item_path)
        } else {
            fs::remove_file(item_path)
        };

        match res {
            Ok(_) => {
                deleted_items_count += 1;
                freed_bytes = freed_bytes.saturating_add(item_size);
            }
            Err(e) => {
                errors.push(format!("{}: {}", item_str, e));
            }
        }
    }

    UninstallReport {
        app_name,
        deleted_items_count,
        freed_bytes,
        errors,
    }
}
