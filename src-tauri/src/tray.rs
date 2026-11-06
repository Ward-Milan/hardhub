use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Manager, Runtime};
use std::process::Command;
use crate::drives::list_all_storage_drives;
use crate::eject_doctor::safe_force_eject_drive;

pub fn create_tray_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Menu<R>, tauri::Error> {
    let menu = Menu::new(app)?;

    let drives = list_all_storage_drives();
    let header_title = format!("HardHub Express ({} support{})", drives.len(), if drives.len() > 1 { "s" } else { "" });
    let header = MenuItem::with_id(app, "header", &header_title, false, None::<&str>)?;
    menu.append(&header)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;

    let mut removable_count = 0;
    for drive in &drives {
        let pct = if drive.total_bytes > 0 {
            (drive.used_bytes as f64 / drive.total_bytes as f64 * 100.0).round() as u64
        } else {
            0
        };

        let free_gb = drive.available_bytes as f64 / 1_073_741_824.0;
        let drive_label = if drive.is_cable_bottlenecked {
            format!("{} ({}% - {:.0} Go libres) [Câble USB 2.0 lent]", drive.name, pct, free_gb)
        } else {
            format!("{} ({}% - {:.0} Go libres)", drive.name, pct, free_gb)
        };

        let item_id = format!("drive_info:{}", drive.mount_point);
        let drive_item = MenuItem::with_id(app, &item_id, &drive_label, true, None::<&str>)?;
        menu.append(&drive_item)?;

        if drive.is_removable && drive.mount_point != "/" {
            removable_count += 1;
            let eject_id = format!("eject_drive:{}:{}", drive.mount_point, drive.name);
            let eject_label = format!("  -> Éjecter {}", drive.name);
            let eject_item = MenuItem::with_id(app, &eject_id, &eject_label, true, None::<&str>)?;
            menu.append(&eject_item)?;
        }
    }

    if removable_count == 0 {
        let empty_item = MenuItem::with_id(app, "no_external", "Aucun disque externe connecté", false, None::<&str>)?;
        menu.append(&empty_item)?;
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;

    // Mode Depart (eject all)
    let eject_all_title = if removable_count > 0 {
        format!("Mode Départ (Éjecter les {} disques externes)", removable_count)
    } else {
        "Mode Départ (Tout éjecter)".to_string()
    };
    let eject_all_item = MenuItem::with_id(app, "eject_all", &eject_all_title, removable_count > 0, None::<&str>)?;
    menu.append(&eject_all_item)?;

    menu.append(&PredefinedMenuItem::separator(app)?)?;

    let open_app = MenuItem::with_id(app, "open_hardhub", "Ouvrir HardHub", true, None::<&str>)?;
    let quit_app = MenuItem::with_id(app, "quit_hardhub", "Quitter HardHub", true, None::<&str>)?;
    menu.append(&open_app)?;
    menu.append(&quit_app)?;

    Ok(menu)
}

pub fn handle_tray_menu_click<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if id == "open_hardhub" {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    } else if id == "quit_hardhub" {
        app.exit(0);
    } else if id == "eject_all" {
        let drives = list_all_storage_drives();
        for drive in drives {
            if drive.is_removable && drive.mount_point != "/" {
                let _ = safe_force_eject_drive(&drive.mount_point, &drive.name, false);
            }
        }
        let _ = refresh_tray(app);
    } else if let Some(target) = id.strip_prefix("eject_drive:") {
        if let Some((mount, name)) = target.split_once(':') {
            let _ = safe_force_eject_drive(mount, name, false);
        } else {
            let _ = safe_force_eject_drive(target, target, false);
        }
        let _ = refresh_tray(app);
    } else if let Some(mount) = id.strip_prefix("drive_info:") {
        let _ = Command::new("open").arg(mount).spawn();
    }
}

pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> Result<TrayIcon<R>, tauri::Error> {
    let menu = create_tray_menu(app)?;

    let mut builder = TrayIconBuilder::with_id("hardhub-express")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            handle_tray_menu_click(app, event.id.as_ref());
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)
}

pub fn refresh_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), tauri::Error> {
    if let Some(tray) = app.tray_by_id("hardhub-express") {
        let new_menu = create_tray_menu(app)?;
        tray.set_menu(Some(new_menu))?;
    }
    Ok(())
}
