//! The PDF export, made for real: pages loaded in the export's own WKWebView
//! and printed, on the main thread, with the run loop turned by hand. macOS
//! only; elsewhere there is nothing to test.

#[cfg(target_os = "macos")]
mod macos {
    use std::cell::RefCell;
    use std::rc::Rc;
    use std::time::{Duration, Instant};

    use dfai_lib::export::pdf::{pdf_spec, PdfArgs};
    use dfai_lib::export::pdf_macos;
    use objc2::rc::Retained;
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::NSApplication;
    use objc2_foundation::{NSData, NSDate, NSRunLoop};
    use objc2_pdf_kit::{PDFDisplayBox, PDFDocument};

    type Outcome = Rc<RefCell<Option<Result<Vec<u8>, String>>>>;

    const LETTER: (u32, u32) = (612, 792);

    fn args(timeout_ms: u64) -> PdfArgs {
        PdfArgs {
            page_width: Some(LETTER.0.to_string()),
            page_height: Some(LETTER.1.to_string()),
            timeout_ms: Some(timeout_ms.to_string()),
        }
    }

    /// Makes a PDF of `html`, turning the run loop until it is done.
    fn print(main: MainThreadMarker, html: &str, timeout_ms: u64) -> Result<Vec<u8>, String> {
        let spec = pdf_spec(html.as_bytes(), &args(timeout_ms)).expect("a valid spec");
        let outcome: Outcome = Rc::default();
        let told = Rc::clone(&outcome);
        pdf_macos::start(
            main,
            spec,
            Box::new(move |result| *told.borrow_mut() = Some(result)),
        );
        let give_up = Instant::now() + Duration::from_millis(timeout_ms) + Duration::from_secs(5);
        while outcome.borrow().is_none() {
            assert!(Instant::now() < give_up, "the PDF never finished");
            NSRunLoop::currentRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.05));
        }
        let result = outcome.borrow_mut().take().expect("an outcome");
        result
    }

    fn document(pdf: &[u8]) -> Retained<PDFDocument> {
        // SAFETY: PDFKit reading bytes held for the call.
        unsafe { PDFDocument::initWithData(PDFDocument::alloc(), &NSData::with_bytes(pdf)) }
            .expect("the bytes are a PDF")
    }

    /// Each page's text and its media box's size, in points.
    fn pages(pdf: &[u8]) -> Vec<(String, (f64, f64))> {
        let document = document(pdf);
        // SAFETY: reading pages of a live document.
        unsafe {
            (0..document.pageCount())
                .map(|index| {
                    let page = document.pageAtIndex(index).expect("a page");
                    let text = page
                        .string()
                        .map(|text| text.to_string())
                        .unwrap_or_default();
                    let bounds = page.boundsForBox(PDFDisplayBox::MediaBox);
                    (text, (bounds.size.width, bounds.size.height))
                })
                .collect()
        }
    }

    fn one_page_is_a_pdf_that_can_be_saved(main: MainThreadMarker) {
        let pdf = print(
            main,
            "<!doctype html><body style=margin:0><h1>Kickoff with Larkspur Payroll</h1>",
            15_000,
        )
        .expect("a PDF");
        assert_eq!(&pdf[..4], b"%PDF");
        let dir = tempfile::tempdir().expect("a temp dir");
        let file = dir.path().join("Kickoff.pdf");
        std::fs::write(&file, &pdf).expect("written");
        assert!(std::fs::metadata(&file).expect("saved").len() > 0);
        let pages = pages(&pdf);
        assert_eq!(pages.len(), 1);
        assert!(
            pages[0].0.contains("Kickoff with Larkspur Payroll"),
            "{pages:?}"
        );
        assert_eq!(pages[0].1, (612.0, 792.0));
    }

    /// The page says it is three pages: each is printed from its own third,
    /// in order, at the page size.
    fn prints_each_page_the_script_laid_out(main: MainThreadMarker) {
        let page = |text: &str| {
            format!("<div style='height:792px;overflow:hidden;font:24px sans-serif'>{text}</div>")
        };
        let html = format!(
            "<!doctype html><html data-pages=\"3\"><body style=margin:0>{}{}{}",
            page("Page one: agenda"),
            page("Page two: decisions by Mara Quill"),
            page("Page three: follow-ups for Tobias Fenn"),
        );
        let pdf = print(main, &html, 15_000).expect("a PDF");
        let pages = pages(&pdf);
        assert_eq!(pages.len(), 3, "{pages:?}");
        let expected = ["Page one", "Page two", "Page three"];
        for ((text, size), (index, wanted)) in pages.iter().zip(expected.iter().enumerate()) {
            assert!(text.contains(wanted), "page {index}: {text:?}");
            for (other, unwanted) in expected.iter().enumerate() {
                if other != index {
                    assert!(!text.contains(unwanted), "page {index} has {unwanted}");
                }
            }
            assert_eq!(*size, (612.0, 792.0), "page {index}");
        }
    }

    /// A note that tries to leave is printed where it is: the refresh and the
    /// script's navigation are both refused, and neither ends the export.
    fn a_page_cannot_navigate_away(main: MainThreadMarker) {
        let pdf = print(
            main,
            "<!doctype html><meta http-equiv=refresh content='0;url=https://example.com/'>\
             <body><p>Stays here</p>\
             <script>location.href='https://example.com/away'</script>",
            15_000,
        )
        .expect("a PDF");
        let pages = pages(&pdf);
        assert_eq!(pages.len(), 1);
        assert!(pages[0].0.contains("Stays here"), "{pages:?}");
        assert!(!pages[0].0.contains("Example Domain"), "{pages:?}");
    }

    /// A page that never finishes loading — a script that never ends — is given
    /// up at the timeout.
    fn gives_up_at_the_timeout(main: MainThreadMarker) {
        let started = Instant::now();
        let error =
            print(main, "<!doctype html><script>for (;;) {}</script>", 1_000).expect_err("no PDF");
        assert_eq!(error, "timed out after 1000 ms");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    /// A page count past the cap is refused rather than printed.
    fn refuses_too_many_pages(main: MainThreadMarker) {
        let error =
            print(main, "<!doctype html><html data-pages=\"501\">", 15_000).expect_err("no PDF");
        assert_eq!(
            error,
            "a PDF export is at most 500 pages; this note makes 501"
        );
    }

    pub fn run() {
        let main = MainThreadMarker::new().expect("a harness-less test runs on the main thread");
        let _app = NSApplication::sharedApplication(main);
        type Case = (&'static str, fn(MainThreadMarker));
        let tests: [Case; 5] = [
            (
                "one_page_is_a_pdf_that_can_be_saved",
                one_page_is_a_pdf_that_can_be_saved,
            ),
            (
                "prints_each_page_the_script_laid_out",
                prints_each_page_the_script_laid_out,
            ),
            ("a_page_cannot_navigate_away", a_page_cannot_navigate_away),
            ("gives_up_at_the_timeout", gives_up_at_the_timeout),
            ("refuses_too_many_pages", refuses_too_many_pages),
        ];
        for (name, test) in tests {
            test(main);
            println!("test {name} ... ok");
        }
    }
}

fn main() {
    #[cfg(target_os = "macos")]
    macos::run();
}
