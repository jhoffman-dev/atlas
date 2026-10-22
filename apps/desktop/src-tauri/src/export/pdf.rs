//! A note's PDF, made by the system's own WebKit.
//!
//! The frontend renders the note to HTML and lays it out in pages with a
//! script of its own; this checks the numbers it sent, loads the page in a
//! `WKWebView` of its own (`pdf_macos.rs`), asks the page how many pages it
//! made, and has WebKit print each one. How a note looks, and where its pages
//! break, are decided before the HTML arrives.

use std::time::Duration;

/// The largest page taken, as for a thumbnail: a note's images are inlined.
pub const MAX_HTML_BYTES: usize = 64 * 1024 * 1024;

/// The most pages one export makes: a long transcript is a few dozen.
pub const MAX_PAGES: u32 = 500;

/// What the page is asked for its page count. A fixed expression: the
/// pagination script sets the attribute; a page without it is one page.
pub const PAGE_COUNT_SCRIPT: &str =
    "Number(document.documentElement.getAttribute('data-pages')) || 1";

/// A page's size, in points: from a small card to a large poster.
const PAGE_POINTS: std::ops::RangeInclusive<u32> = 200..=2000;
const TIMEOUT_MS: std::ops::RangeInclusive<u64> = 1_000..=120_000;

/// What to print, checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PdfSpec {
    pub html: String,
    pub page_width: u32,
    pub page_height: u32,
    /// How long the whole of it may take, load to last page.
    pub timeout: Duration,
}

/// The numbers the frontend sent, before they are checked.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct PdfArgs {
    pub page_width: Option<String>,
    pub page_height: Option<String>,
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

/// The page and the numbers, checked: UTF-8 text that is not empty and fits,
/// and a page size and timeout in the ranges above.
pub fn pdf_spec(page: &[u8], args: &PdfArgs) -> Result<PdfSpec, String> {
    if page.is_empty() {
        return Err("there is no page to make a PDF of".into());
    }
    if page.len() > MAX_HTML_BYTES {
        return Err(format!(
            "a page to make a PDF of is at most {} MB",
            MAX_HTML_BYTES / 1024 / 1024
        ));
    }
    let html = std::str::from_utf8(page)
        .map_err(|_| "the page is not UTF-8 text".to_string())?
        .to_owned();
    let page_width = number(args.page_width.as_deref(), "page width", &PAGE_POINTS)?;
    let page_height = number(args.page_height.as_deref(), "page height", &PAGE_POINTS)?;
    let timeout = number(args.timeout_ms.as_deref(), "timeout", &TIMEOUT_MS)?;
    Ok(PdfSpec {
        html,
        page_width,
        page_height,
        timeout: Duration::from_millis(timeout),
    })
}

/// The page count the page answered with, checked: a whole number of pages,
/// at least one and at most `MAX_PAGES`.
pub fn page_count(answer: Option<f64>) -> Result<u32, String> {
    let count = answer.ok_or("the page did not say how many pages it has")?;
    if !count.is_finite() || count.fract() != 0.0 || count < 1.0 {
        return Err(format!("the page says it has {count} pages"));
    }
    if count > f64::from(MAX_PAGES) {
        return Err(format!(
            "a PDF export is at most {MAX_PAGES} pages; this note makes {count}"
        ));
    }
    Ok(count as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args() -> PdfArgs {
        PdfArgs {
            page_width: Some("612".into()),
            page_height: Some("792".into()),
            timeout_ms: Some("30000".into()),
        }
    }

    #[test]
    fn takes_a_page_and_numbers_in_range() {
        let spec = pdf_spec(b"<p>Kickoff", &args()).unwrap();
        assert_eq!(
            spec,
            PdfSpec {
                html: "<p>Kickoff".into(),
                page_width: 612,
                page_height: 792,
                timeout: Duration::from_secs(30),
            }
        );
    }

    #[test]
    fn refuses_an_empty_oversized_or_binary_page() {
        assert_eq!(
            pdf_spec(b"", &args()).unwrap_err(),
            "there is no page to make a PDF of"
        );
        assert_eq!(
            pdf_spec(&[0xff, 0xfe, 0x00], &args()).unwrap_err(),
            "the page is not UTF-8 text"
        );
        let big = vec![b'a'; MAX_HTML_BYTES + 1];
        assert_eq!(
            pdf_spec(&big, &args()).unwrap_err(),
            "a page to make a PDF of is at most 64 MB"
        );
        assert!(pdf_spec(&big[..MAX_HTML_BYTES], &args()).is_ok());
    }

    #[test]
    fn refuses_missing_malformed_or_out_of_range_numbers() {
        type Spoil = fn(&mut PdfArgs);
        let cases: [(Spoil, &str); 8] = [
            (|a| a.page_width = None, "no page width was given"),
            (
                |a| a.page_width = Some("wide".into()),
                "the page width is not a whole number",
            ),
            (
                |a| a.page_width = Some("612.5".into()),
                "the page width is not a whole number",
            ),
            (
                |a| a.page_width = Some("199".into()),
                "the page width must be 200 to 2000",
            ),
            (
                |a| a.page_height = Some("2001".into()),
                "the page height must be 200 to 2000",
            ),
            (|a| a.timeout_ms = None, "no timeout was given"),
            (
                |a| a.timeout_ms = Some("999".into()),
                "the timeout must be 1000 to 120000",
            ),
            (
                |a| a.timeout_ms = Some("120001".into()),
                "the timeout must be 1000 to 120000",
            ),
        ];
        for (spoil, expected) in cases {
            let mut spoiled = args();
            spoil(&mut spoiled);
            assert_eq!(pdf_spec(b"<p>", &spoiled).unwrap_err(), expected);
        }
        let mut edges = args();
        edges.page_width = Some("200".into());
        edges.page_height = Some("2000".into());
        edges.timeout_ms = Some("120000".into());
        assert!(pdf_spec(b"<p>", &edges).is_ok());
    }

    #[test]
    fn takes_a_whole_page_count_from_one_to_the_most() {
        assert_eq!(page_count(Some(1.0)), Ok(1));
        assert_eq!(page_count(Some(3.0)), Ok(3));
        assert_eq!(page_count(Some(500.0)), Ok(500));
        assert_eq!(
            page_count(Some(501.0)).unwrap_err(),
            "a PDF export is at most 500 pages; this note makes 501"
        );
        for bad in [0.0, -2.0, 2.5, f64::NAN, f64::INFINITY] {
            assert!(page_count(Some(bad)).is_err(), "{bad}");
        }
        assert_eq!(
            page_count(None).unwrap_err(),
            "the page did not say how many pages it has"
        );
    }
}
