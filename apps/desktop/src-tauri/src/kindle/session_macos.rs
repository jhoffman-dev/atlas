//! The Kindle session's own WebKit data store, the window it is signed into,
//! and the hidden window that reads the notebook, on macOS.
//!
//! The store is persistent, named by an identifier of DFAI's own, and used by
//! nothing else: the main window keeps the default store, so no Amazon cookie
//! is ever in it, and nothing in the main window can read this one. Both
//! windows here are bare `WKWebView`s, made here rather than through Tauri as
//! the PDF export's is (`export/pdf_macos.rs`): no IPC handler, no script
//! message handler, no `tauri://` scheme, nothing of the app injected into
//! Amazon's pages. The sign-in window may only go to Amazon over https; the
//! reading window is never shown and may only go to the notebook. Neither
//! can open windows of its own.
//!
//! No cookie is read, here or anywhere: the session stays inside WebKit, and
//! a page is fetched by a script running in the reading window (`page_script`).
//!
//! Everything here runs on the main thread, as AppKit and WebKit require.

use std::cell::RefCell;
use std::ptr::NonNull;
use std::rc::Rc;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSBackingStoreType, NSWindow, NSWindowDelegate, NSWindowStyleMask};
use objc2_foundation::{
    NSArray, NSDictionary, NSError, NSNotification, NSObject, NSObjectProtocol,
    NSOperatingSystemVersion, NSPoint, NSProcessInfo, NSRect, NSSize, NSString, NSURLRequest,
    NSURL, NSUUID,
};
use objc2_web_kit::{
    WKContentWorld, WKNavigation, WKNavigationAction, WKNavigationActionPolicy,
    WKNavigationDelegate, WKNavigationResponse, WKNavigationResponsePolicy, WKWebView,
    WKWebViewConfiguration, WKWebsiteDataStore,
};

use super::notebook_url::shown_target;
use super::{reader_may_load, NOTEBOOK_START};

/// The store's identifier: fixed, so the session outlives a relaunch, and
/// DFAI's own, so no other webview opens it.
const STORE_ID: [u8; 16] = [
    0x5d, 0x0f, 0x4a, 0x1e, 0x8b, 0x7c, 0x4c, 0x2a, 0x9e, 0x3b, 0x6a, 0x1d, 0x2f, 0x7c, 0x0b, 0x94,
];

/// Told once, when the sign-in window has closed.
pub type OnClosed = Box<dyn FnOnce()>;

/// Whether this Mac has data stores of a session's own (macOS 14). On an
/// older one, WebKit has only the default store, which the main window
/// uses, so Kindle sync is refused rather than put the session in it.
pub fn has_stores_of_its_own() -> bool {
    NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(NSOperatingSystemVersion {
        majorVersion: 14,
        minorVersion: 0,
        patchVersion: 0,
    })
}

fn session_store(main: MainThreadMarker) -> Retained<WKWebsiteDataStore> {
    // SAFETY: a fixed, non-zero identifier, on the main thread (macOS 14,
    // which every caller has checked with `has_stores_of_its_own`).
    unsafe { WKWebsiteDataStore::dataStoreForIdentifier(&NSUUID::from_bytes(STORE_ID), main) }
}

/// Whether the session's store exists: not until Connect Kindle has made it,
/// and not again after Disconnect. Asking does not make it, so a sync that was
/// never connected never opens a window.
pub fn store_exists(main: MainThreadMarker, done: Box<dyn FnOnce(bool)>) {
    let done = RefCell::new(Some(done));
    let block = RcBlock::new(move |identifiers: NonNull<NSArray<NSUUID>>| {
        // SAFETY: WebKit hands over a live array for the length of the call.
        let identifiers = unsafe { identifiers.as_ref() };
        let ours = NSUUID::from_bytes(STORE_ID);
        let exists = identifiers.iter().any(|identifier| identifier == ours);
        if let Some(done) = done.take() {
            done(exists);
        }
    });
    // SAFETY: a block WebKit calls once, on the main thread.
    unsafe { WKWebsiteDataStore::fetchAllDataStoreIdentifiers(&block, main) };
}

/// Deletes the session's store, and every cookie in it. WebKit refuses
/// while a view still uses it, so the sign-in window must be closed first.
pub fn remove_store(main: MainThreadMarker, done: Box<dyn FnOnce(Result<(), String>)>) {
    if SIGN_IN.with(|open| open.borrow().is_some()) {
        done(Err("close the Connect Kindle window first".into()));
        return;
    }
    reset_reader();
    let done = RefCell::new(Some(done));
    let block = RcBlock::new(move |error: *mut NSError| {
        // SAFETY: nil, or an error WebKit keeps alive for the call.
        let failure = unsafe { error.as_ref() }.map(|error| {
            format!(
                "cannot forget the Kindle session: {}",
                error.localizedDescription()
            )
        });
        if let Some(done) = done.take() {
            done(failure.map_or(Ok(()), Err));
        }
    });
    // SAFETY: a fixed identifier and a block WebKit calls once, on the main thread.
    unsafe {
        WKWebsiteDataStore::removeDataStoreForIdentifier_completionHandler(
            &NSUUID::from_bytes(STORE_ID),
            &block,
            main,
        );
    }
}

