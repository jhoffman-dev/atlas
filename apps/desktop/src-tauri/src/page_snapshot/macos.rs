//! The snapshot's own webview, on macOS.
//!
//! A bare `WKWebView`, made here rather than through Tauri, so nothing of the
//! app is in it: no IPC handler, no `tauri://` scheme, no injected scripts,
//! and a data store of its own that is never written to disk. It is put in a
//! window that is never shown, loads the page as a string (so its origin is
//! `about:blank`, not the app's), may not navigate anywhere
//! (`snapshot_may_load`), cannot open windows (no UI delegate, and scripts
//! may not open them), and is torn down the moment it is pictured, fails, or
//! runs out of time. Everything here runs on the main thread, as AppKit and
//! WebKit require.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::ptr::NonNull;
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{
    define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly,
};
use objc2_app_kit::{
    NSBackingStoreType, NSBitmapImageFileType, NSBitmapImageRep, NSCompositingOperation,
    NSDeviceRGBColorSpace, NSGraphicsContext, NSImage, NSImageInterpolation, NSWindow,
    NSWindowStyleMask,
};
use objc2_foundation::{
    NSDictionary, NSError, NSNumber, NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString,
    NSTimer,
};
use objc2_web_kit::{
    WKNavigation, WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate,
    WKSnapshotConfiguration, WKWebView, WKWebViewConfiguration, WKWebsiteDataStore,
};

use super::{snapshot_may_load, SnapshotShape, SnapshotSpec};

/// Told once, with the PNG or why there is none.
pub type OnDone = Box<dyn FnOnce(Result<Vec<u8>, String>)>;

/// `WebKitErrorFrameLoadInterruptedByPolicyChange`: a navigation this refused.
const REFUSED_NAVIGATION: isize = 102;
/// `NSURLErrorCancelled`: a load stopped for another, which is not a failure.
const CANCELLED: isize = -999;

/// A snapshot under way, held until it is done.
struct Job {
    window: Retained<NSWindow>,
    view: Retained<WKWebView>,
    delegate: Retained<SnapshotDelegate>,
    timers: Vec<Retained<NSTimer>>,
    shape: SnapshotShape,
    done: OnDone,
}

