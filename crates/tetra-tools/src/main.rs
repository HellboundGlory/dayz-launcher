//! Maintenance tools for the launcher's generated data.

mod geoip_table;

use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::process::ExitCode;
use tetra_core::classify::country_table::CountryTable;

const USAGE: &str = "\
usage: tetra-tools geoip-table <input> <output>

Turns a DB-IP country CSV, plain or .gz, into the packed IPv4 range table the
launcher reads at build time.";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("geoip-table") => match &args[1..] {
            [input, output] => geoip_table(input, output),
            _ => usage_error("geoip-table takes an input and an output path"),
        },
        Some("-h" | "--help" | "help") => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        Some(other) => usage_error(&format!("unknown command: {other}")),
        None => usage_error("no command given"),
    }
}

fn usage_error(message: &str) -> ExitCode {
    eprintln!("{message}\n\n{USAGE}");
    ExitCode::FAILURE
}

fn geoip_table(input: &str, output: &str) -> ExitCode {
    match write_table(Path::new(input), Path::new(output)) {
        Ok((count, size)) => {
            println!("{count} records, {size} bytes");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

fn is_gzip(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("gz"))
}

fn write_table(input: &Path, output: &Path) -> Result<(usize, usize), String> {
    let file = File::open(input).map_err(|e| format!("{}: {e}", input.display()))?;
    let bytes = if is_gzip(input) {
        geoip_table::build_gz(file)
    } else {
        geoip_table::build(std::io::BufReader::new(file))
    }
    .map_err(|e| format!("{}: {e}", input.display()))?;

    let table = CountryTable::parse(&bytes)
        .map_err(|e| format!("built a table that does not read back: {e}"))?;
    let mut out = File::create(output).map_err(|e| format!("{}: {e}", output.display()))?;
    out.write_all(&bytes)
        .map_err(|e| format!("{}: {e}", output.display()))?;
    Ok((table.len(), bytes.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_gz_extension_is_matched_in_any_case() {
        for (name, gzip) in [
            ("a.csv.gz", true),
            ("A.CSV.GZ", true),
            ("a.csv", false),
            ("gz", false),
        ] {
            assert_eq!(is_gzip(Path::new(name)), gzip, "{name}");
        }
    }
}
