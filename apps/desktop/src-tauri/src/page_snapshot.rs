//! A picture of a page's first screen: an artifact's thumbnail.
//!
//! The page is a stranger's, so it is never shown in one of the app's own
//! webviews. On macOS it gets a `WKWebView` of its own (`macos.rs`) — not a
//! Tauri webview, so it has no IPC, no app origin and no custom scheme — which
//! loads the page, is pictured, and is thrown away. What to picture, how big,
//! and how long to wait are the caller's; this checks only that the numbers
//! are ones a picture can be made with, and that the page fits in memory.
//! Elsewhere there is no picture, and the caller keeps its placeholder.

use std::time::Duration;

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Runtime};
use tokio::sync::oneshot;

use crate::vault_files::header;

#[cfg(target_os = "macos")]
pub mod macos;

/// The largest page taken: the most the frontend writes into one (48 MB of a
/// copy's files), and the page around them.
pub const MAX_PAGE_BYTES: usize = 64 * 1024 * 1024;

const WIDTH_HEADER: &str = "atlas-width";
const HEIGHT_HEADER: &str = "atlas-height";
const PICTURE_WIDTH_HEADER: &str = "atlas-picture-width";
const SETTLE_HEADER: &str = "atlas-settle-ms";
const TIMEOUT_HEADER: &str = "atlas-timeout-ms";

/// The screen the page is laid out on, in points, and the picture's size.
const SCREEN: std::ops::RangeInclusive<u32> = 200..=4096;
const PICTURE: std::ops::RangeInclusive<u32> = 16..=4096;
const SETTLE_MS: std::ops::RangeInclusive<u64> = 0..=10_000;
const TIMEOUT_MS: std::ops::RangeInclusive<u64> = 1_000..=60_000;

/// What to picture, checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapshotSpec {
    pub html: String,
    /// The page is laid out `width` × `height` points…
    pub width: u32,
    pub height: u32,
    /// …and pictured this many pixels wide, as tall as keeps its shape.
    pub picture_width: u32,
    /// How long after the page has loaded before it is pictured: fonts, the
    /// first frames of a script's drawing.
    pub settle: Duration,
    /// How long the whole of it may take before it is given up.
    pub timeout: Duration,
}

impl SnapshotSpec {
    /// The picture's height: the screen's shape at the picture's width.
    pub fn picture_height(&self) -> u32 {
        self.shape().picture_height()
    }

    /// The page, to hand to the webview, and the numbers a snapshot under way
    /// still needs — so it does not hold a page of up to 64 MB until it ends.
    pub fn into_parts(self) -> (String, SnapshotShape) {
        let shape = self.shape();
        (self.html, shape)
    }

    fn shape(&self) -> SnapshotShape {
        SnapshotShape {
            width: self.width,
            height: self.height,
            picture_width: self.picture_width,
            settle: self.settle,
        }
    }
}

/// What a snapshot under way needs once its page has been handed over.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SnapshotShape {
    pub width: u32,
    pub height: u32,
    pub picture_width: u32,
    pub settle: Duration,
}

impl SnapshotShape {
    /// The picture's height: the screen's shape at the picture's width.
    pub fn picture_height(&self) -> u32 {
        let height = u64::from(self.height) * u64::from(self.picture_width) / u64::from(self.width);
        u32::try_from(height.max(1)).unwrap_or(u32::MAX)
    }
}

/// The numbers the frontend sent, before they are checked.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct SnapshotArgs {
    pub width: Option<String>,
    pub height: Option<String>,
    pub picture_width: Option<String>,
    pub settle_ms: Option<String>,
    pub timeout_ms: Option<String>,
}

fn number<T: std::str::FromStr + PartialOrd + std::fmt::Display>(
    raw: Option<&str>,
    name: &str,
    range: &std::ops::RangeInclusive<T>,
) -> Result<T, String> {
    let raw = raw.ok_or_else(|| format!("no {name} was given"))?;
    let value = raw
        .parse::<T>()
        .map_err(|_| format!("the {name} is not a whole number"))?;
    if !range.contains(&value) {
        return Err(format!(
            "the {name} must be {} to {}",
            range.start(),
            range.end()
        ));
    }
    Ok(value)
}

