use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

use sha1::{Digest, Sha1};

/// The publisher's `bis_shortHash`: the sorted PBO trailers joined as lowercase
/// hex, SHA-1'd, then run through Sedgewick's string hash.
pub fn short_hash(trailers: &[[u8; 20]]) -> u32 {
    let mut sorted = trailers.to_vec();
    sorted.sort_unstable();
    let text = hex_lower(sorted.iter().flatten());
    let long: [u8; 20] = Sha1::digest(text.as_bytes()).into();
    let mut input = vec![40];
    input.extend_from_slice(hex_lower(&long).as_bytes());
    rs_hash(&input)
}

/// The trailer of every PBO directly inside a mod's `dta`, `addons` and `bin`
/// folders. `None` when the folder can't be read, a PBO is too short to hold a
/// trailer, or there is no PBO at all — a half-downloaded copy must not look
/// like a difference.
pub fn folder_hash(mod_dir: &Path) -> Option<u32> {
    let trailers = pbo_trailers(mod_dir).ok()?;
    if trailers.is_empty() {
        return None;
    }
    Some(short_hash(&trailers))
}

fn pbo_trailers(mod_dir: &Path) -> io::Result<Vec<[u8; 20]>> {
    let mut trailers = Vec::new();
    for entry in fs::read_dir(mod_dir)? {
        let folder = entry?.path();
        if !is_hashed_folder(&folder) {
            continue;
        }
        for file in fs::read_dir(&folder)? {
            let path = file?.path();
            if path.is_file() && is_pbo(&path) {
                trailers.push(read_trailer(&path)?);
            }
        }
    }
    Ok(trailers)
}

fn is_hashed_folder(path: &Path) -> bool {
    path.is_dir()
        && path.file_name().is_some_and(|name| {
            ["dta", "addons", "bin"]
                .iter()
                .any(|folder| name.eq_ignore_ascii_case(folder))
        })
}

fn is_pbo(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pbo"))
}

fn read_trailer(path: &Path) -> io::Result<[u8; 20]> {
    let mut file = File::open(path)?;
    if file.metadata()?.len() < 20 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("{} is shorter than a PBO trailer", path.display()),
        ));
    }
    file.seek(SeekFrom::End(-20))?;
    let mut trailer = [0u8; 20];
    file.read_exact(&mut trailer)?;
    Ok(trailer)
}

fn hex_lower<'a>(bytes: impl IntoIterator<Item = &'a u8>) -> String {
    bytes
        .into_iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Robert Sedgewick's string hash, with the multiplier sequence Publisher uses.
fn rs_hash(bytes: &[u8]) -> u32 {
    let mut hash = 0u32;
    let mut a = 378_551u32;
    for &byte in bytes {
        hash = hash.wrapping_mul(a).wrapping_add(u32::from(byte));
        a = a.wrapping_mul(63_689);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};

    fn trailer(hex: &str) -> [u8; 20] {
        let mut out = [0u8; 20];
        for (i, byte) in out.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).unwrap();
        }
        out
    }

    #[test]
    fn known_short_hashes_match_the_servers() {
        let cases = [
            ("4be1bed5c3567f6e8690c2083e32b05d6dfa4257", 3_988_851_462),
            ("e6e1ad670abaed4f1203a118d6278bf811fca59c", 128_745_920),
            ("ad60cc7e63c90b7a1fad9da5048f4d91e20f0f62", 950_007_857),
        ];
        for (hex, expected) in cases {
            assert_eq!(short_hash(&[trailer(hex)]), expected, "{hex}");
        }
    }

    /// A per-test scratch folder that deletes itself on drop.
    struct ScratchDir(PathBuf);

    impl ScratchDir {
        fn new(label: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("tetra-mod-hash-{label}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl std::ops::Deref for ScratchDir {
        type Target = Path;

        fn deref(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for ScratchDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn pbo_with_trailer(trailer: [u8; 20]) -> Vec<u8> {
        let mut bytes = vec![0u8; 10];
        bytes.extend_from_slice(&trailer);
        bytes
    }

    #[test]
    fn pbo_trailers_come_from_the_hashed_folders_only() {
        let dir = ScratchDir::new("trailers");
        let a = [0xaa; 20];
        let b = [0xbb; 20];
        fs::create_dir_all(dir.join("Addons")).unwrap();
        fs::create_dir_all(dir.join("BIN")).unwrap();
        fs::create_dir_all(dir.join("addons/sub")).unwrap();
        fs::create_dir_all(dir.join("other")).unwrap();
        fs::write(dir.join("Addons/a.pbo"), pbo_with_trailer(a)).unwrap();
        fs::write(dir.join("BIN/b.PBO"), pbo_with_trailer(b)).unwrap();
        fs::write(dir.join("addons/sub/c.pbo"), pbo_with_trailer([0xcc; 20])).unwrap();
        fs::write(dir.join("other/d.pbo"), pbo_with_trailer([0xdd; 20])).unwrap();
        fs::write(dir.join("addons/readme.txt"), pbo_with_trailer([0xee; 20])).unwrap();

        let mut found = pbo_trailers(&dir).unwrap();
        found.sort();
        assert_eq!(found, vec![a, b]);
    }

    #[test]
    fn trailer_order_does_not_change_the_hash() {
        let first = trailer("ad60cc7e63c90b7a1fad9da5048f4d91e20f0f62");
        let second = trailer("0123456789abcdef0123456789abcdef01234567");
        assert_eq!(short_hash(&[first, second]), short_hash(&[second, first]));
    }

    #[test]
    fn folder_hash_reads_the_pbos_directly_in_the_mod_folder() {
        let dir = ScratchDir::new("folder");
        fs::create_dir_all(dir.join("addons")).unwrap();
        fs::write(
            dir.join("addons/a.pbo"),
            pbo_with_trailer(trailer("ad60cc7e63c90b7a1fad9da5048f4d91e20f0f62")),
        )
        .unwrap();

        let expected = short_hash(&[trailer("ad60cc7e63c90b7a1fad9da5048f4d91e20f0f62")]);
        assert_eq!(folder_hash(&dir), Some(expected));
    }

    #[test]
    fn a_pbo_shorter_than_a_trailer_leaves_the_folder_unhashed() {
        let dir = ScratchDir::new("short");
        fs::create_dir_all(dir.join("addons")).unwrap();
        fs::write(dir.join("addons/short.pbo"), [0u8; 10]).unwrap();

        assert_eq!(folder_hash(&dir), None);
    }

    #[test]
    fn a_folder_without_pbos_or_a_missing_one_is_unhashed() {
        let dir = ScratchDir::new("empty");
        fs::create_dir_all(dir.join("addons")).unwrap();
        assert_eq!(folder_hash(&dir), None);

        let missing = dir.join("not-there");
        assert_eq!(folder_hash(&missing), None);
    }
}
