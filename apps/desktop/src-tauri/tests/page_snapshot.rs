//! The artifact thumbnail, made for real: pages loaded in the snapshot's own
//! WKWebView and pictured, on the main thread, with the run loop turned by
//! hand. macOS only; elsewhere there is nothing to test.

#[cfg(target_os = "macos")]
mod macos {
    use std::cell::RefCell;
    use std::rc::Rc;
    use std::time::{Duration, Instant};

    use atlas_lib::page_snapshot::{macos, snapshot_spec, SnapshotArgs};
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSBitmapImageRep};
    use objc2_foundation::{NSData, NSDate, NSRunLoop};

    type Outcome = Rc<RefCell<Option<Result<Vec<u8>, String>>>>;

    fn args(timeout_ms: u64) -> SnapshotArgs {
        SnapshotArgs {
            width: Some("1280".into()),
            height: Some("800".into()),
            picture_width: Some("640".into()),
            settle_ms: Some("300".into()),
            timeout_ms: Some(timeout_ms.to_string()),
        }
    }

    /// Pictures `html`, turning the run loop until it is done.
    fn picture(main: MainThreadMarker, html: &str, timeout_ms: u64) -> Result<Vec<u8>, String> {
        let spec = snapshot_spec(html.as_bytes(), &args(timeout_ms)).expect("a valid spec");
        let outcome: Outcome = Rc::default();
        let told = Rc::clone(&outcome);
        macos::start(
            main,
            spec,
            Box::new(move |result| *told.borrow_mut() = Some(result)),
        );
        let give_up = Instant::now() + Duration::from_millis(timeout_ms) + Duration::from_secs(5);
        while outcome.borrow().is_none() {
            assert!(Instant::now() < give_up, "the snapshot never finished");
            NSRunLoop::currentRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.05));
        }
        let result = outcome.borrow_mut().take().expect("an outcome");
        result
    }

    /// The picture's size, and the colour of its middle pixel as 0–255 RGB.
    fn size_and_middle(png: &[u8]) -> ((isize, isize), [u8; 3]) {
        let bitmap = NSBitmapImageRep::imageRepWithData(&NSData::with_bytes(png))
            .expect("the bytes are a picture");
        let (wide, high) = (bitmap.pixelsWide(), bitmap.pixelsHigh());
        let colour = bitmap.colorAtX_y(wide / 2, high / 2).expect("a pixel");
        let channel = |value: f64| (value * 255.0).round() as u8;
        let rgb = [
            channel(colour.redComponent()),
            channel(colour.greenComponent()),
            channel(colour.blueComponent()),
        ];
        ((wide, high), rgb)
    }

    fn near(actual: [u8; 3], expected: [u8; 3]) -> bool {
        actual
            .iter()
            .zip(expected)
            .all(|(a, e)| a.abs_diff(e) <= 12)
    }

    const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

    fn pictures_the_first_screen_at_the_picture_size(main: MainThreadMarker) {
        let png = picture(
            main,
            "<!doctype html><style>html,body{margin:0;height:100%;background:rgb(200,30,40)}</style>",
            15_000,
        )
        .expect("a picture");
        assert_eq!(png[..8], PNG_SIGNATURE);
        let (size, middle) = size_and_middle(&png);
        assert_eq!(size, (640, 400));
        assert!(near(middle, [200, 30, 40]), "middle pixel was {middle:?}");
    }

    fn pictures_what_the_page_s_script_drew(main: MainThreadMarker) {
        let png = picture(
            main,
            "<!doctype html><body style=margin:0><script>document.body.style.cssText=\
             'margin:0;height:100vh;background:rgb(20,160,60)'</script>",
            15_000,
        )
        .expect("a picture");
        let (_, middle) = size_and_middle(&png);
        assert!(near(middle, [20, 160, 60]), "middle pixel was {middle:?}");
    }

    /// A page that tries to leave is pictured where it is: the refresh and the
    /// script's navigation are both refused, and neither ends the snapshot.
    fn a_page_cannot_navigate_away(main: MainThreadMarker) {
        let png = picture(
            main,
            "<!doctype html><meta http-equiv=refresh content='0;url=https://example.com/'>\
             <style>html,body{margin:0;height:100%;background:rgb(30,40,200)}</style>\
             <script>location.href='https://example.com/away'</script>",
            15_000,
        )
        .expect("a picture");
        let (_, middle) = size_and_middle(&png);
        assert!(near(middle, [30, 40, 200]), "middle pixel was {middle:?}");
    }

    /// A page that never finishes loading — a script that never ends — is given
    /// up at the timeout.
    fn gives_up_at_the_timeout(main: MainThreadMarker) {
        let started = Instant::now();
        let error = picture(main, "<!doctype html><script>for (;;) {}</script>", 1_000)
            .expect_err("no picture");
        assert_eq!(error, "the page took too long to load");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    pub fn run() {
        let main = MainThreadMarker::new().expect("a harness-less test runs on the main thread");
        let _app = NSApplication::sharedApplication(main);
        type Case = (&'static str, fn(MainThreadMarker));
        let tests: [Case; 4] = [
            (
                "pictures_the_first_screen_at_the_picture_size",
                pictures_the_first_screen_at_the_picture_size,
            ),
            (
                "pictures_what_the_page_s_script_drew",
                pictures_what_the_page_s_script_drew,
            ),
            ("a_page_cannot_navigate_away", a_page_cannot_navigate_away),
            ("gives_up_at_the_timeout", gives_up_at_the_timeout),
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
