//! The PDF export's own webview, on macOS.
//!
//! A bare `WKWebView`, made here rather than through Tauri, as the thumbnail's
//! is (`page_snapshot/macos.rs`): no IPC handler, no `tauri://` scheme, a data
//! store that is never written to disk, in a window that is never shown. It
//! loads the note's HTML as a string and may not navigate anywhere else, so a
//! link or a script in the note cannot take it away. Scripts run — the
//! frontend's own pagination script is in the page — but cannot open windows.
//!
//! Once loaded, the page is asked how many pages it laid itself out in, and
//! WebKit prints one page-sized rect of it at a time; PDFKit joins them. Everything here runs on the main thread, as
//! AppKit and WebKit require, and the whole job is bounded by its timeout.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::ptr::NonNull;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2::{
    define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly, Message,
};
use objc2_app_kit::{NSBackingStoreType, NSWindow, NSWindowStyleMask};
use objc2_foundation::{
    NSData, NSError, NSNumber, NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString,
    NSTimer,
};
use objc2_pdf_kit::PDFDocument;
use objc2_web_kit::{
    WKNavigation, WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate,
    WKPDFConfiguration, WKWebView, WKWebViewConfiguration, WKWebsiteDataStore,
};

use super::pdf::{page_count, PdfSpec, PAGE_COUNT_SCRIPT};
use crate::page_snapshot::snapshot_may_load;

/// Told once, with the PDF or why there is none.
pub type OnDone = Box<dyn FnOnce(Result<Vec<u8>, String>)>;

/// `WebKitErrorFrameLoadInterruptedByPolicyChange`: a navigation this refused.
const REFUSED_NAVIGATION: isize = 102;
/// `NSURLErrorCancelled`: a load stopped for another, which is not a failure.
const CANCELLED: isize = -999;

/// A PDF under way, held until it is done.
struct Job {
    window: Retained<NSWindow>,
    view: Retained<WKWebView>,
    delegate: Retained<PdfExportDelegate>,
    timer: Retained<NSTimer>,
    width: f64,
    page_height: f64,
    /// One single-page PDF per page printed so far.
    pages: Vec<Retained<NSData>>,
    done: OnDone,
}

thread_local! {
    /// PDFs under way, by id: only the main thread ever touches them.
    static JOBS: RefCell<HashMap<u64, Job>> = RefCell::new(HashMap::new());
    static NEXT_ID: Cell<u64> = const { Cell::new(0) };
}

pub struct DelegateIvars {
    job: u64,
    loaded: Cell<bool>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = DelegateIvars]
    struct PdfExportDelegate;

    unsafe impl NSObjectProtocol for PdfExportDelegate {}

    unsafe impl WKNavigationDelegate for PdfExportDelegate {
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn decide_policy(
            &self,
            _view: &WKWebView,
            action: &WKNavigationAction,
            handler: &block2::Block<dyn Fn(WKNavigationActionPolicy)>,
        ) {
            // SAFETY: WebKit hands over a live action; its request is never nil.
            let url = unsafe { action.request() }
                .URL()
                .and_then(|url| url.absoluteString())
                .map(|url| url.to_string())
                .unwrap_or_default();
            let allowed = snapshot_may_load(&url);
            if !allowed {
                log::warn!("pdf export: refused a navigation to {url}");
            }
            handler.call((if allowed {
                WKNavigationActionPolicy::Allow
            } else {
                WKNavigationActionPolicy::Cancel
            },));
        }

        #[unsafe(method(webView:didFinishNavigation:))]
        fn did_finish(&self, _view: &WKWebView, _navigation: Option<&WKNavigation>) {
            if !self.ivars().loaded.replace(true) {
                count_pages(self.ivars().job);
            }
        }

        #[unsafe(method(webView:didFailNavigation:withError:))]
        fn did_fail(&self, _view: &WKWebView, _navigation: Option<&WKNavigation>, error: &NSError) {
            self.failed(error);
        }

        #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
        fn did_fail_provisional(
            &self,
            _view: &WKWebView,
            _navigation: Option<&WKNavigation>,
            error: &NSError,
        ) {
            self.failed(error);
        }

        #[unsafe(method(webViewWebContentProcessDidTerminate:))]
        fn process_ended(&self, _view: &WKWebView) {
            finish(self.ivars().job, Err("the page's process ended".into()));
        }
    }
);

