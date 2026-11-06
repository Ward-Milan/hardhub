use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemGhostItem {
    pub id: String,
    pub name: String,
    pub category: String, // "developer" | "package_manager" | "logs"
    pub path: String,
    pub size_bytes: u64,
    pub item_count: usize,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemGhostReport {
    pub total_bytes: u64,
    pub items: Vec<SystemGhostItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemGhostPurgeReport {
    pub freed_bytes: u64,
    pub purged_ids: Vec<String>,
    pub errors: Vec<String>,
}

struct TargetGhostConfig {
    id: &'static str,
    name: &'static str,
    category: &'static str,
    relative_to_home: &'static str,
    description: &'static str,
}

const TARGETS: &[TargetGhostConfig] = &[
    // Developer Apple & Xcode
    TargetGhostConfig {
        id: "xcode_derived_data",
        name: "Cache de compilation Xcode (DerivedData)",
        category: "developer",
        relative_to_home: "Library/Developer/Xcode/DerivedData",
        description: "Fichiers objets et index de code intermédiaire créés lors de la compilation de projets Xcode. Se recrée automatiquement.",
    },
    TargetGhostConfig {
        id: "ios_devicesupport",
        name: "Symboles d'appareils iOS (DeviceSupport)",
        category: "developer",
        relative_to_home: "Library/Developer/Xcode/iOS DeviceSupport",
        description: "Symboles de débogage pour les anciennes versions d'iPhone et d'iPad connectées par câble.",
    },
    TargetGhostConfig {
        id: "simulator_caches",
        name: "Caches des simulateurs Apple",
        category: "developer",
        relative_to_home: "Library/Developer/CoreSimulator/Caches",
        description: "Données temporaires créées lors de l'exécution des simulateurs iOS, watchOS et tvOS.",
    },
    TargetGhostConfig {
        id: "xcode_archives",
        name: "Archives temporaires de build Xcode",
        category: "developer",
        relative_to_home: "Library/Developer/Xcode/Archives",
        description: "Historique d'archives de versions temporaires Xcode conservées localement.",
    },
    // Package managers & build tools
    TargetGhostConfig {
        id: "gradle_cache",
        name: "Cache de dépendances Gradle (Android / Java)",
        category: "package_manager",
        relative_to_home: ".gradle/caches",
        description: "Bibliothèques et dépendances Java/Android Studio téléchargées. Re-téléchargées au besoin.",
    },
    TargetGhostConfig {
        id: "npm_cache",
        name: "Cache de paquets npm (Node.js)",
        category: "package_manager",
        relative_to_home: ".npm/_cacache",
        description: "Copies locales hors-ligne des paquets npm téléchargés lors des installations.",
    },
    TargetGhostConfig {
        id: "yarn_cache",
        name: "Cache des paquets Yarn",
        category: "package_manager",
        relative_to_home: "Library/Caches/Yarn",
        description: "Téléchargements redondants de dépendances gérées par Yarn.",
    },
    TargetGhostConfig {
        id: "homebrew_cache",
        name: "Cache de téléchargement Homebrew",
        category: "package_manager",
        relative_to_home: "Library/Caches/Homebrew",
        description: "Archives tarball et installateurs de formules et casks Homebrew déjà installés.",
    },
    TargetGhostConfig {
        id: "cocoapods_cache",
        name: "Cache CocoaPods (iOS)",
        category: "package_manager",
        relative_to_home: "Library/Caches/CocoaPods",
        description: "Dépôts et frameworks CocoaPods obsolètes mis en cache.",
    },
    TargetGhostConfig {
        id: "pip_cache",
        name: "Cache Python (pip)",
        category: "package_manager",
        relative_to_home: "Library/Caches/pip",
        description: "Fichiers wheels et tarballs Python téléchargés lors de commandes pip install.",
    },
    TargetGhostConfig {
        id: "cargo_cache",
        name: "Cache de crates Rust (Cargo)",
        category: "package_manager",
        relative_to_home: ".cargo/registry/cache",
        description: "Archives source .crate téléchargées depuis crates.io.",
    },
    // Logs & crash dumps
    TargetGhostConfig {
        id: "crash_reports",
        name: "Rapports de plantages (DiagnosticReports)",
        category: "logs",
        relative_to_home: "Library/Logs/DiagnosticReports",
        description: "Rapports de crashs applicatifs et diagnostics archivés par macOS.",
    },
    TargetGhostConfig {
        id: "user_logs",
        name: "Journaux d'applications utilisateur (~/Library/Logs)",
        category: "logs",
        relative_to_home: "Library/Logs",
        description: "Journaux textuels (.log) générés par diverses applications macOS en arrière-plan.",
    },
];

fn compute_path_size_and_count(path: &Path, max_entries: usize) -> (u64, usize) {
    if !path.exists() {
        return (0, 0);
    }

    let mut total_bytes = 0u64;
    let mut total_count = 0usize;

    for (idx, entry) in WalkDir::new(path)
        .max_depth(8)
        .into_iter()
        .flatten()
        .enumerate()
    {
        if idx >= max_entries {
            break;
        }
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                total_bytes = total_bytes.saturating_add(meta.len());
                total_count += 1;
            }
        }
    }

    (total_bytes, total_count)
}

