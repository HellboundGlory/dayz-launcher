fn main() {
    // A `.deb` install has no AppImage-style wrapper to set LD_LIBRARY_PATH
    // before exec, so libsteam_api.so (a vendored library, never a system
    // package) needs to be found via an RPATH baked into the binary
    // instead. Matches where `bundle.linux.deb.files` in tauri.conf.json
    // places it — `/usr/lib/tetra-launcher/`, alongside the binary at
    // `/usr/bin/tetra-launcher` — so `$ORIGIN/../lib/tetra-launcher`
    // resolves to it. Harmless for the AppImage build: linuxdeploy's own
    // LD_LIBRARY_PATH is still checked first regardless.
    #[cfg(target_os = "linux")]
    println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/../lib/tetra-launcher");

    tauri_build::build();
}
