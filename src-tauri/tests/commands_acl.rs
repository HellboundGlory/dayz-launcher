use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

fn read(relative: &str) -> String {
    fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join(relative))
        .unwrap_or_else(|e| panic!("{relative}: {e}"))
}

fn between<'a>(text: &'a str, open: &str, close: &str) -> &'a str {
    let start = text
        .find(open)
        .unwrap_or_else(|| panic!("no `{open}` in the file"))
        + open.len();
    let end = text[start..]
        .find(close)
        .unwrap_or_else(|| panic!("no `{close}` after `{open}`"))
        + start;
    &text[start..end]
}

fn quoted(text: &str) -> impl Iterator<Item = &str> {
    text.split('"').skip(1).step_by(2)
}

fn handler_commands(lib_rs: &str) -> BTreeSet<String> {
    between(lib_rs, "generate_handler![", "]")
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(|entry| entry.rsplit("::").next().unwrap().to_string())
        .collect()
}

fn build_commands(build_rs: &str) -> BTreeSet<String> {
    quoted(between(build_rs, "const COMMANDS: &[&str] = &[", "]"))
        .map(str::to_string)
        .collect()
}

fn permission_set_commands(toml: &str) -> BTreeSet<String> {
    quoted(between(toml, "identifier = \"launcher-commands\"", "]"))
        .filter_map(|permission| permission.strip_prefix("allow-"))
        .map(|command| command.replace('-', "_"))
        .collect()
}

#[test]
fn app_commands_match_the_handler() {
    let handler = handler_commands(&read("src/lib.rs"));
    assert_eq!(build_commands(&read("build.rs")), handler);
    assert_eq!(
        permission_set_commands(&read("permissions/launcher.toml")),
        handler
    );
}
