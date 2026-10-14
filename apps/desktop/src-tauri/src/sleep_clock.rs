//! SPIKE #172 (throwaway, not for merge): how long this Mac has been asleep,
//! and the system's own word that it slept or woke.
//!
//! Two readings, deciding nothing (ADR-0005):
//!
//! - `asleep_since_boot`: the time the Mac has spent asleep since it booted,
//!   as the difference of two kernel clocks that share a base, one counting
//!   sleep (`CLOCK_MONOTONIC_RAW`) and one not (`CLOCK_UPTIME_RAW`). It only
//!   ever grows, and grows only while the Mac sleeps, dark wakes' sleeps
//!   included. Neither clock is moved by NTP or by the person setting the time.
//! - `observe_power`: NSWorkspace's will-sleep and did-wake notifications,
//!   for a pull the moment the Mac wakes rather than at the next timer tick.

use std::time::Duration;

/// The time this Mac has spent asleep since it booted.
#[cfg(target_os = "macos")]
pub fn asleep_since_boot() -> Result<Duration, String> {
    let with_sleep = clock(libc::CLOCK_MONOTONIC_RAW)?;
    let without_sleep = clock(libc::CLOCK_UPTIME_RAW)?;
    Ok(with_sleep.saturating_sub(without_sleep))
}

#[cfg(not(target_os = "macos"))]
pub fn asleep_since_boot() -> Result<Duration, String> {
    Err("the time asleep is only read on macOS".into())
}

#[cfg(target_os = "macos")]
fn clock(id: libc::clockid_t) -> Result<Duration, String> {
    let mut now = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `now` is a valid, writable timespec for the call's duration.
    if unsafe { libc::clock_gettime(id, &mut now) } != 0 {
        return Err(format!(
            "clock {id} could not be read: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(Duration::new(now.tv_sec as u64, now.tv_nsec as u32))
}

/// The time asleep since boot, in milliseconds, for the webview to compare
/// against the reading it took when a pull started.
#[tauri::command]
pub fn host_asleep_ms() -> Result<u64, String> {
    asleep_since_boot().map(|asleep| asleep.as_millis() as u64)
}

/// What NSWorkspace said.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PowerEvent {
    WillSleep,
    DidWake,
}

#[cfg(target_os = "macos")]
mod workspace {
    use std::cell::RefCell;
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{
        NSWorkspace, NSWorkspaceDidWakeNotification, NSWorkspaceWillSleepNotification,
    };
    use objc2_foundation::{NSNotification, NSNotificationName, NSObjectProtocol};

    use super::PowerEvent;

    thread_local! {
        /// The observers' tokens: NSNotificationCenter stops calling a block
        /// once its token is released, so they live as long as the app.
        static TOKENS: RefCell<Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>> =
            const { RefCell::new(Vec::new()) };
    }

    /// Calls `on_event` on the main thread each time the Mac is about to sleep
    /// or has woken. Dark wakes (Power Nap) post neither.
    pub fn observe(on_event: impl Fn(PowerEvent) + Clone + 'static) {
        let center = NSWorkspace::sharedWorkspace().notificationCenter();
        // SAFETY: both names are AppKit's own statics.
        let names: [(&NSNotificationName, PowerEvent); 2] = unsafe {
            [
                (NSWorkspaceWillSleepNotification, PowerEvent::WillSleep),
                (NSWorkspaceDidWakeNotification, PowerEvent::DidWake),
            ]
        };
        for (name, event) in names {
            let on_event = on_event.clone();
            let block = RcBlock::new(move |_: NonNull<NSNotification>| on_event(event));
            // SAFETY: no object filter; a nil queue runs the block on the
            // posting thread, which for NSWorkspace is the main thread.
            let token = unsafe {
                center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block)
            };
            TOKENS.with(|tokens| tokens.borrow_mut().push(token));
        }
    }

    /// Posts a did-wake to NSWorkspace's centre from this process, so a test
    /// can prove the observer is registered without sleeping the Mac.
    pub fn post_fake_wake() {
        let center = NSWorkspace::sharedWorkspace().notificationCenter();
        // SAFETY: AppKit's own static name, no object.
        unsafe { center.postNotificationName_object(NSWorkspaceDidWakeNotification, None) };
    }
}

#[cfg(target_os = "macos")]
pub use workspace::{observe as observe_power, post_fake_wake};
