use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockingProcessInfo {
    pub pid: u32,
    pub process_name: String,
    pub is_system_agent: bool,
    pub sample_open_file: String,
    pub open_files_count: usize,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EjectReport {
    pub mount_point: String,
    pub drive_name: String,
    pub success: bool,
    pub killed_processes: Vec<String>,
    pub message: String,
}

/// Classifies a process name into human-friendly description and whether it is a macOS background indexer.
pub fn classify_process(name: &str) -> (bool, String) {
    let lower = name.to_lowercase();
    if lower.contains("mds") || lower.contains("mdworker") || lower.contains("spotlight") {
        (true, "Indexation Spotlight macOS".to_string())
    } else if lower.contains("quicklook") {
        (true, "Générateur d'aperçus QuickLook".to_string())
    } else if lower.contains("photoanalysis") || lower.contains("photolibrary") {
        (true, "Analyseur Photos macOS".to_string())
    } else if lower.contains("fsevents") {
        (true, "Journal d'événements macOS".to_string())
    } else if lower == "finder" {
        (true, "Fenêtre ou aperçu Finder".to_string())
    } else if lower.contains("resolve") {
        (false, "DaVinci Resolve (Média ouvert)".to_string())
    } else if lower.contains("premiere") {
        (false, "Adobe Premiere Pro".to_string())
    } else if lower.contains("final cut") {
        (false, "Final Cut Pro".to_string())
    } else if lower.contains("vlc") || lower.contains("iina") || lower.contains("quicktime") {
        (false, "Lecteur vidéo actif".to_string())
    } else {
        (false, "Application utilisant un fichier sur le disque".to_string())
    }
}

/// Parses `lsof -F pcn` machine-readable output into grouped `BlockingProcessInfo` items.
pub fn parse_lsof_machine_output(raw: &str, mount_point: &str) -> Vec<BlockingProcessInfo> {
    let mut map: HashMap<u32, BlockingProcessInfo> = HashMap::new();
    let mut current_pid: Option<u32> = None;
    let mut current_cmd = String::new();
    let self_pid = std::process::id();

    for line in raw.lines() {
        if line.is_empty() {
            continue;
        }
        let prefix = line.chars().next().unwrap_or(' ');
        let value = &line[1..];
        match prefix {
            'p' => {
                current_pid = value.parse::<u32>().ok();
            }
            'c' => {
                current_cmd = value.to_string();
            }
            'n' => {
                if let Some(pid) = current_pid {
                    if pid == self_pid {
                        continue;
                    }
                    if value.starts_with(mount_point) {
                        let entry = map.entry(pid).or_insert_with(|| {
                            let (is_sys, desc) = classify_process(&current_cmd);
                            BlockingProcessInfo {
                                pid,
                                process_name: current_cmd.clone(),
                                is_system_agent: is_sys,
                                sample_open_file: value.to_string(),
                                open_files_count: 0,
                                description: desc,
                            }
                        });
                        entry.open_files_count += 1;
                    }
                }
            }
            _ => {}
        }
    }

    let mut list: Vec<BlockingProcessInfo> = map.into_values().collect();
    list.sort_by(|a, b| b.open_files_count.cmp(&a.open_files_count));
    list
}

/// Inspects all processes currently holding open file descriptors on `mount_point`.
pub fn inspect_blocking_processes(mount_point: &str) -> Vec<BlockingProcessInfo> {
    if mount_point == "/" || mount_point.is_empty() {
        return Vec::new();
    }

    let output = Command::new("/usr/sbin/lsof")
        .args(["-F", "pcn", "--", mount_point])
        .output();

    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        return parse_lsof_machine_output(&text, mount_point);
    }

    Vec::new()
}

/// Flushes kernel buffers (`sync`), optionally terminates blocking processes, and safely ejects the drive.
pub fn safe_force_eject_drive(
    mount_point: &str,
    drive_name: &str,
    kill_blockers: bool,
) -> Result<EjectReport, String> {
    if mount_point == "/" {
        return Err("Impossible d'éjecter le disque système principal (Macintosh HD).".to_string());
    }

    // 1. Flush all pending write caches to physical flash/disk
    unsafe {
        libc::sync();
    }

    let mut killed_processes = Vec::new();

    // 2. If requested, terminate blocking processes before unmounting
    if kill_blockers {
        let blockers = inspect_blocking_processes(mount_point);
        for proc_info in blockers {
            // Do not kill Finder itself, only close its hold or kill background agents/apps
            if proc_info.process_name.eq_ignore_ascii_case("Finder") {
                continue;
            }
            unsafe {
                libc::kill(proc_info.pid as i32, libc::SIGTERM);
            }
            killed_processes.push(format!("{} (PID {})", proc_info.process_name, proc_info.pid));
        }
        if !killed_processes.is_empty() {
            thread::sleep(Duration::from_millis(300));
            unsafe {
                libc::sync();
            }
        }
    }

    // 3. Try standard clean eject via diskutil
    let eject_out = Command::new("/usr/sbin/diskutil")
        .args(["eject", mount_point])
        .output()
        .map_err(|e| format!("Erreur d'exécution diskutil : {}", e))?;

    if eject_out.status.success() {
        return Ok(EjectReport {
            mount_point: mount_point.to_string(),
            drive_name: drive_name.to_string(),
            success: true,
            killed_processes,
            message: format!("« {} » a été éjecté en toute sécurité.", drive_name),
        });
    }

    // 4. Fallback: if kill_blockers is enabled, try `diskutil unmount force` after sync
    if kill_blockers {
        unsafe {
            libc::sync();
        }
        let force_out = Command::new("/usr/sbin/diskutil")
            .args(["unmount", "force", mount_point])
            .output()
            .map_err(|e| format!("Erreur diskutil unmount force : {}", e))?;

        if force_out.status.success() {
            return Ok(EjectReport {
                mount_point: mount_point.to_string(),
                drive_name: drive_name.to_string(),
                success: true,
                killed_processes,
                message: format!(
                    "« {} » a été libéré et démonté proprement (caches synchronisés).",
                    drive_name
                ),
            });
        }
    }

    let stderr = String::from_utf8_lossy(&eject_out.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!(
            "Le disque « {} » est retenu par une application. Utilisez « Libérer & Éjecter ».",
            drive_name
        )
    } else {
        stderr
    })
}