thread_local! {
    /// Snapshots under way, by id: only the main thread ever touches them.
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
    struct SnapshotDelegate;

    unsafe impl NSObjectProtocol for SnapshotDelegate {}

    unsafe impl WKNavigationDelegate for SnapshotDelegate {
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
                log::warn!("thumbnail: refused a navigation to {url}");
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
                settle_then_picture(self.ivars().job);
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

impl SnapshotDelegate {
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

/// Starts picturing `spec`'s page; `done` is told once, however it ends.
pub fn start(main: MainThreadMarker, spec: SnapshotSpec, done: OnDone) {
    let id = NEXT_ID.with(|next| next.replace(next.get() + 1));
    let delegate = SnapshotDelegate::new(main, id);
    let timeout = after(spec.timeout, move || {
        finish(id, Err("the page took too long to load".into()))
    });
    // The page is copied into the NSString and its own bytes dropped here: a
    // snapshot under way holds only its numbers.
    let (page, shape) = spec.into_parts();
    let html = NSString::from_str(&page);
    drop(page);
    let (window, view) = snapshot_view(main, shape, &delegate);
    JOBS.with(|jobs| {
        jobs.borrow_mut().insert(
            id,
            Job {
                window,
                view: view.clone(),
                delegate,
                timers: vec![timeout],
                shape,
                done,
            },
        )
    });
    // SAFETY: a live view, on the main thread. No base URL: the page's origin
    // is `about:blank`, which owns nothing.
    unsafe { view.loadHTMLString_baseURL(&html, None) };
}

/// A webview with nothing of the app in it, the page's screen size, in a
/// window that is never ordered onto the screen.
fn snapshot_view(
    main: MainThreadMarker,
    shape: SnapshotShape,
    delegate: &SnapshotDelegate,
) -> (Retained<NSWindow>, Retained<WKWebView>) {
    let size = NSSize::new(f64::from(shape.width), f64::from(shape.height));
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

/// Once the page has loaded, gives it the settle time, then pictures it.
fn settle_then_picture(id: u64) {
    let Some(settle) = JOBS.with(|jobs| jobs.borrow().get(&id).map(|job| job.shape.settle)) else {
        return;
    };
    let timer = after(settle, move || picture(id));
    JOBS.with(|jobs| {
        if let Some(job) = jobs.borrow_mut().get_mut(&id) {
            job.timers.push(timer);
        }
    });
}

fn picture(id: u64) {
    let Some((view, shape)) = JOBS.with(|jobs| {
        jobs.borrow()
            .get(&id)
            .map(|job| (job.view.clone(), job.shape))
    }) else {
        return;
    };
    let (width, height) = (shape.picture_width, shape.picture_height());
    let block = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
        // SAFETY: WebKit passes a live image or a live error, or null.
        let result = match unsafe { (image.as_ref(), error.as_ref()) } {
            (Some(image), _) => png_of(image, width, height),
            (None, Some(error)) => Err(format!("no picture: {}", error.localizedDescription())),
            (None, None) => Err("no picture".into()),
        };
        finish(id, result);
    });
    // SAFETY: a live view on the main thread; the configuration is made here.
    unsafe {
        let configuration = WKSnapshotConfiguration::new(MainThreadMarker::from(&*view));
        configuration.setSnapshotWidth(Some(&NSNumber::new_f64(f64::from(shape.width))));
        view.takeSnapshotWithConfiguration_completionHandler(Some(&configuration), &block);
    }
}

/// `image` drawn into exactly `width` × `height` pixels, as PNG.
fn png_of(image: &NSImage, width: u32, height: u32) -> Result<Vec<u8>, String> {
    let (wide, high) = (width as isize, height as isize);
    // SAFETY: a null `planes` asks AppKit to allocate the bitmap itself.
    let bitmap = unsafe {
        NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
            NSBitmapImageRep::alloc(),
            std::ptr::null_mut(),
            wide,
            high,
            8,
            4,
            true,
            false,
            NSDeviceRGBColorSpace,
            0,
            0,
        )
    }
    .ok_or("cannot make a bitmap")?;
    let context = NSGraphicsContext::graphicsContextWithBitmapImageRep(&bitmap)
        .ok_or("cannot draw into the bitmap")?;
    NSGraphicsContext::saveGraphicsState_class();
    NSGraphicsContext::setCurrentContext(Some(&context));
    context.setImageInterpolation(NSImageInterpolation::High);
    let whole = NSRect::new(
        NSPoint::new(0.0, 0.0),
        NSSize::new(f64::from(width), f64::from(height)),
    );
    image.drawInRect_fromRect_operation_fraction(
        whole,
        NSRect::ZERO,
        NSCompositingOperation::Copy,
        1.0,
    );
    context.flushGraphics();
    NSGraphicsContext::restoreGraphicsState_class();
    // SAFETY: an empty dictionary is a valid set of properties for PNG.
    let data = unsafe {
        bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }
    .ok_or("cannot encode the picture")?;
    Ok(data.to_vec())
}

/// Ends a snapshot: tells its caller, and tears its webview down.
///
/// The first end wins; later ones — a timeout after the picture, a failure
/// after a timeout — find nothing. The webview is dropped on the next turn of
/// the run loop, not here, since this is often called from inside one of its
/// own callbacks.
fn finish(id: u64, result: Result<Vec<u8>, String>) {
    let Some(job) = JOBS.with(|jobs| jobs.borrow_mut().remove(&id)) else {
        return;
    };
    for timer in &job.timers {
        timer.invalidate();
    }
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
