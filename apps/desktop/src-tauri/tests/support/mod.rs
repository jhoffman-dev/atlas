//! Where the integration tests keep the real model between runs.

use std::path::PathBuf;

/// `ATLAS_TEST_MODEL_DIR` when set — CI points it at a folder it caches by
/// the model's revision, since the build's temporary folder is not kept —
/// and the build's temporary folder otherwise.
pub fn model_home() -> PathBuf {
    std::env::var_os("ATLAS_TEST_MODEL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_TARGET_TMPDIR")))
}
