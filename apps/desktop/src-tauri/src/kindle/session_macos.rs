//! The Kindle session's own WebKit data store, and the window it is signed
//! into, on macOS.
//!
//! The store is persistent, named by an identifier of DFAI's own, and used by
//! nothing else: the main window keeps the default store, so no Amazon cookie
//! is ever in it, and nothing in the main window can read this one. The
//! sign-in window is a bare `WKWebView`, made here rather than through Tauri
//! as the PDF export's is (`export/pdf_macos.rs`): no IPC handler, no
//! `tauri://` scheme, nothing of the app injected into Amazon's pages. It may
//! only go to Amazon over https, and it cannot open windows of its own.
//!
//! Everything here runs on the main thread, as AppKit and WebKit require.

use std::cell::RefCell;
use std::ptr::NonNull;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSBackingStoreType, NSWindow, NSWindowDelegate, NSWindowStyleMask};
use objc2_foundation::{
    NSArray, NSError, NSHTTPCookie, NSNotification, NSObject, NSObjectProtocol,
    NSOperatingSystemVersion, NSPoint, NSProcessInfo, NSRect, NSSize, NSString, NSURLRequest,
    NSURL, NSUUID,
};
use objc2_web_kit::{
    WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate, WKWebView,
    WKWebViewConfiguration, WKWebsiteDataStore,
};

use super::cookies::SessionCookie;

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

fn cookie_of(cookie: &NSHTTPCookie) -> SessionCookie {
    SessionCookie {
        name: cookie.name().to_string(),
        value: cookie.value().to_string(),
        domain: cookie.domain().to_string(),
        path: cookie.path().to_string(),
        secure: cookie.isSecure(),
    }
}

/// Reads every cookie the session's store holds; `done` is told once.
pub fn read_cookies(main: MainThreadMarker, done: Box<dyn FnOnce(Vec<SessionCookie>)>) {
    let done = RefCell::new(Some(done));
    let block = RcBlock::new(move |cookies: NonNull<NSArray<NSHTTPCookie>>| {
        // SAFETY: WebKit hands over a live array for the length of the call.
        let cookies = unsafe { cookies.as_ref() };
        let read = cookies.iter().map(|cookie| cookie_of(&cookie)).collect();
        if let Some(done) = done.take() {
            done(read);
        }
    });
    // SAFETY: the store's own cookie store, asked on the main thread, which
    // is where WebKit calls the block back.
    unsafe { session_store(main).httpCookieStore().getAllCookies(&block) };
}

/// Deletes the session's store, and every cookie in it. WebKit refuses
/// while a view still uses it, so the sign-in window must be closed first.
pub fn remove_store(main: MainThreadMarker, done: Box<dyn FnOnce(Result<(), String>)>) {
    if SIGN_IN.with(|open| open.borrow().is_some()) {
        done(Err("close the Connect Kindle window first".into()));
        return;
    }
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