/// The sign-in window while it is open, and who is waiting for it to close.
struct SignIn {
    window: Retained<NSWindow>,
    view: Retained<WKWebView>,
    delegate: Retained<SignInDelegate>,
    waiting: Vec<OnClosed>,
}

thread_local! {
    /// Only the main thread ever touches it.
    static SIGN_IN: RefCell<Option<SignIn>> = const { RefCell::new(None) };
}

pub struct SignInIvars {
    may_load: fn(&str) -> bool,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = SignInIvars]
    struct SignInDelegate;

    unsafe impl NSObjectProtocol for SignInDelegate {}

    unsafe impl WKNavigationDelegate for SignInDelegate {
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
            let allowed = (self.ivars().may_load)(&url);
            if !allowed {
                // Never the URL: a sign-in page's query can carry a token.
                log::warn!("kindle sign-in: refused a navigation off Amazon");
            }
            handler.call((if allowed {
                WKNavigationActionPolicy::Allow
            } else {
                WKNavigationActionPolicy::Cancel
            },));
        }
    }

    unsafe impl NSWindowDelegate for SignInDelegate {
        #[unsafe(method(windowWillClose:))]
        fn window_will_close(&self, _notification: &NSNotification) {
            closed();
        }
    }
);

impl SignInDelegate {
    fn new(main: MainThreadMarker, may_load: fn(&str) -> bool) -> Retained<Self> {
        let this = Self::alloc(main).set_ivars(SignInIvars { may_load });
        // SAFETY: NSObject's `init`, on a freshly allocated object.
        unsafe { msg_send![super(this), init] }
    }
}

/// The window has closed: everyone waiting is told, and the view is let go
/// on the next turn of the run loop, once AppKit has finished closing it,
/// so the store can then be removed.
fn closed() {
    let Some(sign_in) = SIGN_IN.with(|open| open.borrow_mut().take()) else {
        return;
    };
    let SignIn {
        window,
        view,
        delegate,
        waiting,
    } = sign_in;
    // SAFETY: plain calls on live objects, on the main thread.
    unsafe {
        view.setNavigationDelegate(None);
        window.setDelegate(None);
    }
    for done in waiting {
        done();
    }
    let held = RefCell::new(Some((window, view, delegate)));
    let release = RcBlock::new(move |_timer: NonNull<objc2_foundation::NSTimer>| {
        held.borrow_mut().take();
    });
    // SAFETY: scheduled on this (the main) thread's run loop.
    unsafe {
        objc2_foundation::NSTimer::scheduledTimerWithTimeInterval_repeats_block(
            0.0, false, &release,
        );
    }
}

fn sign_in_view(
    main: MainThreadMarker,
    delegate: &SignInDelegate,
) -> (Retained<NSWindow>, Retained<WKWebView>) {
    let size = NSSize::new(480.0, 720.0);
    // SAFETY: plain configuration calls on objects made here, on the main thread.
    unsafe {
        let configuration = WKWebViewConfiguration::new(main);
        configuration.setWebsiteDataStore(&session_store(main));
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
            NSRect::new(NSPoint::new(0.0, 0.0), size),
            NSWindowStyleMask::Titled
                | NSWindowStyleMask::Closable
                | NSWindowStyleMask::Resizable
                | NSWindowStyleMask::Miniaturizable,
            NSBackingStoreType::Buffered,
            false,
        );
        window.setReleasedWhenClosed(false);
        window.setTitle(&NSString::from_str("Connect Kindle"));
        window.setContentView(Some(&view));
        window.setDelegate(Some(ProtocolObject::from_ref(delegate)));
        window.center();
        (window, view)
    }
}

/// Opens the sign-in window at `start`, or brings the open one forward;
/// `done` is told when it closes, however that happens.
pub fn open_sign_in(
    main: MainThreadMarker,
    start: &str,
    may_load: fn(&str) -> bool,
    done: OnClosed,
) -> Result<(), String> {
    let already = SIGN_IN.with(|open| open.borrow().as_ref().map(|sign_in| sign_in.window.clone()));
    if let Some(window) = already {
        SIGN_IN.with(|open| {
            if let Some(sign_in) = open.borrow_mut().as_mut() {
                sign_in.waiting.push(done);
            }
        });
        window.makeKeyAndOrderFront(None);
        return Ok(());
    }
    let url = NSURL::URLWithString(&NSString::from_str(start)).ok_or("not a URL")?;
    let delegate = SignInDelegate::new(main, may_load);
    let (window, view) = sign_in_view(main, &delegate);
    // SAFETY: a live view, on the main thread, loading a fixed Amazon page.
    unsafe { view.loadRequest(&NSURLRequest::requestWithURL(&url)) };
    window.makeKeyAndOrderFront(None);
    SIGN_IN.with(|open| {
        *open.borrow_mut() = Some(SignIn {
            window,
            view,
            delegate,
            waiting: vec![done],
        });
    });
    Ok(())
}

