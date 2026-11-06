pub mod catalog;
pub mod drives;
pub mod duplicates;
pub mod eject_doctor;
pub mod flash_detector;
pub mod large_files;
pub mod partitioner;
pub mod space_lens;
pub mod snapshots;
pub mod ssd_health;
pub mod system_cleaner;
pub mod tools;
pub mod tray;
pub mod uninstaller;
pub mod updater;

use catalog::{
    browse_snapshot_directory, delete_catalog_snapshot, index_volume_snapshot,
    list_catalog_summaries, search_across_catalog, CatalogEntry, CatalogSearchResult,
    CatalogVolumeSummary,
};
use drives::{list_all_storage_drives, StorageDriveInfo};
use duplicates::{
    purge_duplicates_files, scan_duplicates, DuplicatePurgeReport, DuplicateScanReport,
};
use eject_doctor::{
    inspect_blocking_processes, safe_force_eject_drive, BlockingProcessInfo, EjectReport,
};
use partitioner::{
    add_apfs_volume, delete_apfs_volume, encrypt_apfs_volume, list_apfs_containers, split_dual_partition,
    AddVolumeRequest, ApfsContainerInfo, PartitionActionResult, SplitPartitionRequest,
};
use serde::{Deserialize, Serialize};
use snapshots::{
    delete_single_snapshot, list_volume_snapshots, thin_and_purge_all_snapshots,
    SnapshotPurgeResult, SnapshotReport,
};
use space_lens::{
    purge_collected_paths, scan_space_lens, PurgeCollectorResult, SpaceLensReport,
};
use std::fs;
use std::path::Path;
use std::process::Command;
use system_cleaner::{
    purge_system_ghost_items, scan_system_ghost_cleaner, SystemGhostPurgeReport, SystemGhostReport,
};
use tools::{
    execute_ghost_and_cache_purge, format_external_drive, run_drive_speedtest,
    scan_ghost_and_caches, FormatDriveResult, GhostPurgeReport, GhostScanReport, SpeedTestResult,
};
use uninstaller::{
    get_app_details, quit_running_app, scan_installed_applications, uninstall_app_items,
    AppDetails, InstalledAppSummary, UninstallReport,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickPreset {
    pub label: String,
    pub path: String,
}

#[tauri::command]
fn get_storage_drives() -> Result<Vec<StorageDriveInfo>, String> {
    Ok(list_all_storage_drives())
}

#[tauri::command]
fn get_quick_scan_presets() -> Result<Vec<QuickPreset>, String> {
    let mut presets = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        presets.push(QuickPreset {
            label: "Dossier Utilisateur (~)".to_string(),
            path: home.clone(),
        });
        let downloads = format!("{}/Downloads", home);
        if Path::new(&downloads).exists() {
            presets.push(QuickPreset {
                label: "Téléchargements".to_string(),
                path: downloads,
            });
        }
        let caches = format!("{}/Library/Caches", home);
        if Path::new(&caches).exists() {
            presets.push(QuickPreset {
                label: "Caches (~/Library/Caches)".to_string(),
                path: caches,
            });
        }
        let movies = format!("{}/Movies", home);
        if Path::new(&movies).exists() {
            presets.push(QuickPreset {
                label: "Vidéos & Projets (~/Movies)".to_string(),
                path: movies,
            });
        }
    }
    presets.push(QuickPreset {
        label: "Applications (/Applications)".to_string(),
        path: "/Applications".to_string(),
    });
    Ok(presets)
}

