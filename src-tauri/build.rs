use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let obj_path = out_dir.join("icon_extractor.o");
    let lib_path = out_dir.join("libapp_icon.a");

    let status = Command::new("clang")
        .args([
            "-O2",
            "-c",
            "src/icon_extractor.m",
            "-o",
        ])
        .arg(&obj_path)
        .status();

    if let Ok(st) = status {
        if st.success() {
            let _ = Command::new("ar")
                .args(["crus"])
                .arg(&lib_path)
                .arg(&obj_path)
                .status();

            println!("cargo:rustc-link-search=native={}", out_dir.display());
            println!("cargo:rustc-link-lib=static=app_icon");
            println!("cargo:rustc-link-lib=framework=AppKit");
            println!("cargo:rustc-link-lib=framework=Cocoa");
        }
    }

    let nvme_obj_path = out_dir.join("nvme_smart.o");
    let nvme_lib_path = out_dir.join("libnvme_smart.a");
    let nvme_status = Command::new("clang")
        .args(["-O2", "-c", "src/nvme_smart.c", "-o"])
        .arg(&nvme_obj_path)
        .status();

    if let Ok(st) = nvme_status {
        if st.success() {
            let _ = Command::new("ar")
                .args(["crus"])
                .arg(&nvme_lib_path)
                .arg(&nvme_obj_path)
                .status();

            println!("cargo:rustc-link-search=native={}", out_dir.display());
            println!("cargo:rustc-link-lib=static=nvme_smart");
            println!("cargo:rustc-link-lib=framework=IOKit");
            println!("cargo:rustc-link-lib=framework=CoreFoundation");
        }
    }

    println!("cargo:rerun-if-changed=src/icon_extractor.m");
    println!("cargo:rerun-if-changed=src/nvme_smart.c");
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    println!("cargo:rustc-env=HARDHUB_BUILD_TIME_SECS={}", now_secs);
    tauri_build::build();
}
