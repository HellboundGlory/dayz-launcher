/// Build the `-mod=` parameter string from a list of absolute workshop paths,
/// semicolon-separated, in the exact order given (never sorted — the server's
/// declared order determines the checksum, so reordering gets the client
/// kicked). Caller must ensure every path is absolute.
pub fn build_mod_string(mod_paths: &[String]) -> String {
    if mod_paths.is_empty() {
        return String::new();
    }
    let mut s = String::from("-mod=");
    for (i, path) in mod_paths.iter().enumerate() {
        if i > 0 {
            s.push(';');
        }
        s.push_str(&path_for_platform(path));
    }
    s
}

/// Translate a mod path to the form the running DayZ process can read.
/// On Linux, DayZ runs under Proton/Wine, so paths need the Wine-visible
/// `Z:\...` form or the game can't find the PBOs.
fn path_for_platform(path: &str) -> String {
    #[cfg(target_os = "linux")]
    {
        if path.starts_with('/') {
            format!("Z:{}", path.replace('/', "\\"))
        } else {
            path.to_string()
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        path.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_absolute_paths_become_wine_z_paths() {
        let paths: Vec<String> = vec![
            "/home/james/.local/share/Steam/steamapps/workshop/content/221100/123".into(),
            "/home/james/.local/share/Steam/steamapps/workshop/content/221100/456".into(),
        ];
        assert_eq!(
            build_mod_string(&paths),
            "-mod=Z:\\home\\james\\.local\\share\\Steam\\steamapps\\workshop\\content\\221100\\123;Z:\\home\\james\\.local\\share\\Steam\\steamapps\\workshop\\content\\221100\\456"
        );
    }

    #[test]
    fn the_mod_line_joins_the_paths_in_the_order_given() {
        let cases: &[(&[&str], &str)] = &[
            (
                &[
                    r"C:\steam\workshop\content\221100\1234567890",
                    r"C:\steam\workshop\content\221100\9876543210",
                    r"D:\games\mods\@my_mod",
                ],
                r"-mod=C:\steam\workshop\content\221100\1234567890;C:\steam\workshop\content\221100\9876543210;D:\games\mods\@my_mod",
            ),
            (&[r"C:\mods\@test"], r"-mod=C:\mods\@test"),
            (&[], ""),
        ];
        for (paths, expected) in cases {
            let paths: Vec<String> = paths.iter().map(|p| p.to_string()).collect();
            assert_eq!(build_mod_string(&paths), *expected, "paths: {paths:?}");
        }
    }
}