// ---- The reading window ----------------------------------------------------

/// How a policed load of the notebook ended.
pub enum Loaded {
    /// The notebook page itself loaded.
    Page,
    /// The window was sent off the notebook — to Amazon's sign-in, say — and
    /// was stopped there; this is where it pointed, origin and path only.
    Blocked(String),
    /// The load failed; whether it ran out of time. No URL, no detail.
    Failed { timed_out: bool },
}

type OnLoaded = Box<dyn FnOnce(Loaded)>;

/// What the reading window's delegate and its owner share.
#[derive(Default)]
struct ReadState {
    /// Where the last refused main-frame navigation pointed.
    blocked: Option<String>,
    waiting: Option<OnLoaded>,
}

struct Reader {
    view: Retained<WKWebView>,
    /// Held, not read: a view keeps its navigation delegate weakly.
    _delegate: Retained<ReaderDelegate>,
    state: Rc<RefCell<ReadState>>,
    /// Whether the notebook has loaded in it, so a fetch can run.
    ready: bool,
}

thread_local! {
    /// Only the main thread ever touches it.
    static READER: RefCell<Option<Reader>> = const { RefCell::new(None) };
}

pub struct ReaderIvars {
    state: Rc<RefCell<ReadState>>,
}

/// NSURLErrorTimedOut.
const URL_ERROR_TIMED_OUT: isize = -1001;

fn url_of(request_url: Option<Retained<NSURL>>) -> String {
    request_url
        .and_then(|url| url.absoluteString())
        .map(|url| url.to_string())
        .unwrap_or_default()
}

impl ReaderDelegate {
    fn new(main: MainThreadMarker, state: Rc<RefCell<ReadState>>) -> Retained<Self> {
        let this = Self::alloc(main).set_ivars(ReaderIvars { state });
        // SAFETY: NSObject's `init`, on a freshly allocated object.
        unsafe { msg_send![super(this), init] }
    }

    fn finish(&self, outcome: Loaded) {
        // Taken out before it is called: the callback may ask for another load.
        let waiting = self.ivars().state.borrow_mut().waiting.take();
        if let Some(done) = waiting {
            done(outcome);
        }
    }

    fn refuse(&self, url: &str, main_frame: bool) {
        if main_frame {
            // Never the URL in a log: a sign-in page's query can carry a token.
            log::warn!("kindle reader: stopped a navigation off the notebook");
            self.ivars().state.borrow_mut().blocked = Some(shown_target(url));
        }
    }

    fn failed(&self, error: &NSError) {
        let blocked = self.ivars().state.borrow_mut().blocked.take();
        self.finish(match blocked {
            Some(target) => Loaded::Blocked(target),
            None => Loaded::Failed {
                timed_out: error.code() == URL_ERROR_TIMED_OUT,
            },
        });
    }
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[ivars = ReaderIvars]
    struct ReaderDelegate;

    unsafe impl NSObjectProtocol for ReaderDelegate {}

    unsafe impl WKNavigationDelegate for ReaderDelegate {
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn decide_action(
            &self,
            _view: &WKWebView,
            action: &WKNavigationAction,
            handler: &block2::Block<dyn Fn(WKNavigationActionPolicy)>,
        ) {
            // SAFETY: WebKit hands over a live action; its request is never nil.
            let url = url_of(unsafe { action.request() }.URL());
            // SAFETY: a plain read of a live action's frame.
            let main_frame = unsafe {
                action
                    .targetFrame()
                    .is_some_and(|frame| frame.isMainFrame())
            };
            // A navigation with no frame is a new window, which is never allowed.
            let allowed = main_frame && reader_may_load(&url);
            if !allowed {
                self.refuse(&url, main_frame);
            }
            handler.call((if allowed {
                WKNavigationActionPolicy::Allow
            } else {
                WKNavigationActionPolicy::Cancel
            },));
        }

