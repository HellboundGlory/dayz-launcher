/// Build the `-mod=` parameter string from a list of absolute workshop paths.
///
/// # Order
///
/// The server declares mods in a specific order, and DayZ loads them in
/// that order. Reordering produces a different checksum and surfaces to
/// the player as an unexplained kick. This function preserves the exact
/// order it is given; it never sorts.
///
/// # Separator
///
/// Mod paths are separated by semicolons (`;`), the Windows convention.
/// The result is a single string intended to be passed as one argument to
/// `CreateProcess` — never through a shell.
///
/// # Absolute paths only
///
/// Every path must be absolute. A relative path would resolve against the
/// game's working directory, and since DayZ changes its working directory
/// at startup the result is unpredictable. The caller is responsible for
/// verifying this invariant.
pub fn build_mod_string(mod_paths: &[String]) -> String {
    if mod_paths.is_empty() {
        return String::new();
    }
    let mut s = String::from("-mod=");
    for (i, path) in mod_paths.iter().enumerate() {
        if i > 0 {
            s.push(';');
        }
        s.push_str(path);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_declared_order() {
        let paths: Vec<String> = vec![
            r"C:\steam\workshop\content\221100\1234567890".into(),
            r"C:\steam\workshop\content\221100\9876543210".into(),
            r"D:\games\mods\@my_mod".into(),
        ];
        let result = build_mod_string(&paths);
        assert_eq!(
            result,
            r"-mod=C:\steam\workshop\content\221100\1234567890;C:\steam\workshop\content\221100\9876543210;D:\games\mods\@my_mod"
        );
    }

    #[test]
    fn empty_list_produces_empty_string() {
        assert_eq!(build_mod_string(&[]), "");
    }

    #[test]
    fn single_mod_no_trailing_semicolon() {
        let result = build_mod_string(&[r"C:\mods\@test".into()]);
        assert_eq!(result, r"-mod=C:\mods\@test");
    }
}
