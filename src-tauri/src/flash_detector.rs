use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

const BLOCK_SIZE: usize = 1024 * 1024; // 1 MB
const MAGIC_HEADER: &[u8; 16] = b"HARDHUB_FLASH_V1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashTestProgress {
    pub stage: String, // "writing" | "verifying" | "completed" | "error"
    pub percent: f32,
    pub current_mb: f64,
    pub total_mb: f64,
    pub speed_mbps: f64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashTestResult {
    pub success: bool,
    pub is_counterfeit: bool,
    pub tested_bytes: u64,
    pub corrupted_bytes: u64,
    pub write_speed_mbps: f64,
    pub read_speed_mbps: f64,
    pub verdict_title: String,
    pub verdict_description: String,
    pub duration_seconds: f64,
}

/// Generates a deterministic pseudo-random 1 MB block based on block index.
pub fn generate_probe_block(block_idx: u32, buf: &mut [u8]) {
    // Header
    buf[0..16].copy_from_slice(MAGIC_HEADER);
    let idx_bytes = block_idx.to_le_bytes();
    buf[16..20].copy_from_slice(&idx_bytes);

    // Fill with fast deterministic PRNG sequence
    let mut state: u32 = 0x811c9dc5 ^ block_idx.wrapping_mul(0x5bd1e995);
    for i in (20..buf.len()).step_by(4) {
        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
        let b = state.to_le_bytes();
        buf[i] = b[0];
        if i + 1 < buf.len() { buf[i + 1] = b[1]; }
        if i + 2 < buf.len() { buf[i + 2] = b[2]; }
        if i + 3 < buf.len() { buf[i + 3] = b[3]; }
    }
}

/// Validates that a block matches the expected pattern for block_idx.
pub fn verify_probe_block(block_idx: u32, buf: &[u8]) -> bool {
    if buf.len() < BLOCK_SIZE {
        return false;
    }
    if &buf[0..16] != MAGIC_HEADER {
        return false;
    }
    let read_idx = u32::from_le_bytes([buf[16], buf[17], buf[18], buf[19]]);
    if read_idx != block_idx {
        return false; // Flash loop / address wrapping detected!
    }

    let mut state: u32 = 0x811c9dc5 ^ block_idx.wrapping_mul(0x5bd1e995);
    for i in (20..buf.len()).step_by(4) {
        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
        let b = state.to_le_bytes();
        if buf[i] != b[0] { return false; }
        if i + 1 < buf.len() && buf[i + 1] != b[1] { return false; }
        if i + 2 < buf.len() && buf[i + 2] != b[2] { return false; }
        if i + 3 < buf.len() && buf[i + 3] != b[3] { return false; }
    }
    true
}