impl PdfExportDelegate {
    fn new(main: MainThreadMarker, job: u64) -> Retained<Self> {
        let this = Self::alloc(main).set_ivars(DelegateIvars {
            job,
            loaded: Cell::new(false),
        });
        // SAFETY: NSObject's `init`, on a freshly allocated object.
        unsafe { msg_send![super(this), init] }
    }

    /// A refused navigation, or one stopped for another, leaves the page as
    /// it was; anything else before the page has loaded means there is none.
    fn failed(&self, error: &NSError) {
        let code = error.code();
        if code == REFUSED_NAVIGATION || code == CANCELLED || self.ivars().loaded.get() {
            return;
        }
        finish(
            self.ivars().job,
            Err(format!(
                "the page did not load: {}",
                error.localizedDescription()
            )),
        );
    }
}

/// Starts making `spec`'s PDF; `done` is told once, however it ends.
pub fn start(main: MainThreadMarker, spec: PdfSpec, done: OnDone) {
    let id = NEXT_ID.with(|next| next.replace(next.get() + 1));
    let delegate = PdfExportDelegate::new(main, id);
    let millis = spec.timeout.as_millis();
    let timer = after(spec.timeout, move || {
        finish(id, Err(format!("timed out after {millis} ms")))
    });
    let (width, page_height) = (f64::from(spec.page_width), f64::from(spec.page_height));
    // Copied into the NSString and its own bytes dropped: a job under way
    // holds only its numbers and the pages printed so far.
    let html = NSString::from_str(&spec.html);
    drop(spec);
    let (window, view) = export_view(main, NSSize::new(width, page_height), &delegate);
    JOBS.with(|jobs| {
        jobs.borrow_mut().insert(
            id,
            Job {
                window,
                view: view.clone(),
                delegate,
                timer,
                width,
                page_height,
                pages: Vec::new(),
                done,
            },
        )
    });
    // SAFETY: a live view, on the main thread. No base URL: the page's origin
    // is `about:blank`, which owns nothing.
    unsafe { view.loadHTMLString_baseURL(&html, None) };
}

/// A webview with nothing of the app in it, one page in size, in a window
/// that is never ordered onto the screen.
fn export_view(
    main: MainThreadMarker,
    size: NSSize,
    delegate: &PdfExportDelegate,
) -> (Retained<NSWindow>, Retained<WKWebView>) {
    // SAFETY: plain configuration calls on objects made here, on the main thread.
    unsafe {
        let configuration = WKWebViewConfiguration::new(main);
        configuration.setWebsiteDataStore(&WKWebsiteDataStore::nonPersistentDataStore(main));
        configuration
            .preferences()
            .setJavaScriptCanOpenWindowsAutomatically(false);
        let view = WKWebView::initWithFrame_configuration(
            WKWebView::alloc(main),
            NSRect::new(NSPoint::new(0.0, 0.0), size),
            &configuration,
        );
        view.setNavigationDelegate(Some(ProtocolObject::from_ref(delegate)));
        let window = NSWindow::initWithContentRect_styleMask_backing_defer(
            NSWindow::alloc(main),
            NSRect::new(NSPoint::new(-20_000.0, -20_000.0), size),
            NSWindowStyleMask::Borderless,
            NSBackingStoreType::Buffered,
            false,
        );
        window.setReleasedWhenClosed(false);
        window.setContentView(Some(&view));
        (window, view)
    }
}

/// Runs `action` once, `delay` from now, on the main thread's run loop.
fn after(delay: Duration, action: impl Fn() + 'static) -> Retained<NSTimer> {
    let block = RcBlock::new(move |_timer: NonNull<NSTimer>| action());
    // SAFETY: scheduled on this (the main) thread's run loop, so the block
    // runs here and never needs to cross threads.
    unsafe {
        NSTimer::scheduledTimerWithTimeInterval_repeats_block(delay.as_secs_f64(), false, &block)
    }
}

fn view_of(id: u64) -> Option<Retained<WKWebView>> {
    JOBS.with(|jobs| jobs.borrow().get(&id).map(|job| job.view.clone()))
}

/// Asks the loaded page how many pages its script laid it out in.
fn count_pages(id: u64) {
    let Some(view) = view_of(id) else {
        return;
    };
    let block = RcBlock::new(move |answer: *mut AnyObject, error: *mut NSError| {
        // SAFETY: WebKit passes a live answer or a live error, or null.
        let count = match unsafe { (answer.as_ref(), error.as_ref()) } {
            (_, Some(error)) => Err(format!(
                "the page could not be measured: {}",
                error.localizedDescription()
            )),
            (answer, None) => page_count(
                answer
                    .and_then(|answer| answer.downcast_ref::<NSNumber>())
                    .map(|number| number.as_f64()),
            ),
        };
        match count {
            Ok(count) => print_page(id, 0, count),
            Err(error) => finish(id, Err(error)),
        }
    });
    // SAFETY: a live view on the main thread; the script is a fixed string.
    unsafe {
        view.evaluateJavaScript_completionHandler(
            &NSString::from_str(PAGE_COUNT_SCRIPT),
            Some(&block),
        );
    }
}

