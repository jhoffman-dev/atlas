//! How long this Mac has been asleep since it booted (#172, ADR-0035 part 4).
//!
//! One reading, deciding nothing (ADR-0005): the difference of two kernel
//! clocks that share a base, one counting sleep (`CLOCK_MONOTONIC_RAW`) and
//! one not (`CLOCK_UPTIME_RAW`). It grows only while the Mac sleeps, the
//! sleeps around a dark wake included, which post no did-wake notification.
//! Neither clock is moved by NTP or by the person setting the time. The
//! webview compares the reading taken as a pull started with the one taken
//! as it is about to act; what that means is the domain's
//! (`pull-freshness.ts`).
//!
//! On any other system there is no reading: the command fails, and the
//! webview takes no reading as "not known", which never lets a Mac act on a
//! synced vault. DFAI is built for macOS; a vault that does not sync is not
//! asked for one.

use std::time::Duration;

/// The time this Mac has spent asleep since it booted.
#[cfg(target_os = "macos")]
fn asleep_since_boot() -> Result<Duration, String> {
    let with_sleep = clock(libc::CLOCK_MONOTONIC_RAW)?;
    let without_sleep = clock(libc::CLOCK_UPTIME_RAW)?;
    Ok(asleep_between(with_sleep, without_sleep))
}

#[cfg(not(target_os = "macos"))]
fn asleep_since_boot() -> Result<Duration, String> {
    Err("the time this computer has slept is only read on macOS".into())
}

/// The time asleep, from the clock that counts sleep and the one that does
/// not. The second is read after the first, so it can run ahead of it by the
/// moment between the two reads: never below zero.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn asleep_between(with_sleep: Duration, without_sleep: Duration) -> Duration {
    with_sleep.saturating_sub(without_sleep)
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
    let seconds = u64::try_from(now.tv_sec).map_err(|_| format!("clock {id} read below zero"))?;
    let nanos = u32::try_from(now.tv_nsec).map_err(|_| format!("clock {id} read below zero"))?;
    Ok(Duration::new(seconds, nanos))
}

/// The time asleep since boot, in milliseconds.
#[tauri::command]
pub async fn host_asleep_ms() -> Result<u64, String> {
    let asleep = asleep_since_boot()?;
    u64::try_from(asleep.as_millis()).map_err(|_| "the time asleep is too large to send".into())
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use super::clock;
    use super::{asleep_between, asleep_since_boot};
    use std::time::Duration;

    #[test]
    fn is_the_time_the_sleeping_clock_is_ahead_of_the_awake_one() {
        let asleep = asleep_between(
            Duration::from_secs(2_608_997),
            Duration::from_secs(2_151_667),
        );
        assert_eq!(asleep, Duration::from_secs(457_330));
    }

    #[test]
    fn is_never_below_zero_when_the_second_read_runs_ahead() {
        let asleep = asleep_between(Duration::from_nanos(1_000), Duration::from_nanos(1_250));
        assert_eq!(asleep, Duration::ZERO);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn does_not_grow_while_the_mac_is_awake() {
        let before = asleep_since_boot().expect("read before");
        std::thread::sleep(Duration::from_millis(200));
        let after = asleep_since_boot().expect("read after");
        // The webview's slack (`ASLEEP_READING_SLACK_MS`) is a second; awake, it moves by far less.
        let moved = after.abs_diff(before);
        assert!(
            moved < Duration::from_millis(50),
            "moved {moved:?} while awake"
        );
    }

    /// The kernel's own account of the same thing: the wall-clock time since
    /// boot (`kern.boottime`) less the time awake (`CLOCK_UPTIME_RAW`). NTP
    /// moves the wall side a few seconds a month (#172 measured 4.3 s over 30
    /// days), so the two agree to well within the margin unless someone set
    /// the clock by hand since boot.
    #[cfg(target_os = "macos")]
    #[test]
    fn agrees_with_the_wall_clock_time_since_boot_less_the_time_awake() {
        let asleep = asleep_since_boot().expect("read");
        let awake = clock(libc::CLOCK_UPTIME_RAW).expect("uptime");
        let since_boot = std::time::SystemTime::now()
            .duration_since(boot_time())
            .expect("booted in the past");
        let kernel = since_boot.saturating_sub(awake);
        let apart = asleep.abs_diff(kernel);
        assert!(
            apart < Duration::from_secs(600),
            "asleep {asleep:?}, kernel says {kernel:?}: {apart:?} apart"
        );
    }

    #[cfg(target_os = "macos")]
    fn boot_time() -> std::time::SystemTime {
        let mut booted = libc::timeval {
            tv_sec: 0,
            tv_usec: 0,
        };
        let mut size = std::mem::size_of::<libc::timeval>();
        let mut name = [libc::CTL_KERN, libc::KERN_BOOTTIME];
        // SAFETY: `name` names a timeval-sized value and `booted` is a writable timeval.
        let read = unsafe {
            libc::sysctl(
                name.as_mut_ptr(),
                2,
                (&raw mut booted).cast(),
                &mut size,
                std::ptr::null_mut(),
                0,
            )
        };
        assert_eq!(read, 0, "kern.boottime could not be read");
        std::time::UNIX_EPOCH
            + Duration::from_secs(u64::try_from(booted.tv_sec).expect("not below zero"))
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn has_no_reading_off_macos() {
        assert!(asleep_since_boot().is_err());
    }
}
