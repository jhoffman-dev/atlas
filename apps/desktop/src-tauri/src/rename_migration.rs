//! The one-time move from Atlas to DFAI (#482, ADR-0042).

use std::path::{Path, PathBuf};

use crate::secrets::SecretStore;

pub const IDENTIFIER: &str = "com.dailyflowai.dfai";
pub const LEGACY_IDENTIFIER: &str = "dev.jhoffman.atlas";
pub const MARKER: &str = "migrated-from-atlas";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderPair {
    pub from: PathBuf,
    pub to: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Copied {
    Folder,
    NothingThere,
    AlreadyThere,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct SecretsCopied {
    pub copied: usize,
    pub already_there: usize,
    pub failed: Vec<String>,
}

pub struct Migration<'a> {
    pub home: &'a Path,
    pub legacy_secrets: &'a dyn SecretStore,
    pub secrets: &'a dyn SecretStore,
}

pub fn folders_under(_home: &Path) -> Vec<FolderPair> {
    todo!()
}

pub fn copy_folder_once(_pair: &FolderPair) -> Result<Copied, String> {
    todo!()
}

pub fn copy_secrets(
    _from: &dyn SecretStore,
    _to: &dyn SecretStore,
) -> Result<SecretsCopied, String> {
    todo!()
}

pub fn migrate(_migration: &Migration<'_>) -> Vec<String> {
    todo!()
}

#[cfg(test)]
mod tests;
