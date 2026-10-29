fn main() {
    println!("cargo::rerun-if-changed=build.rs");
    println!("cargo::rerun-if-changed=../../package.json");
    println!("cargo::rerun-if-env-changed=VITE_APP_VERSION");
    let version = std::env::var("VITE_APP_VERSION")
        .ok()
        .filter(|version| !version.is_empty())
        .unwrap_or_else(|| {
            let package: serde_json::Value =
                serde_json::from_str(include_str!("../../package.json"))
                    .expect("valid package.json");
            package["version"].as_str().expect("app version").to_owned()
        });
    println!("cargo::rustc-env=SABLE_APP_VERSION={version}");

    if std::env::var("OPT_LEVEL").as_deref() == Ok("0")
        && std::env::var_os("CARGO_FEATURE_UNOPTIMIZED_BUILD").is_none()
    {
        println!(
            "cargo::error=sable-core requires opt-level >= 1. At opt-level 0 its dispatch path \
             needs ~2.5 MiB of stack, which overflows libtest's 2 MiB test threads, tokio's 2 MiB \
             worker threads and wasm32's 1 MiB shadow stack; at opt-level 1 it needs ~224 KiB. \
             Add `[profile.dev.package.sable-core] opt-level = 1` (and the same under \
             `[profile.test.package.sable-core]`) to your workspace Cargo.toml, or enable the \
             `unoptimized-build` feature to accept the risk."
        );
    }
}