#[tauri::command]
async fn scan_space_lens_cmd(target_path: String) -> Result<SpaceLensReport, String> {
    tokio::task::spawn_blocking(move || scan_space_lens(&target_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn purge_space_collector(paths: Vec<String>) -> Result<PurgeCollectorResult, String> {
    tokio::task::spawn_blocking(move || Ok(purge_collected_paths(&paths)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn list_catalog_volumes() -> Result<Vec<CatalogVolumeSummary>, String> {
    list_catalog_summaries()
}

#[tauri::command]
async fn index_volume_to_catalog(
    mount_point: String,
    volume_name: String,
    device_type: String,
    file_system: String,
    total_bytes: u64,
    used_bytes: u64,
    available_bytes: u64,
) -> Result<CatalogVolumeSummary, String> {
    tokio::task::spawn_blocking(move || {
        index_volume_snapshot(
            &mount_point,
            &volume_name,
            &device_type,
            &file_system,
            total_bytes,
            used_bytes,
            available_bytes,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn browse_catalog_volume(
    volume_id: String,
    parent_rel_path: String,
) -> Result<Vec<CatalogEntry>, String> {
    browse_snapshot_directory(&volume_id, &parent_rel_path)
}

#[tauri::command]
fn search_offline_catalog(
    query: String,
    volume_filter: Option<String>,
    category_filter: Option<String>,
) -> Result<Vec<CatalogSearchResult>, String> {
    search_across_catalog(
        &query,
        volume_filter.as_deref(),
        category_filter.as_deref(),
    )
}

#[tauri::command]
fn delete_catalog_volume(volume_id: String) -> Result<(), String> {
    delete_catalog_snapshot(&volume_id)
}

#[tauri::command]
async fn scan_ghost_cleaner(target_path: String) -> Result<GhostScanReport, String> {
    tokio::task::spawn_blocking(move || scan_ghost_and_caches(&target_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn purge_ghost_cleaner(
    target_path: String,
    selected_categories: Vec<String>,
) -> Result<GhostPurgeReport, String> {
    tokio::task::spawn_blocking(move || {
        execute_ghost_and_cache_purge(&target_path, &selected_categories)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn run_hardware_speedtest(target_path: String) -> Result<SpeedTestResult, String> {
    tokio::task::spawn_blocking(move || run_drive_speedtest(&target_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn format_removable_drive(
    bsd_name: String,
    mount_point: String,
    is_removable: bool,
    file_system: String,
    new_volume_name: String,
) -> Result<FormatDriveResult, String> {
    tokio::task::spawn_blocking(move || {
        format_external_drive(
            &bsd_name,
            &mount_point,
            is_removable,
            &file_system,
            &new_volume_name,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scan_duplicates_cmd(
    target_path: String,
    include_similar_photos: bool,
    min_size_bytes: u64,
) -> Result<DuplicateScanReport, String> {
    tokio::task::spawn_blocking(move || {
        scan_duplicates(&target_path, include_similar_photos, min_size_bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn purge_duplicates_cmd(
    paths_to_delete: Vec<String>,
    move_to_trash: bool,
) -> Result<DuplicatePurgeReport, String> {
    tokio::task::spawn_blocking(move || Ok(purge_duplicates_files(&paths_to_delete, move_to_trash)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_installed_apps() -> Result<Vec<InstalledAppSummary>, String> {
    tokio::task::spawn_blocking(scan_installed_applications)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_app_uninstall_details(app_path: String) -> Result<AppDetails, String> {
    tokio::task::spawn_blocking(move || get_app_details(&app_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn quit_app_cmd(app_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || quit_running_app(&app_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn uninstall_app_cmd(
    app_path: String,
    paths_to_delete: Vec<String>,
    move_to_trash: bool,
) -> Result<UninstallReport, String> {
    tokio::task::spawn_blocking(move || Ok(uninstall_app_items(&app_path, &paths_to_delete, move_to_trash)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_volume_snapshots_cmd(mount_point: String) -> Result<SnapshotReport, String> {
    tokio::task::spawn_blocking(move || list_volume_snapshots(&mount_point))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_single_snapshot_cmd(
    mount_point: String,
    name: String,
    uuid: String,
) -> Result<SnapshotPurgeResult, String> {
    tokio::task::spawn_blocking(move || delete_single_snapshot(&mount_point, &name, &uuid))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn thin_and_purge_all_snapshots_cmd(mount_point: String) -> Result<SnapshotPurgeResult, String> {
    tokio::task::spawn_blocking(move || thin_and_purge_all_snapshots(&mount_point))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_apfs_containers_cmd() -> Result<Vec<ApfsContainerInfo>, String> {
    tokio::task::spawn_blocking(list_apfs_containers)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn add_apfs_volume_cmd(req: AddVolumeRequest) -> Result<PartitionActionResult, String> {
    tokio::task::spawn_blocking(move || add_apfs_volume(req))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_apfs_volume_cmd(
    bsd_name: String,
    mount_point: String,
) -> Result<PartitionActionResult, String> {
    tokio::task::spawn_blocking(move || delete_apfs_volume(&bsd_name, &mount_point))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn split_dual_partition_cmd(
    req: SplitPartitionRequest,
) -> Result<PartitionActionResult, String> {
    tokio::task::spawn_blocking(move || split_dual_partition(req))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn run_flash_test_cmd(
    app: tauri::AppHandle,
    mount_point: String,
    target_mb: u64,
    is_removable: bool,
) -> Result<flash_detector::FlashTestResult, String> {
    tokio::task::spawn_blocking(move || {
        flash_detector::run_flash_integrity_probe(&app, &mount_point, target_mb, is_removable)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_ssd_health_cmd(bsd_name: String) -> Result<ssd_health::SsdHealthReport, String> {
    tokio::task::spawn_blocking(move || ssd_health::get_disk_health(&bsd_name))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scan_large_files_cmd(
    target_path: String,
    min_size_bytes: u64,
) -> Result<large_files::LargeFilesReport, String> {
    tokio::task::spawn_blocking(move || {
        large_files::scan_large_and_old_files(&target_path, min_size_bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn purge_large_files_cmd(
    paths_to_delete: Vec<String>,
    move_to_trash: bool,
) -> Result<large_files::LargeFilesPurgeReport, String> {
    tokio::task::spawn_blocking(move || {
        Ok(large_files::purge_large_files_list(&paths_to_delete, move_to_trash))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn check_drive_blockers(mount_point: String) -> Result<Vec<BlockingProcessInfo>, String> {
    Ok(inspect_blocking_processes(&mount_point))
}

#[tauri::command]
fn safe_eject_drive(
    mount_point: String,
    drive_name: String,
    kill_blockers: bool,
) -> Result<EjectReport, String> {
    safe_force_eject_drive(&mount_point, &drive_name, kill_blockers)
}

#[tauri::command]
fn eject_all_external_drives() -> Result<Vec<EjectReport>, String> {
    let drives = list_all_storage_drives();
    let mut reports = Vec::new();
    for d in drives {
        if d.is_removable && !d.is_cloud && d.mount_point != "/" {
            match safe_force_eject_drive(&d.mount_point, &d.name, true) {
                Ok(rep) => reports.push(rep),
                Err(err) => reports.push(EjectReport {
                    mount_point: d.mount_point,
                    drive_name: d.name,
                    success: false,
                    killed_processes: Vec::new(),
                    message: err,
                }),
            }
        }
    }
    Ok(reports)
}

#[tauri::command]
fn quick_purge_drive_trash(mount_point: String) -> Result<u64, String> {
    let target = if mount_point == "/" {
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        Path::new(&home).join(".Trash")
    } else {
        Path::new(&mount_point).join(".Trashes")
    };

    if !target.exists() {
        return Ok(0);
    }

    let mut freed_bytes = 0u64;
    if let Ok(entries) = fs::read_dir(&target) {
        for entry in entries.flatten() {
            let p = entry.path();
            if let Ok(meta) = entry.metadata() {
                freed_bytes += meta.len();
            }
            if p.is_dir() {
                let _ = fs::remove_dir_all(&p);
            } else {
                let _ = fs::remove_file(&p);
            }
        }
    }
    Ok(freed_bytes)
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let mut cmd = Command::new("/usr/bin/open");
    if p.is_file() {
        cmd.arg("-R").arg(&path);
    } else {
        cmd.arg(&path);
    }
    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn scan_system_ghost_cmd() -> Result<SystemGhostReport, String> {
    tokio::task::spawn_blocking(scan_system_ghost_cleaner)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn purge_system_ghost_cmd(ids: Vec<String>) -> Result<SystemGhostPurgeReport, String> {
    tokio::task::spawn_blocking(move || purge_system_ghost_items(ids))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn encrypt_external_volume_cmd(
    bsd_name: String,
    passphrase: String,
) -> Result<PartitionActionResult, String> {
    encrypt_apfs_volume(&bsd_name, &passphrase)
}

#[tauri::command]
fn refresh_tray_menu_cmd(app: tauri::AppHandle) -> Result<(), String> {
    tray::refresh_tray(&app).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let _ = tray::setup_tray(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_storage_drives,
            get_quick_scan_presets,
            scan_space_lens_cmd,
            purge_space_collector,
            list_catalog_volumes,
            index_volume_to_catalog,
            browse_catalog_volume,
            search_offline_catalog,
            delete_catalog_volume,
            scan_ghost_cleaner,
            purge_ghost_cleaner,
            run_hardware_speedtest,
            format_removable_drive,
            scan_duplicates_cmd,
            purge_duplicates_cmd,
            list_installed_apps,
            get_app_uninstall_details,
            quit_app_cmd,
            uninstall_app_cmd,
            list_volume_snapshots_cmd,
            delete_single_snapshot_cmd,
            thin_and_purge_all_snapshots_cmd,
            list_apfs_containers_cmd,
            add_apfs_volume_cmd,
            delete_apfs_volume_cmd,
            split_dual_partition_cmd,
            run_flash_test_cmd,
            get_ssd_health_cmd,
            scan_large_files_cmd,
            purge_large_files_cmd,
            check_drive_blockers,
            safe_eject_drive,
            eject_all_external_drives,
            quick_purge_drive_trash,
            reveal_in_finder,
            scan_system_ghost_cmd,
            purge_system_ghost_cmd,
            encrypt_external_volume_cmd,
            refresh_tray_menu_cmd,
            updater::check_for_updates,
            updater::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running HardHub application");
}

#[cfg(test)]
mod tests {
    use super::catalog::{
        browse_snapshot_directory, delete_catalog_snapshot, index_volume_snapshot,
        make_volume_slug, search_across_catalog,
    };
    use super::drives::evaluate_link_speed;
    use super::eject_doctor::parse_lsof_machine_output;
    use super::space_lens::{classify_file_category, is_protected_system_path, scan_space_lens};
    use super::tools::{scan_ghost_and_caches, validate_safe_format_target};
    use std::collections::HashMap;
    use std::path::Path;

    #[test]
    fn test_usb2_cable_bottleneck_detection() {
        let mut speeds = HashMap::new();
        speeds.insert("disk4".to_string(), 480);

        let (label, mbps, bottlenecked, warning) =
            evaluate_link_speed("USB", "external_ssd", "disk4s1", &speeds);
        assert_eq!(mbps, 480);
        assert!(bottlenecked);
        assert!(label.contains("Bridé"));
        assert!(warning.is_some());
    }

    #[test]
    fn test_fast_usb32_link_detection() {
        let mut speeds = HashMap::new();
        speeds.insert("disk5".to_string(), 10000);

        let (label, mbps, bottlenecked, warning) =
            evaluate_link_speed("USB", "external_ssd", "disk5s1", &speeds);
        assert_eq!(mbps, 10000);
        assert!(!bottlenecked);
        assert!(label.contains("10 Gbps"));
        assert!(warning.is_none());
    }

    #[test]
    fn test_parse_lsof_machine_output() {
        let sample = "p1234\ncmds_stores\nn/Volumes/T7_SSD/.Spotlight-V100/Store-V2\np5678\ncResolve\nn/Volumes/T7_SSD/Rushes/Clip01.mov\nn/Volumes/T7_SSD/Rushes/Clip02.mov\n";
        let parsed = parse_lsof_machine_output(sample, "/Volumes/T7_SSD");
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].process_name, "Resolve");
        assert_eq!(parsed[0].open_files_count, 2);
        assert!(!parsed[0].is_system_agent);
        assert_eq!(parsed[1].process_name, "mds_stores");
        assert!(parsed[1].is_system_agent);
    }

    #[test]
    fn test_space_lens_category_and_protection() {
        assert_eq!(
            classify_file_category(Path::new("/Volumes/SSD/Rushes/A001.braw")),
            "video"
        );
        assert_eq!(
            classify_file_category(Path::new("/Users/test/Library/Caches/Adobe/test.dat")),
            "cache"
        );
        assert!(is_protected_system_path(Path::new("/")));
        assert!(is_protected_system_path(Path::new("/System")));
        assert!(is_protected_system_path(Path::new("/Volumes/Samsung_T7")));
        assert!(!is_protected_system_path(Path::new(
            "/Volumes/Samsung_T7/OldProject"
        )));
    }

    #[test]
    fn test_space_lens_scan_current_crate() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let report =
            scan_space_lens(&format!("{}/src", manifest_dir)).expect("scan should succeed");
        assert!(report.total_files >= 3);
        assert!(!report.root_node.children.is_empty());
    }

    #[test]
    fn test_offline_catalog_index_and_search() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let src_dir = format!("{}/src", manifest_dir);
        let summary = index_volume_snapshot(
            &src_dir,
            "TestVaultDrive",
            "external_ssd",
            "APFS",
            1_000_000_000,
            250_000_000,
            750_000_000,
        )
        .expect("catalog indexing should succeed");

        assert!(summary.total_files_indexed >= 4);
        let slug = make_volume_slug("TestVaultDrive", &src_dir);
        assert_eq!(summary.volume_id, slug);

        let browsed = browse_snapshot_directory(&slug, "").expect("browse root should work");
        assert!(!browsed.is_empty());

        let hits = search_across_catalog("space_lens", Some(&slug), None)
            .expect("search should succeed");
        assert!(!hits.is_empty());

        delete_catalog_snapshot(&slug).expect("cleanup should succeed");
    }

    #[test]
    fn test_tools_format_guard_and_ghost_scanner() {
        assert!(validate_safe_format_target("disk0s1", "/", false).is_err());
        assert!(validate_safe_format_target("disk3s1", "/Volumes/Internal", true).is_err());
        assert!(validate_safe_format_target("disk4s1", "/Volumes/T7_SSD", true).is_ok());

        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let ghost_report =
            scan_ghost_and_caches(&format!("{}/src", manifest_dir)).expect("ghost scan ok");
        assert_eq!(ghost_report.categories.len(), 4);
    }

    #[test]
    fn test_duplicate_engine_and_dhash() {
        use super::duplicates::hamming_distance;
        let h1: u64 = 0b10101010;
        let h2: u64 = 0b10101011; // 1 bit diff
        assert_eq!(hamming_distance(h1, h2), 1);

        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let rep = super::duplicates::scan_duplicates(&format!("{}/src", manifest_dir), false, 100)
            .expect("duplicate scan should succeed");
        assert!(rep.total_scanned_files >= 3);
    }

    #[test]
    fn test_uninstaller_app_scan() {
        let apps = super::uninstaller::scan_installed_applications();
        // On macOS there is always at least 1 app in /Applications or /Applications/Utilities
        assert!(!apps.is_empty());
    }

    #[test]
    fn test_snapshots_query() {
        let rep = super::snapshots::list_volume_snapshots("/").expect("list snapshots ok");
        assert!(rep.is_apfs);
    }

    #[test]
    fn test_apfs_containers_parsing() {
        let sample = r#"
+-- Container disk3 5B063E26-A24D-4BBD-A9E7-AEF20591000B
    Size (Capacity Ceiling):      994662584320 B (994.7 GB)
    Capacity In Use By Volumes:   195504439296 B (195.5 GB)
    Capacity Not Allocated:       799158145024 B (799.2 GB)
    APFS Physical Store Disk:   disk0s2
    +-> Volume disk3s1 F646300D
        APFS Volume Disk (Role):   disk3s1 (System)
        Name:                      Macintosh HD
        Mount Point:               /
        Capacity Consumed:         13755031552 B (13.8 GB)
        Encrypted:                 No
        "#;
        let containers = super::partitioner::parse_apfs_containers_text(sample);
        assert_eq!(containers.len(), 1);
        assert_eq!(containers[0].container_id, "disk3");
        assert_eq!(containers[0].volumes.len(), 1);
        assert!(containers[0].volumes[0].is_system_locked);
    }

    #[test]
    fn test_flash_probe_block_integrity() {
        let mut buf = vec![0u8; 1024 * 1024];
        super::flash_detector::generate_probe_block(42, &mut buf);
        assert!(super::flash_detector::verify_probe_block(42, &buf));
        // Wrong block index should fail
        assert!(!super::flash_detector::verify_probe_block(43, &buf));
        // Corrupted byte should fail
        buf[500] ^= 0xFF;
        assert!(!super::flash_detector::verify_probe_block(42, &buf));
    }

    #[test]
    fn test_ssd_health_query() {
        let rep = super::ssd_health::get_disk_health("disk0").expect("disk0 health query ok");
        assert_eq!(rep.bsd_name, "disk0");
        assert!(rep.health_percent >= 50);
        assert!(!rep.status_verdict.is_empty());
    }

    #[test]
    fn test_large_files_scan() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let rep = super::large_files::scan_large_and_old_files(manifest_dir, 100).expect("scan ok");
        assert!(rep.total_scanned_files > 0);
    }

    #[test]
    fn test_system_ghost_cleaner_scan() {
        let rep = super::system_cleaner::scan_system_ghost_cleaner().expect("system ghost scan ok");
        // Check that scan returns without panicking and has valid categories
        for item in &rep.items {
            assert!(!item.id.is_empty());
            assert!(!item.path.is_empty());
            assert!(item.size_bytes > 0);
        }
    }

    #[test]
    fn test_encrypt_apfs_volume_safety_validation() {
        // Disallow internal disks
        assert!(super::partitioner::encrypt_apfs_volume("disk0", "secret123").is_err());
        assert!(super::partitioner::encrypt_apfs_volume("disk1s1", "secret123").is_err());
        // Disallow too short password
        assert!(super::partitioner::encrypt_apfs_volume("disk4s1", "12").is_err());
    }
}
