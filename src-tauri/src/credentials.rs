//! Saved server passwords, kept in the OS keyring.

use std::sync::OnceLock;

const SERVICE: &str = "Tetra Launcher";

/// Why the keyring could not be used. Holds the reason for the log, never a secret.
#[derive(Debug)]
pub struct KeyringUnavailable(pub String);

/// The part of the keyring the launcher uses, as a trait so tests need no real store.
pub trait SecretStore {
    fn get(&self, user: &str) -> Result<Option<String>, KeyringUnavailable>;
    fn set(&self, user: &str, secret: &str) -> Result<(), KeyringUnavailable>;
    fn delete(&self, user: &str) -> Result<(), KeyringUnavailable>;
}

/// The platform's own credential store, set as keyring-core's default on first use.
pub struct SystemKeyring;

/// What the dialog needs to know before it asks for a password.
#[derive(serde::Serialize)]
pub struct PasswordStatus {
    pub saved: bool,
    pub keyring: bool,
}

/// The keyring "user" for a server, so one server is one entry however the
/// frontend spelled its address. Rejecting anything else keeps bad input out
/// of the store's own key.
pub fn user_for(addr: &str) -> Result<String, String> {
    addr.parse::<std::net::SocketAddr>()
        .map(|parsed| parsed.to_string())
        .map_err(|_| "Invalid server address".to_string())
}

pub fn validate_password(pw: &str) -> Result<(), String> {
    if pw.is_empty() {
        return Err("Enter the server's password".into());
    }
    if pw.chars().count() > 256 {
        return Err("The password is longer than this launcher accepts".into());
    }
    if pw.chars().any(char::is_control) {
        return Err("The password contains characters a server won't accept".into());
    }
    Ok(())
}

/// The password to launch with: a typed one wins, otherwise the saved one, but
/// only when the join asked for it, so an unlocked server never touches the
/// keyring. An unreadable keyring is not a launch failure: the game gets none.
pub fn resolve_password(
    store: &dyn SecretStore,
    user: &str,
    typed: Option<String>,
    use_saved: bool,
) -> Result<Option<String>, String> {
    match typed {
        Some(pw) => {
            validate_password(&pw)?;
            Ok(Some(pw))
        }
        None if use_saved => Ok(store.get(user).ok().flatten()),
        None => Ok(None),
    }
}

/// A password is saved only when it was typed for a server join with Remember on.
pub fn should_save(typed: bool, remember: Option<bool>, main_menu: bool) -> bool {
    typed && remember == Some(true) && !main_menu
}

pub fn status(store: &dyn SecretStore, user: &str) -> PasswordStatus {
    match store.get(user) {
        Ok(saved) => PasswordStatus {
            saved: saved.is_some(),
            keyring: true,
        },
        Err(_) => PasswordStatus {
            saved: false,
            keyring: false,
        },
    }
}

impl SystemKeyring {
    /// The store is set up on first use rather than at startup, so a Join that
    /// arrives early waits here instead of racing the setup. The failure is
    /// logged once, from here, so later calls just read it back.
    fn store(&self) -> Result<(), KeyringUnavailable> {
        static INIT: OnceLock<Result<(), String>> = OnceLock::new();
        let ready = INIT.get_or_init(|| {
            let result = init_system_store();
            if let Err(reason) = &result {
                crate::log::line("credentials", &format!("no system keyring: {reason}"));
            }
            result
        });
        ready
            .as_ref()
            .map(|_| ())
            .map_err(|reason| KeyringUnavailable(reason.clone()))
    }

    fn entry(user: &str) -> Result<keyring_core::Entry, KeyringUnavailable> {
        keyring_core::Entry::new(SERVICE, user).map_err(|e| KeyringUnavailable(e.to_string()))
    }
}

impl SecretStore for SystemKeyring {
    fn get(&self, user: &str) -> Result<Option<String>, KeyringUnavailable> {
        self.store()?;
        match Self::entry(user)?.get_password() {
            Ok(pw) => Ok(Some(pw)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(e) => Err(KeyringUnavailable(e.to_string())),
        }
    }

    fn set(&self, user: &str, secret: &str) -> Result<(), KeyringUnavailable> {
        self.store()?;
        Self::entry(user)?
            .set_password(secret)
            .map_err(|e| KeyringUnavailable(e.to_string()))
    }

    fn delete(&self, user: &str) -> Result<(), KeyringUnavailable> {
        self.store()?;
        match Self::entry(user)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(e) => Err(KeyringUnavailable(e.to_string())),
        }
    }
}

/// Set the platform store as keyring-core's default. A failure is never fatal:
/// it only means there is no keyring, so the launcher asks every time.
#[cfg(target_os = "linux")]
fn init_system_store() -> Result<(), String> {
    let store = zbus_secret_service_keyring_store::Store::new()
        .map_err(|e| format!("no Secret Service: {e}"))?;
    keyring_core::set_default_store(store);
    Ok(())
}

#[cfg(windows)]
fn init_system_store() -> Result<(), String> {
    let store = windows_native_keyring_store::Store::new()
        .map_err(|e| format!("Credential Manager unavailable: {e}"))?;
    keyring_core::set_default_store(store);
    Ok(())
}

#[cfg(not(any(windows, target_os = "linux")))]
fn init_system_store() -> Result<(), String> {
    Err("No system keyring on this platform".into())
}