pub fn scan_system_ghost_cleaner() -> Result<SystemGhostReport, String> {
    let home = std::env::var("HOME").map_err(|e| format!("Impossible de déterminer HOME: {}", e))?;
    let home_path = Path::new(&home);

    let mut items = Vec::new();
    let mut total_bytes = 0u64;

    for target in TARGETS {
        let abs_path = home_path.join(target.relative_to_home);
        if abs_path.exists() {
            let (size_bytes, item_count) = compute_path_size_and_count(&abs_path, 25_000);
            if size_bytes > 0 {
                total_bytes = total_bytes.saturating_add(size_bytes);
                items.push(SystemGhostItem {
                    id: target.id.to_string(),
                    name: target.name.to_string(),
                    category: target.category.to_string(),
                    path: abs_path.to_string_lossy().to_string(),
                    size_bytes,
                    item_count,
                    description: target.description.to_string(),
                });
            }
        }
    }

    Ok(SystemGhostReport { total_bytes, items })
}

pub fn purge_system_ghost_items(ids_to_purge: Vec<String>) -> Result<SystemGhostPurgeReport, String> {
    let home = std::env::var("HOME").map_err(|e| format!("Impossible de déterminer HOME: {}", e))?;
    let home_path = Path::new(&home);

    let mut freed_bytes = 0u64;
    let mut purged_ids = Vec::new();
    let errors = Vec::new();

    for target in TARGETS {
        if !ids_to_purge.iter().any(|id| id == target.id) {
            continue;
        }

        let abs_path = home_path.join(target.relative_to_home);
        if !abs_path.exists() {
            continue;
        }

        let (size_before, _) = compute_path_size_and_count(&abs_path, 25_000);

        // Safely empty directory content without removing system-level base folder if it's ~/Library/Logs
        if target.id == "user_logs" {
            if let Ok(rd) = fs::read_dir(&abs_path) {
                for entry in rd.flatten() {
                    let p = entry.path();
                    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    // Keep DiagnosticReports directory structure
                    if name == "DiagnosticReports" {
                        continue;
                    }
                    if p.is_dir() {
                        let _ = fs::remove_dir_all(&p);
                    } else {
                        let _ = fs::remove_file(&p);
                    }
                }
            }
        } else {
            // Remove contents and recreate empty root directory
            if let Ok(rd) = fs::read_dir(&abs_path) {
                for entry in rd.flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        let _ = fs::remove_dir_all(&p);
                    } else {
                        let _ = fs::remove_file(&p);
                    }
                }
            }
        }

        let (size_after, _) = compute_path_size_and_count(&abs_path, 25_000);
        let reclaimed = size_before.saturating_sub(size_after);
        freed_bytes = freed_bytes.saturating_add(reclaimed);
        purged_ids.push(target.id.to_string());
    }

    Ok(SystemGhostPurgeReport {
        freed_bytes,
        purged_ids,
        errors,
    })
}