/// Prints page `index` of `count`, then the next, then joins them.
///
/// The view stays one page tall: WebKit prints a rect below the visible frame
/// all the same (the integration test checks each page's text), and making the
/// view taller would change `100vh` under the page's layout and reflow it.
fn print_page(id: u64, index: u32, count: u32) {
    let Some((view, width, page_height)) = JOBS.with(|jobs| {
        jobs.borrow()
            .get(&id)
            .map(|job| (job.view.clone(), job.width, job.page_height))
    }) else {
        return;
    };
    let block = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
        // SAFETY: WebKit passes live data or a live error, or null.
        let page = match unsafe { (data.as_ref(), error.as_ref()) } {
            (Some(data), _) => data.retain(),
            (None, Some(error)) => {
                let reason = error.localizedDescription();
                return finish(id, Err(format!("WebKit could not make the PDF: {reason}")));
            }
            (None, None) => return finish(id, Err("WebKit could not make the PDF".into())),
        };
        let printed = JOBS.with(|jobs| {
            let mut jobs = jobs.borrow_mut();
            let job = jobs.get_mut(&id)?;
            job.pages.push(page);
            Some(job.pages.len())
        });
        match printed {
            Some(printed) if printed < count as usize => print_page(id, index + 1, count),
            Some(_) => {
                let joined = JOBS.with(|jobs| jobs.borrow().get(&id).map(|job| join(&job.pages)));
                if let Some(joined) = joined {
                    finish(id, joined);
                }
            }
            None => {}
        }
    });
    let rect = NSRect::new(
        NSPoint::new(0.0, page_height * f64::from(index)),
        NSSize::new(width, page_height),
    );
    // SAFETY: a live view on the main thread; the configuration is made here.
    unsafe {
        let configuration = WKPDFConfiguration::new(MainThreadMarker::from(&*view));
        configuration.setRect(rect);
        view.createPDFWithConfiguration_completionHandler(Some(&configuration), &block);
    }
}

/// The single-page PDFs as one document, in order.
fn join(pages: &[Retained<NSData>]) -> Result<Vec<u8>, String> {
    let unreadable = || "WebKit made a PDF that cannot be read".to_string();
    let [first, rest @ ..] = pages else {
        return Err("WebKit could not make the PDF".into());
    };
    if rest.is_empty() {
        return Ok(first.to_vec());
    }
    // SAFETY: PDFKit reading data WebKit made; the sources stay alive (in
    // `sources`) until the joined document has been written out.
    unsafe {
        let whole =
            PDFDocument::initWithData(PDFDocument::alloc(), first).ok_or_else(unreadable)?;
        let mut sources = Vec::with_capacity(rest.len());
        for data in rest {
            let source =
                PDFDocument::initWithData(PDFDocument::alloc(), data).ok_or_else(unreadable)?;
            for index in 0..source.pageCount() {
                let page = source.pageAtIndex(index).ok_or_else(unreadable)?;
                whole.insertPage_atIndex(&page, whole.pageCount());
            }
            sources.push(source);
        }
        let data = whole
            .dataRepresentation()
            .ok_or("PDFKit could not join the pages")?;
        drop(sources);
        Ok(data.to_vec())
    }
}

/// Ends a PDF: tells its caller, and tears its webview down.
///
/// The first end wins; later ones — a timeout after the last page, a failure
/// after a timeout — find nothing. The webview is dropped on the next turn of
/// the run loop, not here, since this is often called from inside one of its
/// own callbacks.
fn finish(id: u64, result: Result<Vec<u8>, String>) {
    let Some(job) = JOBS.with(|jobs| jobs.borrow_mut().remove(&id)) else {
        return;
    };
    job.timer.invalidate();
    // SAFETY: a live view on the main thread.
    unsafe {
        job.view.stopLoading();
        job.view.setNavigationDelegate(None);
    }
    job.window.setContentView(None);
    let Job {
        window,
        view,
        delegate,
        done,
        ..
    } = job;
    done(result);
    let remains = Cell::new(Some((window, view, delegate)));
    after(Duration::ZERO, move || drop(remains.take()));
}
