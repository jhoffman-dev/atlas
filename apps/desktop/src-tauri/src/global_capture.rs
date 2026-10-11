//! The global capture shortcut (#81, ADR-0033): one system-wide key that
//! brings Atlas forward with quick capture open, whatever app has the keyboard.
//!
//! The host registers it and, when it is pressed, raises the window and emits
//! `global-capture` — nothing more. What capture then does, and what happens
//! with no vault open, is the webview's to say. Which shortcut, and its
//! default, are the webview's too: it keeps the choice for this Mac and hands
//! it here when it starts. The one thing checked here is the backstop for an
//! untrusted caller (ADR-0017): a hot key reaches Atlas before any other app,
//! so one without two of ⌘, ⌥ and ⌃, or one macOS uses itself, would take a
//! key from every app or from macOS. It is refused, as the domain refuses it.

use std::str::FromStr;
use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcut, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
};

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
    let claiming = [Modifiers::SUPER, Modifiers::CONTROL, Modifiers::ALT]
        .into_iter()
        .filter(|modifier| shortcut.mods.contains(*modifier))
        .count();
    if claiming < 2 {
        return Err(format!(
            "{text} does not hold two of ⌘, ⌥ and ⌃, so it would take its key from every other app"
        ));
    }
    if is_system_shortcut(&shortcut) {
        return Err(format!("{text} is one of macOS's own shortcuts"));
    }
    if matches!(shortcut.key, Code::F21 | Code::F22 | Code::F23 | Code::F24) {
        return Err(format!(
            "{text} has no key code on a Mac, so it cannot be registered"
        ));
    }
    Ok(shortcut)
}

/// `SYSTEM_SHORTCUTS` in the domain: macOS's own that hold two of ⌘, ⌥ and ⌃.
fn is_system_shortcut(shortcut: &Shortcut) -> bool {
    let control_command = Modifiers::CONTROL | Modifiers::SUPER;
    let option_command = Modifiers::ALT | Modifiers::SUPER;
    [
        (control_command, Code::KeyQ),
        (control_command, Code::Space),
        (control_command, Code::KeyF),
        (option_command, Code::Escape),
        (option_command, Code::Space),
        (option_command, Code::KeyD),
    ]
    .contains(&(shortcut.mods, shortcut.key))
}

/// What changing the shortcut needs of the system: a seam, so the order of a
/// change is tested without registering anything with macOS.
trait Registry {
    fn register(&self, shortcut: Shortcut) -> Result<(), String>;
    fn unregister(&self, shortcut: Shortcut) -> Result<(), String>;
}