/// The page and the numbers, checked: text that is not empty and fits, and
/// sizes and waits in the ranges above, with a picture no wider than the page.
pub fn snapshot_spec(page: &[u8], args: &SnapshotArgs) -> Result<SnapshotSpec, String> {
    if page.is_empty() {
        return Err("there is no page to picture".into());
    }
    if page.len() > MAX_PAGE_BYTES {
        return Err(format!(
            "a page to picture is at most {} MB",
            MAX_PAGE_BYTES / 1024 / 1024
        ));
    }
    let html = std::str::from_utf8(page)
        .map_err(|_| "the page is not UTF-8 text".to_string())?
        .to_owned();
    let width = number(args.width.as_deref(), "width", &SCREEN)?;
    let height = number(args.height.as_deref(), "height", &SCREEN)?;
    let picture_width = number(args.picture_width.as_deref(), "picture width", &PICTURE)?;
    if picture_width > width {
        return Err("the picture cannot be wider than the page".into());
    }
    let settle = number(args.settle_ms.as_deref(), "settle time", &SETTLE_MS)?;
    let timeout = number(args.timeout_ms.as_deref(), "timeout", &TIMEOUT_MS)?;
    Ok(SnapshotSpec {
        html,
        width,
        height,
        picture_width,
        settle: Duration::from_millis(settle),
        timeout: Duration::from_millis(timeout),
    })
}

/// Whether the snapshot's own webview may go to `url`: only the empty and
/// inline documents it and its frames start as. The page arrives as a string,
/// so every other navigation — a `<meta http-equiv=refresh>`, `location = …`,
/// a link followed — is the page trying to leave, and is refused.
pub fn snapshot_may_load(url: &str) -> bool {
    let scheme = url.split(':').next().unwrap_or_default();
    scheme.eq_ignore_ascii_case("about")
}

/// Pictures the page in the raw body, as a PNG. The sizes and waits arrive as
/// headers; see `snapshot_spec` for what is refused.
#[tauri::command]
pub async fn snapshot_page<R: Runtime>(
    app: AppHandle<R>,
    request: Request<'_>,
) -> Result<Response, String> {
    let InvokeBody::Raw(page) = request.body() else {
        return Err("the page must be the body of the call".into());
    };
    let args = SnapshotArgs {
        width: header(&request, WIDTH_HEADER)?,
        height: header(&request, HEIGHT_HEADER)?,
        picture_width: header(&request, PICTURE_WIDTH_HEADER)?,
        settle_ms: header(&request, SETTLE_HEADER)?,
        timeout_ms: header(&request, TIMEOUT_HEADER)?,
    };
    let spec = snapshot_spec(page, &args)?;
    // The webview gives up on its own at the timeout; this is only in case the
    // main thread never gets to it at all.
    let deadline = spec.timeout + Duration::from_secs(5);
    let (sender, receiver) = oneshot::channel();
    start(&app, spec, sender)?;
    let bytes = tokio::time::timeout(deadline, receiver)
        .await
        .map_err(|_| "the picture took too long".to_string())?
        .map_err(|_| "the picture was given up".to_string())??;
    Ok(Response::new(bytes))
}

type Done = oneshot::Sender<Result<Vec<u8>, String>>;

#[cfg(target_os = "macos")]
fn start<R: Runtime>(app: &AppHandle<R>, spec: SnapshotSpec, sender: Done) -> Result<(), String> {
    app.run_on_main_thread(move || {
        let Some(main) = objc2::MainThreadMarker::new() else {
            // Tauri runs this on the main thread; nothing else can make the view.
            let _ = sender.send(Err("not on the main thread".into()));
            return;
        };
        macos::start(
            main,
            spec,
            Box::new(move |result| {
                // The command stopped waiting (its own deadline): nobody to tell.
                let _ = sender.send(result);
            }),
        );
    })
    .map_err(|error| format!("cannot reach the main thread: {error}"))
}

