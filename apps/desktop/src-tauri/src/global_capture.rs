//! The global capture shortcut (#81, ADR-0033): one system-wide key that
//! brings Atlas forward with quick capture open, whatever app has the keyboard.
//!
//! The host registers it and, when it is pressed, raises the window and emits
//! `global-capture` — nothing more. What capture then does, and what happens
//! with no vault open, is the webview's to say. Which shortcut, and its
//! default, are the webview's too: it keeps the choice for this Mac and hands
//! it here when it starts. The one thing checked here is the backstop for an
//! untrusted caller (ADR-0017): a shortcut with no ⌘, ⌥ or ⌃ would take its
//! key from every other app, so it is refused, as the domain refuses it.

use std::str::FromStr;
use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// `GLOBAL_CAPTURE_EVENT` in `packages/application/src/inbox/global-capture.ts`.
const GLOBAL_CAPTURE_EVENT: &str = "global-capture";
/// The window quick capture opens in.
const MAIN_WINDOW: &str = "main";

/// The shortcut as Settings shows it: `GlobalCaptureShortcut` in the application.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalCaptureStatus {
    pub shortcut: Option<String>,
    pub registered: bool,
    pub problem: Option<String>,
}

/// The shortcut in force, if any: what the next change has to unregister.
#[derive(Default)]
pub struct GlobalCaptureState(Mutex<Held>);

#[derive(Default)]
struct Held {
    status: GlobalCaptureStatus,
    registered: Option<Shortcut>,
}

impl GlobalCaptureState {
    fn held(&self) -> MutexGuard<'_, Held> {
        // Every change to `Held` is a whole-field assignment, so a panic
        // elsewhere cannot leave it half-updated.
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// The plugin, listening for the one shortcut this module registers.
pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            // Only the press: the release would raise the window a second time.
            if event.state == ShortcutState::Pressed {
                on_pressed(app);
            }
        })
        .build()
}

/// Raises the window wherever it is, then tells the webview to open capture.
fn on_pressed<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        log::warn!("global capture was pressed with no {MAIN_WINDOW} window to open it in");
        return;
    };
    if let Err(error) = bring_forward(&window) {
        // Capture still opens: the window may already be in front.
        log::warn!("global capture could not bring the window forward: {error}");
    }
    if let Err(error) = app.emit_to(MAIN_WINDOW, GLOBAL_CAPTURE_EVENT, ()) {
        log::error!("global capture could not reach the window: {error}");
    }
}

/// What raising the window needs of it: a seam, so the order is tested without a window.
trait Raise {
    fn unminimize(&self) -> Result<(), String>;
    fn show(&self) -> Result<(), String>;
    fn on_every_space(&self, every: bool) -> Result<(), String>;
    fn focus(&self) -> Result<(), String>;
}

impl<R: Runtime> Raise for WebviewWindow<R> {
    fn unminimize(&self) -> Result<(), String> {
        WebviewWindow::unminimize(self).map_err(|error| error.to_string())
    }
    fn show(&self) -> Result<(), String> {
        WebviewWindow::show(self).map_err(|error| error.to_string())
    }
    fn on_every_space(&self, every: bool) -> Result<(), String> {
        self.set_visible_on_all_workspaces(every)
            .map_err(|error| error.to_string())
    }
    fn focus(&self) -> Result<(), String> {
        activate_app();
        self.set_focus().map_err(|error| error.to_string())
    }
}

/// Out of the Dock, onto the Space being looked at, and in front with the
/// keyboard. Joining every Space for a moment is what moves the window to this
/// one rather than sending the person to the Space it was left on; leaving
/// them again keeps it here.
fn bring_forward(window: &impl Raise) -> Result<(), String> {
    window.unminimize()?;
    window.show()?;
    window.on_every_space(true)?;
    let focused = window.focus();
    // Left on every Space only if this fails too, and then it is said.
    window.on_every_space(false)?;
    focused
}

/// The app in front. `set_focus` alone skips it while the window is still
/// coming out of the Dock, which would leave capture open behind another app.
#[cfg(target_os = "macos")]
fn activate_app() {
    use objc2_app_kit::NSApplication;
    let Some(main) = objc2::MainThreadMarker::new() else {
        log::warn!("global capture was handled off the main thread; set_focus activates instead");
        return;
    };
    // `activate` is macOS 14 and later; this is the call that works on every
    // macOS the app runs on, deprecated but not removed.
    #[allow(deprecated)]
    NSApplication::sharedApplication(main).activateIgnoringOtherApps(true);
}

#[cfg(not(target_os = "macos"))]
fn activate_app() {}

/// A shortcut the host will register, or why not. The domain's rule
/// (`globalShortcutFromKeys`) is the one the person meets; this is the backstop.
fn vetted(text: &str) -> Result<Shortcut, String> {
    let shortcut = Shortcut::from_str(text)
        .map_err(|error| format!("{text} is not a shortcut Atlas can register: {error}"))?;
    let claiming = Modifiers::SUPER | Modifiers::CONTROL | Modifiers::ALT;
    if !shortcut.mods.intersects(claiming) {
        return Err(format!(
            "{text} has no ⌘, ⌥ or ⌃, so it would take its key from every other app"
        ));
    }
    Ok(shortcut)
}

#[tauri::command]
pub fn global_capture_status(state: State<'_, GlobalCaptureState>) -> GlobalCaptureStatus {
    state.held().status.clone()
}

