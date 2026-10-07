//! Where each secret may be sent.
//!
//! A source note is text anyone could have written — a synced vault, an MCP
//! client through the local API — so the note cannot be what decides where a
//! Keychain value goes. Each secret is bound, when it is set in Settings, to
//! the origins (scheme, host and port) it is for, and the host refuses a
//! request whose origin is not bound to every secret it carries (ADR-0017).
//!
//! The binding is kept beside the value, in the Keychain, under account
//! `<vault>:origins/<name>` — outside the vault, and out of the `<vault>/`
//! accounts that list as names. It is written only by `secret_set` and
//! `secret_bind`, and sending a value that is already stored somewhere new is
//! asked about natively, where the webview cannot answer for the person.

use reqwest::Url;
use serde::Serialize;

use super::{account, checked_name, SecretStore};

/// Origins are stored one per line.
const SEPARATOR: char = '\n';

fn binding_account(scope: &str, name: &str) -> Result<String, String> {
    Ok(format!("{scope}:origins/{}", checked_name(name)?))
}

/// An origin as typed in Settings, as the one string it is compared by: https,
/// a host, a port only when it is not 443, and nothing after it. TypeScript
/// turns what was typed into this form; this is the backstop, and the refusal
/// names the input, which is not a secret.
fn canonical_origin(raw: &str) -> Result<String, String> {
    let refused = || format!("{raw:?} is not an https origin such as https://api.github.com");
    let url = Url::parse(raw.trim()).map_err(|_| refused())?;
    let bare = url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none();
    if bare {
        Ok(url.origin().ascii_serialization())
    } else {
        Err(refused())
    }
}

fn canonical_origins(raw: &[String]) -> Result<Vec<String>, String> {
    let mut origins = raw
        .iter()
        .map(|origin| canonical_origin(origin))
        .collect::<Result<Vec<_>, _>>()?;
    if origins.is_empty() {
        return Err("a secret needs at least one site it may be sent to".into());
    }
    origins.sort();
    origins.dedup();
    Ok(origins)
}

/// The origins a secret may be sent to; empty when it has never been bound.
pub fn bound_origins(
    store: &dyn SecretStore,
    scope: &str,
    name: &str,
) -> Result<Vec<String>, String> {
    let stored = store
        .get(&binding_account(scope, name)?)?
        .unwrap_or_default();
    Ok(stored
        .split(SEPARATOR)
        .filter(|origin| !origin.is_empty())
        .map(str::to_string)
        .collect())
}

/// Refuses unless `origin` is bound to every secret in `used`. Names only in
/// the refusal; the caller strikes the values from the origin.
pub fn check_bound(
    store: &dyn SecretStore,
    scope: &str,
    used: &[(String, String)],
    origin: &str,
) -> Result<(), String> {
    for (name, _) in used {
        let bound = bound_origins(store, scope, name)?;
        if bound.is_empty() {
            return Err(format!(
                "the secret {name:?} is not bound to a site yet — choose where it may be sent in Settings → Secrets"
            ));
        }
        if !bound.iter().any(|allowed| allowed == origin) {
            return Err(format!(
                "the secret {name:?} is only sent to {}, not {origin}",
                bound.join(", ")
            ));
        }
    }
    Ok(())
}

/// A change to one secret: a new value, new origins, or both.
pub struct SecretWrite<'a> {
    pub scope: &'a str,
    pub name: &'a str,
    /// None keeps the value that is stored.
    pub value: Option<&'a str>,
    /// None keeps the binding that is stored.
    pub origins: Option<&'a [String]>,
}

/// Asked before a stored value may go to origins it was not bound to: the
/// secret's name and the origins that would be added. True allows it.
pub type AllowWidening<'a> = dyn Fn(&str, &[String]) -> bool + 'a;

/// Stores a value, a binding, or both.
///
/// A value typed now is the caller's own and may be bound anywhere. A value
/// already stored is not: sending it to an origin it was not bound to is asked
/// about first. The value is written before the binding, so a request between
/// the two sends the new value to the old origins, never the old one to new.
pub fn write_secret(
    store: &dyn SecretStore,
    write: &SecretWrite,
    allow: &AllowWidening,
) -> Result<(), String> {
    let value_account = account(write.scope, write.name)?;
    let origins = write.origins.map(canonical_origins).transpose()?;

    if let (Some(origins), None) = (&origins, write.value) {
        if store.get(&value_account)?.is_none() {
            return Err(format!(
                "the secret {:?} is not set for this vault",
                write.name
            ));
        }
        let bound = bound_origins(store, write.scope, write.name)?;
        let added: Vec<String> = origins
            .iter()
            .filter(|origin| !bound.contains(origin))
            .cloned()
            .collect();
        if !added.is_empty() && !allow(write.name, &added) {
            return Err(format!(
                "the secret {:?} was not allowed to be sent to {}",
                write.name,
                added.join(", ")
            ));
        }
    }

    if let Some(value) = write.value {
        store.set(&value_account, value)?;
    }
    if let Some(origins) = origins {
        let joined = origins.join(&SEPARATOR.to_string());
        store.set(&binding_account(write.scope, write.name)?, &joined)?;
    }
    Ok(())
}

/// Removes a secret's value and its binding.
pub fn remove_secret(store: &dyn SecretStore, scope: &str, name: &str) -> Result<(), String> {
    store.delete(&account(scope, name)?)?;
    store.delete(&binding_account(scope, name)?)
}

/// One secret as the webview lists it: its name and where it may be sent.
#[derive(Debug, Serialize)]
pub struct SecretEntry {
    pub name: String,
    pub origins: Vec<String>,
}

/// This vault's secrets, by name, each with its origins. Never a value.
pub fn entries_in(store: &dyn SecretStore, scope: &str) -> Result<Vec<SecretEntry>, String> {
    super::names_in(store.accounts()?, scope)
        .into_iter()
        .map(|name| {
            // A name stored before the name rule tightened cannot be looked
            // up, bound or sent; it is listed so that it can be deleted.
            let origins = match checked_name(&name) {
                Ok(_) => bound_origins(store, scope, &name)?,
                Err(_) => Vec::new(),
            };
            Ok(SecretEntry { name, origins })
        })
        .collect()
}
