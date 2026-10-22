//! The one script the hidden notebook window runs, and the reading of what
//! it answers.
//!
//! A page is fetched from inside the window: a same-origin `fetch` of the
//! notebook path, so Amazon's own session cookies go with it exactly as they
//! do for a browser, and never pass through DFAI's code. The script hands
//! back one JSON string of the page's status and text. Everything about
//! what that means is TypeScript's; what is decided here is only that the
//! answer is a notebook page (or says where it was sent), and is not too big.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::failure::{FailureKind, KindleFailure};
use super::notebook_url::shown_target;

/// A Mac that sleeps mid-sync, or an Amazon that never answers, ends the
/// request rather than holding it open; the next sync tries again.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// A notebook page of a few hundred highlights is well under a megabyte.
/// Anything this large is a mistake, and holding it would take the app down.
pub const MAX_PAGE_BYTES: usize = 8 * 1024 * 1024;

/// A page as the webview reads it: its status, its HTML, and where a
/// redirect off the notebook pointed (origin and path only).
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindlePage {
    pub status: u16,
    pub html: String,
    pub redirected_to: Option<String>,
}

/// The body of an async function, run in the hidden window's own script
/// world (its page cannot reach it). `target` is a path and query, set above
/// it as a JSON string; the script refuses to run anywhere but the notebook's
/// origin, and answers with a JSON string rather than a page's own words
/// beyond the HTML. It never reads `document.cookie`, storage or an error's
/// message (which can carry a URL).
const SCRIPT_BODY: &str = r#"
if (location.origin !== "https://read.amazon.com") {
  return JSON.stringify({ kind: "elsewhere" });
}
try {
  const response = await fetch(target, {
    credentials: "same-origin",
    headers: { Accept: "text/html" },
  });
  const final = new URL(response.url);
  if (final.origin !== location.origin || !notebookPaths.includes(final.pathname)) {
    return JSON.stringify({ kind: "moved", target: final.origin + final.pathname });
  }
  const html = await response.text();
  if (html.length > maxChars) {
    return JSON.stringify({ kind: "too_large" });
  }
  return JSON.stringify({ kind: "page", status: response.status, html: html });
} catch (error) {
  return JSON.stringify({ kind: "failed" });
}
"#;

/// The script for the notebook page `path_and_query`, with it set as a JSON
/// string so that nothing in it can end the literal.
pub fn fetch_script(path_and_query: &str) -> String {
    let target = serde_json::to_string(path_and_query).expect("a string is JSON");
    let paths =
        serde_json::to_string(&super::notebook_url::NOTEBOOK_PATHS).expect("paths are JSON");
    format!(
        "const target = {target};\nconst notebookPaths = {paths};\nconst maxChars = {MAX_PAGE_BYTES};{SCRIPT_BODY}"
    )
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Answer {
    Page { status: u16, html: String },
    Moved { target: String },
    TooLarge,
    Failed,
    Elsewhere,
}

/// What the script's answer comes to.
#[derive(Debug, PartialEq, Eq)]
pub enum ScriptAnswer {
    /// A page, or the notebook being sent somewhere else (as a redirect).
    Page(KindlePage),
    /// The fetch could not say why it failed — Amazon redirected to its
    /// sign-in, which a page may not read, or there was no connection. The
    /// window's own navigation, which is policed and can say, is asked.
    LookAtNavigation,
}

fn unreadable() -> KindleFailure {
    KindleFailure::new(
        FailureKind::Refused,
        "the notebook window answered in a shape DFAI cannot read",
    )
}

/// Reads the script's JSON answer.
pub fn read_answer(json: &str) -> Result<ScriptAnswer, KindleFailure> {
    match serde_json::from_str::<Answer>(json).map_err(|_| unreadable())? {
        Answer::Page { status, html } if html.len() <= MAX_PAGE_BYTES => {
            Ok(ScriptAnswer::Page(KindlePage {
                status,
                html,
                redirected_to: None,
            }))
        }
        Answer::Page { .. } | Answer::TooLarge => Err(KindleFailure::new(
            FailureKind::TooLarge,
            "Amazon's page is larger than DFAI will read",
        )),
        Answer::Moved { target } => {
            let shown = shown_target(&target);
            Ok(ScriptAnswer::Page(KindlePage {
                status: 302,
                html: String::new(),
                redirected_to: (!shown.is_empty()).then_some(shown),
            }))
        }
        Answer::Failed => Ok(ScriptAnswer::LookAtNavigation),
        Answer::Elsewhere => Err(unreadable()),
    }
}