/// Registers `shortcut` in place of the one in force, or none when it is null.
/// A shortcut refused here changes nothing; one the system will not take —
/// another app holds it — is kept as the choice and reported as not registered.
#[tauri::command]
pub fn global_capture_set<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, GlobalCaptureState>,
    shortcut: Option<String>,
) -> Result<GlobalCaptureStatus, String> {
    let wanted = shortcut.as_deref().map(vetted).transpose()?;
    let shortcuts = app.global_shortcut();
    let mut held = state.held();
    if let Some(previous) = held.registered.take() {
        if let Err(error) = shortcuts.unregister(previous) {
            // Nothing to undo: the system no longer holds it for this app either way.
            log::warn!("the previous global capture shortcut could not be released: {error}");
        }
    }
    held.status = match wanted {
        None => GlobalCaptureStatus::default(),
        Some(next) => match shortcuts.register(next) {
            Ok(()) => {
                held.registered = Some(next);
                registered(shortcut)
            }
            Err(error) => taken(shortcut, &error.to_string()),
        },
    };
    Ok(held.status.clone())
}

fn registered(shortcut: Option<String>) -> GlobalCaptureStatus {
    GlobalCaptureStatus {
        shortcut,
        registered: true,
        problem: None,
    }
}

fn taken(shortcut: Option<String>, error: &str) -> GlobalCaptureStatus {
    GlobalCaptureStatus {
        shortcut,
        registered: false,
        problem: Some(format!(
            "macOS would not give Atlas this shortcut — another app may be using it. Choose another. ({error})"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// A window that records what was asked of it, and fails where it is told to.
    #[derive(Default)]
    struct FakeWindow {
        calls: RefCell<Vec<String>>,
        refuse: Option<&'static str>,
    }

    impl FakeWindow {
        fn record(&self, call: &str) -> Result<(), String> {
            self.calls.borrow_mut().push(call.to_string());
            match self.refuse {
                Some(refused) if refused == call => Err(format!("{call} refused")),
                _ => Ok(()),
            }
        }
    }

    impl Raise for FakeWindow {
        fn unminimize(&self) -> Result<(), String> {
            self.record("unminimize")
        }
        fn show(&self) -> Result<(), String> {
            self.record("show")
        }
        fn on_every_space(&self, every: bool) -> Result<(), String> {
            self.record(if every { "every space" } else { "this space" })
        }
        fn focus(&self) -> Result<(), String> {
            self.record("focus")
        }
    }

    #[test]
    fn a_minimised_window_on_another_space_comes_out_here_and_takes_the_keyboard() {
        let window = FakeWindow::default();
        bring_forward(&window).unwrap();
        assert_eq!(
            *window.calls.borrow(),
            ["unminimize", "show", "every space", "focus", "this space"]
        );
    }

    #[test]
    fn a_window_that_will_not_take_focus_still_leaves_the_other_spaces() {
        let window = FakeWindow {
            refuse: Some("focus"),
            ..FakeWindow::default()
        };
        assert_eq!(bring_forward(&window), Err("focus refused".to_string()));
        assert_eq!(
            window.calls.borrow().last().map(String::as_str),
            Some("this space")
        );
    }

    #[test]
    fn a_window_that_cannot_be_shown_is_not_moved_between_spaces() {
        let window = FakeWindow {
            refuse: Some("show"),
            ..FakeWindow::default()
        };
        assert_eq!(bring_forward(&window), Err("show refused".to_string()));
        assert_eq!(*window.calls.borrow(), ["unminimize", "show"]);
    }

    #[test]
    fn a_shortcut_with_command_option_or_control_is_registered() {
        for text in [
            "Control+Alt+KeyN",
            "Super+Space",
            "Alt+Shift+F5",
            "Control+Digit7",
        ] {
            assert!(vetted(text).is_ok(), "{text} should be accepted");
        }
        let shortcut = vetted("Control+Alt+KeyN").unwrap();
        assert_eq!(shortcut.mods, Modifiers::CONTROL | Modifiers::ALT);
    }

    #[test]
    fn a_shortcut_without_command_option_or_control_is_refused_whatever_the_webview_sends() {
        for text in ["KeyN", "Shift+KeyN", "Space", "F5"] {
            let refused = vetted(text).unwrap_err();
            assert!(refused.contains("no ⌘, ⌥ or ⌃"), "{text}: {refused}");
        }
    }

    #[test]
    fn text_that_is_not_a_shortcut_is_refused_with_what_was_sent() {
        for text in ["", "Control+", "Control+Hyper", "Control+KeyN+KeyM"] {
            let refused = vetted(text).unwrap_err();
            assert!(
                refused.starts_with(&format!("{text} is not a shortcut")),
                "{refused}"
            );
        }
    }

    #[test]
    fn a_shortcut_the_system_will_not_take_is_kept_as_the_choice_and_says_why() {
        let status = taken(
            Some("Super+Space".to_string()),
            "RegisterEventHotKey failed",
        );
        assert_eq!(status.shortcut.as_deref(), Some("Super+Space"));
        assert!(!status.registered);
        assert!(status
            .problem
            .unwrap()
            .contains("another app may be using it"));
    }

    #[test]
    fn the_status_reaches_the_webview_in_its_own_words() {
        let json = serde_json::to_value(registered(Some("Control+Alt+KeyN".to_string()))).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "shortcut": "Control+Alt+KeyN", "registered": true, "problem": null })
        );
    }
}
