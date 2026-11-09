//! The DayZ build recorded inside `DayZ_x64.exe`, in the form servers report.

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// `VS_FIXEDFILEINFO.dwSignature`.
const FIXED_FILE_INFO: u32 = 0xFEEF_04BD;
/// `dwFileVersionMS` / `dwFileVersionLS` sit here in `VS_FIXEDFILEINFO`.
const VERSION_AT: usize = 8;
/// Bigger resources are not a DayZ resource section, and reading them would
/// cost more than answering is worth.
const MAX_RESOURCE_LEN: u32 = 16 * 1024 * 1024;

fn read_u16(bytes: &[u8], at: usize) -> Option<u16> {
    let slice = bytes.get(at..at + 2)?;
    Some(u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_u32(bytes: &[u8], at: usize) -> Option<u32> {
    let slice = bytes.get(at..at + 4)?;
    Some(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

/// Full file bytes are not read: only the header up to the section table and
/// then the `.rsrc` section's raw data.
fn read_at(reader: &mut (impl Read + Seek), at: usize, len: usize) -> Option<Vec<u8>> {
    let at = u64::try_from(at).ok()?;
    let mut bytes = vec![0u8; len];
    reader.seek(SeekFrom::Start(at)).ok()?;
    reader.read_exact(&mut bytes).ok()?;
    Some(bytes)
}

/// Byte range of the `.rsrc` section's raw data, from a section table of
/// 40-byte entries.
fn resource_range(sections: &[u8]) -> Option<(usize, u32)> {
    for entry in sections.as_chunks::<40>().0 {
        if entry.get(..8)? != b".rsrc\0\0\0" {
            continue;
        }
        let size = read_u32(entry, 16)?;
        let at = usize::try_from(read_u32(entry, 20)?).ok()?;
        return Some((at, size));
    }
    None
}

pub fn file_version(mut reader: impl Read + Seek) -> Option<[u16; 4]> {
    let dos = read_at(&mut reader, 0, 0x40)?;
    if dos.get(..2)? != b"MZ" {
        return None;
    }
    let pe_at = usize::try_from(read_u32(&dos, 0x3c)?).ok()?;

    let pe = read_at(&mut reader, pe_at, 24)?;
    if pe.get(..4)? != b"PE\0\0" {
        return None;
    }
    let section_count = usize::from(read_u16(&pe, 6)?);
    let optional_len = usize::from(read_u16(&pe, 20)?);
    let table_at = pe_at.checked_add(24)?.checked_add(optional_len)?;
    let sections = read_at(&mut reader, table_at, section_count.checked_mul(40)?)?;

    let (at, size) = resource_range(&sections)?;
    if size > MAX_RESOURCE_LEN {
        return None;
    }
    let file_len = reader.seek(SeekFrom::End(0)).ok()?;
    if u64::try_from(at).ok()?.checked_add(u64::from(size))? > file_len {
        return None;
    }
    let resources = read_at(&mut reader, at, size as usize)?;

    // The file version is the one asked for; DayZ's product version fields
    // are zero.
    let start = (0..resources.len()).step_by(4).find(|&at| {
        read_u32(&resources, at) == Some(FIXED_FILE_INFO) && is_version_info_value(&resources, at)
    })?;
    let info = &resources[start..];
    let ms = read_u32(info, VERSION_AT)?;
    let ls = read_u32(info, VERSION_AT + 4)?;
    Some([(ms >> 16) as u16, ms as u16, (ls >> 16) as u16, ls as u16])
}

/// Whether the signature at `at` is the value of a `VS_VERSIONINFO` block:
/// its header (`wValueLength` 52, key "VS_VERSION_INFO") sits right before
/// it, so a stray match elsewhere in the section is skipped.
fn is_version_info_value(resources: &[u8], at: usize) -> bool {
    let Some(header) = at
        .checked_sub(40)
        .and_then(|start| resources.get(start..at))
    else {
        return false;
    };
    let key = "VS_VERSION_INFO\0"
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect::<Vec<u8>>();
    read_u16(header, 2) == Some(52) && header.get(6..38) == Some(key.as_slice())
}

pub fn server_style(v: [u16; 4]) -> String {
    format!("{}.{}.{}{:03}", v[0], v[1], v[2], v[3])
}

pub fn installed_dayz_version(dayz_dir: &Path) -> Option<String> {
    let exe = dayz_dir.join("DayZ_x64.exe");
    // A FIFO or device under that name would block the read.
    if !std::fs::metadata(&exe).ok()?.is_file() {
        return None;
    }
    let file = std::fs::File::open(exe).ok()?;
    file_version(file).map(server_style)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const PE_AT: usize = 0x40;
    const OPTIONAL_LEN: usize = 0xf0;
    const RSRC_AT: usize = 0x200;
    const SECTION: usize = PE_AT + 24 + OPTIONAL_LEN;

    fn put_u16(bytes: &mut [u8], at: usize, value: u16) {
        bytes[at..at + 2].copy_from_slice(&value.to_le_bytes());
    }

    fn put_u32(bytes: &mut [u8], at: usize, value: u32) {
        bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }

    /// A DOS header, one PE section and that section's raw data.
    fn minimal_pe(name: &[u8; 8], raw: &[u8]) -> Vec<u8> {
        let mut file = vec![0u8; RSRC_AT + raw.len().max(1)];
        file[..2].copy_from_slice(b"MZ");
        put_u32(&mut file, 0x3c, PE_AT as u32);

        file[PE_AT..PE_AT + 4].copy_from_slice(b"PE\0\0");
        put_u16(&mut file, PE_AT + 4, 0x8664);
        put_u16(&mut file, PE_AT + 6, 1);
        put_u16(&mut file, PE_AT + 20, OPTIONAL_LEN as u16);

        file[SECTION..SECTION + 8].copy_from_slice(name);
        put_u32(&mut file, SECTION + 8, raw.len() as u32);
        put_u32(&mut file, SECTION + 12, 0x1000);
        put_u32(&mut file, SECTION + 16, raw.len() as u32);
        put_u32(&mut file, SECTION + 20, RSRC_AT as u32);

        file[RSRC_AT..RSRC_AT + raw.len()].copy_from_slice(raw);
        file
    }

    fn fixed_file_info(v: [u16; 4]) -> Vec<u8> {
        let mut info = vec![0u8; 52];
        put_u32(&mut info, 0, 0xFEEF_04BD);
        put_u32(&mut info, 4, 0x0001_0000);
        put_u32(&mut info, 8, (u32::from(v[0]) << 16) | u32::from(v[1]));
        put_u32(&mut info, 12, (u32::from(v[2]) << 16) | u32::from(v[3]));
        info
    }

    /// A `VS_VERSIONINFO` header followed by its `VS_FIXEDFILEINFO`.
    fn version_block(v: [u16; 4]) -> Vec<u8> {
        let mut block = vec![0u8; 40];
        put_u16(&mut block, 0, 92);
        put_u16(&mut block, 2, 52);
        for (i, unit) in "VS_VERSION_INFO".encode_utf16().enumerate() {
            put_u16(&mut block, 6 + i * 2, unit);
        }
        block.extend(fixed_file_info(v));
        block
    }

    #[test]
    fn the_version_resource_gives_the_four_file_version_parts() {
        let file = minimal_pe(b".rsrc\0\0\0", &version_block([1, 30, 164, 289]));
        assert_eq!(file_version(Cursor::new(file)), Some([1, 30, 164, 289]));
    }

    #[test]
    fn a_signature_outside_a_version_resource_is_skipped() {
        let mut raw = fixed_file_info([9, 9, 9, 9]);
        raw.extend(version_block([1, 30, 164, 289]));
        let file = minimal_pe(b".rsrc\0\0\0", &raw);
        assert_eq!(file_version(Cursor::new(file)), Some([1, 30, 164, 289]));
    }

    #[test]
    fn the_resource_section_is_found_after_other_sections() {
        let mut file = minimal_pe(b".rsrc\0\0\0", &version_block([1, 30, 164, 289]));
        let entry = file[SECTION..SECTION + 40].to_vec();
        file[SECTION + 40..SECTION + 80].copy_from_slice(&entry);
        file[SECTION..SECTION + 8].copy_from_slice(b".text\0\0\0");
        put_u16(&mut file, PE_AT + 6, 2);
        assert_eq!(file_version(Cursor::new(file)), Some([1, 30, 164, 289]));
    }

    #[test]
    fn a_resource_section_over_the_cap_is_not_read() {
        let mut raw = version_block([1, 30, 164, 289]);
        raw.resize(16 * 1024 * 1024 + 4, 0);
        let file = minimal_pe(b".rsrc\0\0\0", &raw);
        assert_eq!(file_version(Cursor::new(file)), None);
    }

    #[test]
    fn servers_report_a_build_number_with_the_last_part_padded() {
        assert_eq!(server_style([1, 30, 164, 289]), "1.30.164289");
        assert_eq!(server_style([1, 30, 164, 78]), "1.30.164078");
    }

    #[test]
    fn malformed_executables_give_no_version() {
        let raw = version_block([1, 30, 164, 289]);

        let mut lfanew_past_the_end = minimal_pe(b".rsrc\0\0\0", &raw);
        put_u32(&mut lfanew_past_the_end, 0x3c, 0x10_0000);

        let mut raw_past_the_end = minimal_pe(b".rsrc\0\0\0", &raw);
        put_u32(&mut raw_past_the_end, SECTION + 20, 0x10_0000);

        let mut too_many_sections = minimal_pe(b".rsrc\0\0\0", &raw);
        put_u16(&mut too_many_sections, PE_AT + 6, u16::MAX);

        let mut unaligned = vec![0u8; 2];
        unaligned.extend(&raw);

        let mut no_pe_signature = minimal_pe(b".rsrc\0\0\0", &raw);
        no_pe_signature[PE_AT] = b'X';

        let cases: Vec<(&str, Vec<u8>)> = vec![
            ("empty", Vec::new()),
            ("no MZ", b"ZZ".to_vec()),
            ("lfanew past the end", lfanew_past_the_end),
            ("PE signature missing", no_pe_signature),
            ("no .rsrc", minimal_pe(b".text\0\0\0", &raw)),
            (".rsrc raw data past the end", raw_past_the_end),
            ("more sections than the file holds", too_many_sections),
            ("no signature", minimal_pe(b".rsrc\0\0\0", &[0u8; 92])),
            (
                "bare signature",
                minimal_pe(b".rsrc\0\0\0", &fixed_file_info([1, 30, 164, 289])),
            ),
            ("unaligned resource", minimal_pe(b".rsrc\0\0\0", &unaligned)),
            (
                "cut after the signature",
                minimal_pe(b".rsrc\0\0\0", &raw[..44]),
            ),
        ];
        for (what, bytes) in cases {
            assert_eq!(file_version(Cursor::new(bytes)), None, "case: {what}");
        }
    }

    #[test]
    fn a_dayz_folder_reports_the_version_of_its_game_executable() {
        let dir = std::env::temp_dir().join(format!("tetra-exe-version-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("DayZ_x64.exe"),
            minimal_pe(b".rsrc\0\0\0", &version_block([1, 30, 164, 289])),
        )
        .unwrap();

        let version = installed_dayz_version(&dir);
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(version.as_deref(), Some("1.30.164289"));
        assert_eq!(installed_dayz_version(&dir), None);
    }

    #[test]
    #[ignore]
    fn reads_a_real_executable_named_by_dayz_exe() {
        let Some(path) = std::env::var_os("DAYZ_EXE") else {
            return;
        };
        let file = std::fs::File::open(path).expect("could not open DAYZ_EXE");
        let version = file_version(file).map(server_style);
        println!("{version:?}");
        assert!(version.is_some());
    }
}
