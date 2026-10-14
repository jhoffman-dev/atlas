//! SPIKE #172 (throwaway): proves the two wake readings on this Mac.
//!
//! `cargo run --example wake_spike`           checks the clocks and the observer, then exits.
//! `cargo run --example wake_spike -- watch`  stays up and logs every sleep and wake, with
//!                                            the time asleep and how late a 5 s tick was.

#[cfg(target_os = "macos")]
fn main() {
    use std::cell::Cell;
    use std::rc::Rc;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    use atlas_lib::sleep_clock::{asleep_since_boot, observe_power, post_fake_wake};
    use objc2_foundation::{NSDate, NSRunLoop};

    let wall = || SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    let asleep = || asleep_since_boot().expect("clock");

    // 1. The counter matches the kernel's own books: wall time since boot,
    //    less the time awake, is the time asleep.
    let boot = boot_time();
    let since_boot = wall() - boot;
    let awake = clock_uptime();
    println!("booted            {:>12.1} s ago", since_boot.as_secs_f64());
    println!("awake since boot  {:>12.1} s", awake.as_secs_f64());
    println!("asleep (counter)  {:>12.1} s", asleep().as_secs_f64());
    println!(
        "asleep (wall-up)  {:>12.1} s   <- should match the counter to within seconds (NTP moves the wall clock)",
        (since_boot - awake).as_secs_f64()
    );

    // 2. It does not grow while the Mac is awake.
    let before = asleep();
    std::thread::sleep(Duration::from_secs(3));
    let grew = asleep().saturating_sub(before);
    println!(
        "grew while awake  {:>12} ns over 3 s (expect 0)",
        grew.as_nanos()
    );

    // 3. The observer is registered and its block runs.
    let heard = Rc::new(Cell::new(0u32));
    let started = Instant::now();
    let last_tick = Rc::new(Cell::new((Instant::now(), wall(), asleep())));
    {
        let heard = heard.clone();
        observe_power(move |event| {
            heard.set(heard.get() + 1);
            println!(
                "{:?} at +{:.1} s, asleep counter {:.1} s",
                event,
                started.elapsed().as_secs_f64(),
                asleep_since_boot()
                    .map(|d| d.as_secs_f64())
                    .unwrap_or(f64::NAN)
            );
        });
    }
    post_fake_wake();
    println!("observer heard the self-posted wake: {}", heard.get() == 1);

    if std::env::args().nth(1).as_deref() != Some("watch") {
        return;
    }
    println!("watching; sleep the Mac, wake it, and read what follows (Ctrl-C to stop)");
    let run_loop = NSRunLoop::currentRunLoop();
    loop {
        run_loop.runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(5.0));
        let (then_mono, then_wall, then_asleep) = last_tick.get();
        let (now_mono, now_wall, now_asleep) = (Instant::now(), wall(), asleep());
        let slept = now_asleep.saturating_sub(then_asleep);
        let late = now_wall
            .saturating_sub(then_wall)
            .saturating_sub(Duration::from_secs(5));
        if !slept.is_zero() || late > Duration::from_secs(2) {
            println!(
                "tick: wall gap {:.1} s, Instant gap {:.1} s, slept {:.1} s since last tick",
                (now_wall - then_wall).as_secs_f64(),
                (now_mono - then_mono).as_secs_f64(),
                slept.as_secs_f64()
            );
        }
        last_tick.set((now_mono, now_wall, now_asleep));
    }
}

#[cfg(target_os = "macos")]
fn boot_time() -> std::time::Duration {
    let mut boot = libc::timeval {
        tv_sec: 0,
        tv_usec: 0,
    };
    let mut size = std::mem::size_of::<libc::timeval>();
    let mut name = [libc::CTL_KERN, libc::KERN_BOOTTIME];
    // SAFETY: `boot` and `size` are valid for the call; the name is two ints.
    let ok = unsafe {
        libc::sysctl(
            name.as_mut_ptr(),
            2,
            (&mut boot as *mut libc::timeval).cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    assert_eq!(ok, 0, "kern.boottime");
    std::time::Duration::new(boot.tv_sec as u64, boot.tv_usec as u32 * 1000)
}

#[cfg(target_os = "macos")]
fn clock_uptime() -> std::time::Duration {
    let mut now = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `now` is valid and writable.
    assert_eq!(
        unsafe { libc::clock_gettime(libc::CLOCK_UPTIME_RAW, &mut now) },
        0
    );
    std::time::Duration::new(now.tv_sec as u64, now.tv_nsec as u32)
}

#[cfg(not(target_os = "macos"))]
fn main() {}