#[tauri::command]
pub async fn password_status(addr: String) -> Result<PasswordStatus, String> {
    let user = user_for(&addr)?;
    tauri::async_runtime::spawn_blocking(move || status(&SystemKeyring, &user))
        .await
        .map_err(|e| format!("Task join error: {e}"))
}

#[tauri::command]
pub async fn forget_password(addr: String) -> Result<(), String> {
    let user = user_for(&addr)?;
    tauri::async_runtime::spawn_blocking(move || SystemKeyring.delete(&user))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
        .map_err(|_| "No system keyring found".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;
    use tetra_launch::spawn::build_launch_args;

    #[derive(Default)]
    struct MemoryStore(Mutex<HashMap<String, String>>);

    impl SecretStore for MemoryStore {
        fn get(&self, user: &str) -> Result<Option<String>, KeyringUnavailable> {
            Ok(self.0.lock().unwrap().get(user).cloned())
        }

        fn set(&self, user: &str, secret: &str) -> Result<(), KeyringUnavailable> {
            self.0
                .lock()
                .unwrap()
                .insert(user.to_string(), secret.to_string());
            Ok(())
        }

        fn delete(&self, user: &str) -> Result<(), KeyringUnavailable> {
            self.0.lock().unwrap().remove(user);
            Ok(())
        }
    }

    struct NoKeyring;

    impl SecretStore for NoKeyring {
        fn get(&self, _: &str) -> Result<Option<String>, KeyringUnavailable> {
            Err(KeyringUnavailable("no store".into()))
        }

        fn set(&self, _: &str, _: &str) -> Result<(), KeyringUnavailable> {
            Err(KeyringUnavailable("no store".into()))
        }

        fn delete(&self, _: &str) -> Result<(), KeyringUnavailable> {
            Err(KeyringUnavailable("no store".into()))
        }
    }

    #[test]
    fn a_stored_password_reaches_the_launch_args() {
        let store = MemoryStore::default();
        store.set("1.2.3.4:27016", "from-keyring").unwrap();

        let pw = resolve_password(&store, "1.2.3.4:27016", None, true).unwrap();
        let args = build_launch_args(false, "1.2.3.4", 2302, pw.as_deref(), "", &[], None);
        assert!(args.contains(&"-password=from-keyring".to_string()));

        let typed = resolve_password(&store, "1.2.3.4:27016", Some("typed".into()), true).unwrap();
        assert_eq!(typed.as_deref(), Some("typed"));
    }

    #[test]
    fn an_unlocked_server_never_reads_the_keyring() {
        let store = MemoryStore::default();
        store.set("1.2.3.4:27016", "from-keyring").unwrap();
        assert_eq!(
            resolve_password(&store, "1.2.3.4:27016", None, false).unwrap(),
            None
        );
    }

    #[test]
    fn only_a_typed_password_for_a_server_join_is_saved() {
        let cases = [
            (true, Some(true), false, true),
            (true, Some(false), false, false),
            (true, None, false, false),
            (false, Some(true), false, false),
            (true, Some(true), true, false),
        ];
        for (typed, remember, main_menu, expected) in cases {
            assert_eq!(
                should_save(typed, remember, main_menu),
                expected,
                "{typed} {remember:?} {main_menu}"
            );
        }
    }

    #[test]
    fn a_missing_keyring_still_launches() {
        let store = NoKeyring;

        assert!(!status(&store, "1.2.3.4:27016").saved);
        assert!(!status(&store, "1.2.3.4:27016").keyring);

        let typed = resolve_password(&store, "1.2.3.4:27016", Some("typed".into()), true).unwrap();
        assert_eq!(typed.as_deref(), Some("typed"));
        assert_eq!(
            resolve_password(&store, "1.2.3.4:27016", None, true).unwrap(),
            None
        );
    }

    #[test]
    fn status_reports_what_is_saved() {
        let store = MemoryStore::default();
        assert!(!status(&store, "1.2.3.4:27016").saved);
        assert!(status(&store, "1.2.3.4:27016").keyring);

        store.set("1.2.3.4:27016", "pw").unwrap();
        assert!(status(&store, "1.2.3.4:27016").saved);
        assert!(status(&store, "1.2.3.4:27016").keyring);
    }

    #[test]
    fn passwords_are_checked_before_use() {
        let cases: &[(&str, bool)] = &[
            ("", false),
            (&"a".repeat(257), false),
            ("bad\nline", false),
            ("bad\ttab", false),
            ("bad\0nul", false),
            (&"a".repeat(256), true),
            ("with spaces", true),
            ("påsswörd", true),
        ];
        for (pw, ok) in cases {
            assert_eq!(validate_password(pw).is_ok(), *ok, "password: {pw:?}");
        }
    }

    #[test]
    fn server_addresses_normalise_to_one_keyring_user() {
        let cases: &[(&str, Option<&str>)] = &[
            ("1.2.3.4:27016", Some("1.2.3.4:27016")),
            ("[::1]:27016", Some("[::1]:27016")),
            ("1.2.3.4", None),
            ("host:27016", None),
            ("", None),
            ("1.2.3.4:99999", None),
        ];
        for (addr, want) in cases {
            assert_eq!(user_for(addr).ok().as_deref(), *want, "addr: {addr:?}");
        }
    }
}