impl<R: Runtime> Registry for GlobalShortcut<R> {
    fn register(&self, shortcut: Shortcut) -> Result<(), String> {
        GlobalShortcut::register(self, shortcut).map_err(|error| error.to_string())
    }
    fn unregister(&self, shortcut: Shortcut) -> Result<(), String> {
        GlobalShortcut::unregister(self, shortcut).map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub fn global_capture_status(state: State<'_, GlobalCaptureState>) -> GlobalCaptureStatus {
    state.held().status.clone()
}

#[tauri::command]
pub fn global_capture_set<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, GlobalCaptureState>,
    shortcut: Option<String>,
) -> Result<GlobalCaptureStatus, String> {
    change(&mut state.held(), app.global_shortcut(), shortcut)
}

/// Puts `shortcut` in place of the one in force, or none when it is null.
///
/// A shortcut refused here changes nothing. The new one is registered before
/// the old one is let go, so a shortcut macOS will not give never leaves the
/// person with none: the old one keeps working, and the new one is kept as
/// the choice and reported as not working.
fn change(
    held: &mut Held,
    registry: &impl Registry,
    shortcut: Option<String>,
) -> Result<GlobalCaptureStatus, String> {
    let wanted = shortcut.as_deref().map(vetted).transpose()?;
    held.status = match wanted {
        None => {
            release(registry, held.registered.take());
            GlobalCaptureStatus::default()
        }
        // Asked for again — the app starting twice in development, say.
        Some(next) if held.registered == Some(next) => registered(shortcut),
        Some(next) => match registry.register(next) {
            Ok(()) => {
                release(registry, held.registered.replace(next));
                registered(shortcut)
            }
            Err(error) => taken(shortcut, &error, held.registered.is_some()),
        },
    };
    Ok(held.status.clone())
}

fn release(registry: &impl Registry, previous: Option<Shortcut>) {
    if let Some(previous) = previous {
        if let Err(error) = registry.unregister(previous) {
            // Nothing to undo: Atlas no longer listens for it either way.
            log::warn!("the previous global capture shortcut could not be released: {error}");
        }
    }
}

fn registered(shortcut: Option<String>) -> GlobalCaptureStatus {
    GlobalCaptureStatus {
        shortcut,
        registered: true,
        problem: None,
    }
}

fn taken(shortcut: Option<String>, error: &str, previous_kept: bool) -> GlobalCaptureStatus {
    let kept = if previous_kept {
        " The shortcut you had before still works until one does."
    } else {
        ""
    };
    GlobalCaptureStatus {
        shortcut,
        registered: false,
        problem: Some(format!(
            "macOS would not give Atlas this shortcut. Choose another.{kept} ({error})"
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

    // Changed with the review of #81: one of ⌘, ⌥ and ⌃ used to be enough.
    #[test]
    fn a_shortcut_holding_two_of_command_option_and_control_is_registered() {
        for text in [
            "Control+Alt+KeyN",
            "Control+Super+KeyK",
            "Alt+Shift+Super+F5",
            "Control+Alt+Super+Digit7",
            "Control+Super+F20",
        ] {
            assert!(vetted(text).is_ok(), "{text} should be accepted");
        }
        let shortcut = vetted("Control+Alt+KeyN").unwrap();
        assert_eq!(shortcut.mods, Modifiers::CONTROL | Modifiers::ALT);
    }

    #[test]
    fn a_shortcut_with_fewer_than_two_is_refused_whatever_the_webview_sends() {
        for text in [
            "KeyN",
            "Shift+KeyN",
            "Alt+KeyE",
            "Alt+Shift+KeyE",
            "Super+KeyC",
            "Super+KeyV",
            "Super+KeyQ",
            "Control+KeyN",
            "Super+Space",
        ] {
            let refused = vetted(text).unwrap_err();
            assert!(
                refused.contains("does not hold two of"),
                "{text}: {refused}"
            );
        }
    }

    #[test]
    fn macos_own_shortcuts_are_refused() {
        for text in [
            "Control+Super+KeyQ",
            "Super+Control+Space",
            "Alt+Super+Escape",
            "Control+Super+KeyF",
            "Alt+Super+Space",
            "Alt+Super+KeyD",
        ] {
            let refused = vetted(text).unwrap_err();
            assert!(refused.contains("macOS's own"), "{text}: {refused}");
        }
        assert!(vetted("Control+Shift+Super+KeyQ").is_ok());
    }

    #[test]
    fn a_function_key_a_mac_has_no_code_for_is_refused() {
        for text in ["Control+Alt+F21", "Control+Alt+F24"] {
            let refused = vetted(text).unwrap_err();
            assert!(refused.contains("no key code"), "{text}: {refused}");
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

    /// The system's side of a change: what was registered, in order, and what it refuses.
    #[derive(Default)]
    struct FakeRegistry {
        calls: RefCell<Vec<String>>,
        refuse: Option<&'static str>,
    }

    impl Registry for FakeRegistry {
        fn register(&self, shortcut: Shortcut) -> Result<(), String> {
            let call = format!("register {shortcut}");
            self.calls.borrow_mut().push(call);
            match self.refuse {
                Some(refused) if vetted(refused).unwrap() == shortcut => {
                    Err("RegisterEventHotKey failed".to_string())
                }
                _ => Ok(()),
            }
        }
        fn unregister(&self, shortcut: Shortcut) -> Result<(), String> {
            self.calls
                .borrow_mut()
                .push(format!("unregister {shortcut}"));
            Ok(())
        }
    }

    fn holding(text: &str) -> Held {
        Held {
            status: registered(Some(text.to_string())),
            registered: Some(vetted(text).unwrap()),
        }
    }

    const DEFAULT: &str = "Control+Alt+KeyN";
    const OTHER: &str = "Control+Super+KeyK";

    #[test]
    fn turning_it_on_registers_it() {
        let registry = FakeRegistry::default();
        let mut held = Held::default();
        let status = change(&mut held, &registry, Some(DEFAULT.to_string())).unwrap();
        assert_eq!(status, registered(Some(DEFAULT.to_string())));
        assert_eq!(held.registered, Some(vetted(DEFAULT).unwrap()));
        assert_eq!(*registry.calls.borrow(), ["register control+alt+KeyN"]);
    }

    #[test]
    fn a_change_registers_the_new_one_before_letting_the_old_one_go() {
        let registry = FakeRegistry::default();
        let mut held = holding(DEFAULT);
        let status = change(&mut held, &registry, Some(OTHER.to_string())).unwrap();
        assert!(status.registered);
        assert_eq!(held.registered, Some(vetted(OTHER).unwrap()));
        assert_eq!(
            *registry.calls.borrow(),
            ["register control+super+KeyK", "unregister control+alt+KeyN"]
        );
    }

    #[test]
    fn a_shortcut_the_system_will_not_take_is_kept_as_the_choice_and_the_old_one_keeps_working() {
        let registry = FakeRegistry {
            refuse: Some(OTHER),
            ..FakeRegistry::default()
        };
        let mut held = holding(DEFAULT);
        let status = change(&mut held, &registry, Some(OTHER.to_string())).unwrap();
        assert_eq!(status.shortcut.as_deref(), Some(OTHER));
        assert!(!status.registered);
        let problem = status.problem.unwrap();
        assert!(
            problem.contains("would not give Atlas this shortcut"),
            "{problem}"
        );
        assert!(problem.contains("had before still works"), "{problem}");
        assert_eq!(held.registered, Some(vetted(DEFAULT).unwrap()));
        assert_eq!(*registry.calls.borrow(), ["register control+super+KeyK"]);
    }

    #[test]
    fn a_shortcut_refused_here_leaves_the_one_in_force_alone() {
        let registry = FakeRegistry::default();
        let mut held = holding(DEFAULT);
        assert!(change(&mut held, &registry, Some("Super+KeyC".to_string())).is_err());
        assert_eq!(held.status, registered(Some(DEFAULT.to_string())));
        assert_eq!(held.registered, Some(vetted(DEFAULT).unwrap()));
        assert!(registry.calls.borrow().is_empty());
    }

    #[test]
    fn turning_it_off_lets_it_go() {
        let registry = FakeRegistry::default();
        let mut held = holding(DEFAULT);
        let status = change(&mut held, &registry, None).unwrap();
        assert_eq!(status, GlobalCaptureStatus::default());
        assert_eq!(held.registered, None);
        assert_eq!(*registry.calls.borrow(), ["unregister control+alt+KeyN"]);
    }

    #[test]
    fn asking_for_the_one_in_force_again_registers_nothing() {
        let registry = FakeRegistry::default();
        let mut held = holding(DEFAULT);
        let status = change(&mut held, &registry, Some(DEFAULT.to_string())).unwrap();
        assert!(status.registered);
        assert!(registry.calls.borrow().is_empty());
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