#[cfg(not(target_os = "macos"))]
fn start<R: Runtime>(
    _app: &AppHandle<R>,
    _spec: SnapshotSpec,
    _sender: Done,
) -> Result<(), String> {
    Err("thumbnails are made on macOS only".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args() -> SnapshotArgs {
        SnapshotArgs {
            width: Some("1280".into()),
            height: Some("800".into()),
            picture_width: Some("640".into()),
            settle_ms: Some("600".into()),
            timeout_ms: Some("15000".into()),
        }
    }

    #[test]
    fn takes_a_page_and_numbers_in_range() {
        let spec = snapshot_spec(b"<p>hi", &args()).unwrap();
        assert_eq!(spec.html, "<p>hi");
        assert_eq!(
            (spec.width, spec.height, spec.picture_width),
            (1280, 800, 640)
        );
        assert_eq!(spec.picture_height(), 400);
        assert_eq!(spec.settle, Duration::from_millis(600));
        assert_eq!(spec.timeout, Duration::from_secs(15));
    }

    #[test]
    fn hands_the_page_over_and_keeps_only_the_numbers() {
        let spec = snapshot_spec(b"<p>hi", &args()).unwrap();
        let (html, shape) = spec.into_parts();
        assert_eq!(html, "<p>hi");
        assert_eq!(
            shape,
            SnapshotShape {
                width: 1280,
                height: 800,
                picture_width: 640,
                settle: Duration::from_millis(600),
            }
        );
        assert_eq!(shape.picture_height(), 400);
        // What a snapshot under way holds is a few numbers, whatever the page's size.
        assert!(std::mem::size_of::<SnapshotShape>() <= 32);
    }

    #[test]
    fn refuses_an_empty_oversized_or_binary_page() {
        assert!(snapshot_spec(b"", &args()).is_err());
        assert!(snapshot_spec(&[0xff, 0xfe, 0x00], &args()).is_err());
        let big = vec![b'a'; MAX_PAGE_BYTES + 1];
        let error = snapshot_spec(&big, &args()).unwrap_err();
        assert!(error.starts_with("a page to picture is at most"), "{error}");
        assert!(snapshot_spec(&big[..MAX_PAGE_BYTES], &args()).is_ok());
    }

    #[test]
    fn refuses_missing_malformed_or_out_of_range_numbers() {
        type Spoil = fn(&mut SnapshotArgs);
        let cases: [(Spoil, &str); 9] = [
            (|a| a.width = None, "no width was given"),
            (
                |a| a.width = Some("wide".into()),
                "the width is not a whole number",
            ),
            (
                |a| a.width = Some("-1".into()),
                "the width is not a whole number",
            ),
            (
                |a| a.width = Some("199".into()),
                "the width must be 200 to 4096",
            ),
            (
                |a| a.height = Some("4097".into()),
                "the height must be 200 to 4096",
            ),
            (
                |a| a.picture_width = Some("15".into()),
                "the picture width must be 16 to 4096",
            ),
            (
                |a| a.picture_width = Some("1281".into()),
                "the picture cannot be wider than the page",
            ),
            (
                |a| a.settle_ms = Some("10001".into()),
                "the settle time must be 0 to 10000",
            ),
            (
                |a| a.timeout_ms = Some("999".into()),
                "the timeout must be 1000 to 60000",
            ),
        ];
        for (spoil, expected) in cases {
            let mut spoiled = args();
            spoil(&mut spoiled);
            assert_eq!(snapshot_spec(b"<p>", &spoiled).unwrap_err(), expected);
        }
    }

    #[test]
    fn keeps_the_screen_s_shape_at_any_picture_width() {
        let mut spec = snapshot_spec(b"<p>", &args()).unwrap();
        spec.picture_width = 1;
        assert_eq!(spec.picture_height(), 1);
        spec.picture_width = 1280;
        assert_eq!(spec.picture_height(), 800);
    }

    #[test]
    fn the_snapshot_view_loads_only_its_starting_documents() {
        for url in ["about:blank", "about:srcdoc", "ABOUT:blank"] {
            assert!(snapshot_may_load(url), "{url} should load");
        }
        for url in [
            "https://beacon.test/",
            "http://localhost:1420/",
            "tauri://localhost/",
            "file:///etc/passwd",
            "data:text/html,<p>",
            "javascript:alert(1)",
            "",
        ] {
            assert!(!snapshot_may_load(url), "{url} should be refused");
        }
    }
}