        #[unsafe(method(webView:decidePolicyForNavigationResponse:decisionHandler:))]
        fn decide_response(
            &self,
            _view: &WKWebView,
            response: &WKNavigationResponse,
            handler: &block2::Block<dyn Fn(WKNavigationResponsePolicy)>,
        ) {
            // SAFETY: WebKit hands over a live response.
            let url = url_of(unsafe { response.response() }.URL());
            // SAFETY: a plain read of a live response.
            let main_frame = unsafe { response.isForMainFrame() };
            let allowed = reader_may_load(&url);
            if !allowed {
                self.refuse(&url, main_frame);
            }
            handler.call((if allowed {
                WKNavigationResponsePolicy::Allow
            } else {
                WKNavigationResponsePolicy::Cancel
            },));
        }

        #[unsafe(method(webView:didFinishNavigation:))]
        fn did_finish(&self, _view: &WKWebView, _navigation: Option<&WKNavigation>) {
            self.finish(Loaded::Page);
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
    }
);

fn reader_view(main: MainThreadMarker, delegate: &ReaderDelegate) -> Retained<WKWebView> {
    // SAFETY: plain configuration calls on objects made here, on the main
    // thread. The view is never put in a window, so it is never shown.
    unsafe {
        let configuration = WKWebViewConfiguration::new(main);
        configuration.setWebsiteDataStore(&session_store(main));
        configuration
            .preferences()
            .setJavaScriptCanOpenWindowsAutomatically(false);
        let view = WKWebView::initWithFrame_configuration(
            WKWebView::alloc(main),
            NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1024.0, 768.0)),
            &configuration,
        );
        view.setNavigationDelegate(Some(ProtocolObject::from_ref(delegate)));
        view
    }
}

/// Lets the reading window go. The next fetch makes a new one.
pub fn reset_reader() {
    let Some(reader) = READER.with(|reader| reader.borrow_mut().take()) else {
        return;
    };
    // SAFETY: plain calls on live objects, on the main thread.
    unsafe {
        reader.view.stopLoading();
        reader.view.setNavigationDelegate(None);
    }
    // Whoever was waiting for a load is told it failed: nobody is left to wait.
    let waiting = reader.state.borrow_mut().waiting.take();
    if let Some(done) = waiting {
        done(Loaded::Failed { timed_out: false });
    }
}

/// Loads the notebook in the reading window, making the window if there is
/// none; `done` is told once. Every navigation and response is policed by
/// `reader_may_load`, so a session that has lapsed is stopped at Amazon's
/// door and reported as where it pointed.
pub fn load_notebook(main: MainThreadMarker, done: OnLoaded) {
    let ready = READER.with(|reader| reader.borrow().as_ref().is_some_and(|reader| reader.ready));
    if ready {
        done(Loaded::Page);
        return;
    }
    reset_reader();
    let state = Rc::new(RefCell::new(ReadState::default()));
    let delegate = ReaderDelegate::new(main, state.clone());
    let view = reader_view(main, &delegate);
    let marked_ready: OnLoaded = Box::new(move |loaded| {
        if matches!(loaded, Loaded::Page) {
            READER.with(|reader| {
                if let Some(reader) = reader.borrow_mut().as_mut() {
                    reader.ready = true;
                }
            });
        }
        done(loaded);
    });
    state.borrow_mut().waiting = Some(marked_ready);
    let Some(url) = NSURL::URLWithString(&NSString::from_str(NOTEBOOK_START)) else {
        reset_reader();
        return;
    };
    // SAFETY: a live view, on the main thread, loading a fixed Amazon page.
    unsafe { view.loadRequest(&NSURLRequest::requestWithURL(&url)) };
    READER.with(|reader| {
        *reader.borrow_mut() = Some(Reader {
            view,
            _delegate: delegate,
            state,
            ready: false,
        });
    });
}

/// Runs `script` in the loaded notebook; `done` is told its string answer,
/// or that it failed (without the error's words, which can carry a URL).
pub fn run_script(main: MainThreadMarker, script: &str, done: Box<dyn FnOnce(Result<String, ()>)>) {
    let Some(view) =
        READER.with(|reader| reader.borrow().as_ref().map(|reader| reader.view.clone()))
    else {
        done(Err(()));
        return;
    };
    let done = RefCell::new(Some(done));
    let block = RcBlock::new(move |result: *mut AnyObject, error: *mut NSError| {
        let answer = if error.is_null() {
            // SAFETY: nil, or an object WebKit keeps alive for the call.
            unsafe { result.as_ref() }
                .and_then(|result| result.downcast_ref::<NSString>())
                .map(|text| text.to_string())
                .ok_or(())
        } else {
            Err(())
        };
        if let Some(done) = done.take() {
            done(answer);
        }
    });
    // SAFETY: plain calls on a live view, on the main thread. The script
    // runs in the app's own content world, out of the page's reach, with no
    // arguments (the target is in the script as a JSON string).
    unsafe {
        view.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
            &NSString::from_str(script),
            Some(&NSDictionary::<NSString, AnyObject>::new()),
            None,
            &WKContentWorld::defaultClientWorld(main),
            Some(&block),
        );
    }
}