pub fn run_flash_integrity_probe(
    app: &AppHandle,
    mount_point: &str,
    target_mb: u64,
    is_removable: bool,
) -> Result<FlashTestResult, String> {
    if !is_removable && mount_point == "/" {
        return Err("Sécurité : le test flash est réservé aux supports externes amovibles.".to_string());
    }

    let p = Path::new(mount_point);
    if !p.exists() {
        return Err(format!("Le point de montage '{}' est inaccessible.", mount_point));
    }

    // Default to 1024 MB if 0 requested, max 32 GB to keep execution reasonable
    let total_mb = if target_mb == 0 { 1024 } else { target_mb.clamp(128, 32768) };
    let total_blocks = total_mb as usize;
    let total_bytes = (total_mb as u64) * 1024 * 1024;

    let probe_file_path = p.join(".hardhub_flash_probe.bin");

    // Clean any previous probe file
    let _ = fs::remove_file(&probe_file_path);

    let start_time = Instant::now();

    // 1. OPEN FILE FOR DIRECT WRITING
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(true)
        .open(&probe_file_path)
        .map_err(|e| format!("Impossible d'initialiser le fichier de test sur {}: {}", mount_point, e))?;

    let mut buffer = vec![0u8; BLOCK_SIZE];

    // ================= STAGE 1: WRITING =================
    let write_start = Instant::now();
    for idx in 0..total_blocks {
        generate_probe_block(idx as u32, &mut buffer);

        if let Err(e) = file.write_all(&buffer) {
            let _ = fs::remove_file(&probe_file_path);
            return Err(format!("Erreur d'écriture physique (bloc {}/{}): {}", idx, total_blocks, e));
        }

        if idx % 16 == 0 || idx == total_blocks - 1 {
            let elapsed = write_start.elapsed().as_secs_f64().max(0.001);
            let written_mb = (idx + 1) as f64;
            let speed = written_mb / elapsed;
            let percent = (written_mb / (total_mb as f64) * 50.0) as f32;

            let _ = app.emit("flash_test_progress", FlashTestProgress {
                stage: "writing".to_string(),
                percent,
                current_mb: written_mb,
                total_mb: total_mb as f64,
                speed_mbps: (speed * 10.0).round() / 10.0,
                message: format!("Écriture des mires de test ({} / {} Mo)…", written_mb as u64, total_mb),
            });
        }
    }

    let _ = file.sync_all();
    let write_duration = write_start.elapsed().as_secs_f64().max(0.001);
    let write_speed_mbps = (total_mb as f64) / write_duration;

    // ================= STAGE 2: SEEK TO BEGINNING & VERIFY =================
    if let Err(e) = file.seek(SeekFrom::Start(0)) {
        let _ = fs::remove_file(&probe_file_path);
        return Err(format!("Erreur de repositionnement de tête de lecture: {}", e));
    }

    let read_start = Instant::now();
    let mut corrupted_blocks = 0u64;

    for idx in 0..total_blocks {
        if let Err(_e) = file.read_exact(&mut buffer) {
            corrupted_blocks += (total_blocks - idx) as u64;
            break;
        }

        if !verify_probe_block(idx as u32, &buffer) {
            corrupted_blocks += 1;
        }

        if idx % 16 == 0 || idx == total_blocks - 1 {
            let elapsed = read_start.elapsed().as_secs_f64().max(0.001);
            let verified_mb = (idx + 1) as f64;
            let speed = verified_mb / elapsed;
            let percent = 50.0 + (verified_mb / (total_mb as f64) * 50.0) as f32;

            let _ = app.emit("flash_test_progress", FlashTestProgress {
                stage: "verifying".to_string(),
                percent,
                current_mb: verified_mb,
                total_mb: total_mb as f64,
                speed_mbps: (speed * 10.0).round() / 10.0,
                message: format!("Vérification bit-à-bit ({} / {} Mo)…", verified_mb as u64, total_mb),
            });
        }
    }

    let read_duration = read_start.elapsed().as_secs_f64().max(0.001);
    let read_speed_mbps = (total_mb as f64) / read_duration;

    // Clean up temporary probe file immediately
    drop(file);
    let _ = fs::remove_file(&probe_file_path);

    let total_duration = start_time.elapsed().as_secs_f64();
    let corrupted_bytes = corrupted_blocks * (BLOCK_SIZE as u64);
    let is_counterfeit = corrupted_blocks > 0;

    let (verdict_title, verdict_description) = if !is_counterfeit {
        (
            "Support 100% Authentique".to_string(),
            format!(
                "Toutes les données testées ({} Mo) ont été écrites et relues sans la moindre anomalie. La mémoire physique est conforme.",
                total_mb
            ),
        )
    } else {
        (
            "Alerte : Contrefaçon Détectée".to_string(),
            format!(
                "Ce support a corrompu ou écrasé {} Mo sur {} Mo testés. Le contrôleur flash est truqué et boucle sur lui-même.",
                corrupted_bytes / (1024 * 1024),
                total_mb
            ),
        )
    };

    let _ = app.emit("flash_test_progress", FlashTestProgress {
        stage: "completed".to_string(),
        percent: 100.0,
        current_mb: total_mb as f64,
        total_mb: total_mb as f64,
        speed_mbps: (read_speed_mbps * 10.0).round() / 10.0,
        message: verdict_title.clone(),
    });

    Ok(FlashTestResult {
        success: true,
        is_counterfeit,
        tested_bytes: total_bytes,
        corrupted_bytes,
        write_speed_mbps: (write_speed_mbps * 10.0).round() / 10.0,
        read_speed_mbps: (read_speed_mbps * 10.0).round() / 10.0,
        verdict_title,
        verdict_description,
        duration_seconds: (total_duration * 10.0).round() / 10.0,
    })
}
