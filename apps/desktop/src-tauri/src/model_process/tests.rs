//! The host's side of running Claude Code: what it will run, and a real child
//! process — a shell script named `claude` — run, streamed and killed.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::{vet_args, Limits, ModelProcesses, Output, Sink, StartRequest, INSTALL_DIRS, PROGRAM};

fn args(list: &[&str]) -> Vec<String> {
    list.iter().map(|arg| arg.to_string()).collect()
}

/// The arguments the TypeScript side builds for a turn.
fn turn() -> Vec<String> {
    args(&[
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--model",
        "claude-opus-5-5",
        "--tools",
        "",
        "--system-prompt",
        "--anything, even this",
        "--no-session-persistence",
        "--setting-sources",
        "",
        "--strict-mcp-config",
    ])
}

#[test]
fn the_shapes_atlas_uses_are_accepted() {
    assert_eq!(vet_args(&turn()), Ok(()));
    assert_eq!(vet_args(&args(&["auth", "status"])), Ok(()));
}

#[test]
fn auth_status_is_the_only_shape_but_a_turn() {
    // `--version` is nothing Atlas asks, so it is not a shape the host runs.
    assert!(vet_args(&args(&["--version"])).is_err());
    assert!(vet_args(&args(&["auth", "status", "--json"])).is_err());
}

#[test]
fn a_turn_missing_any_part_of_its_shape_is_refused() {
    for (flag, has_value) in [
        ("-p", false),
        ("--output-format", true),
        ("--verbose", false),
        ("--include-partial-messages", false),
        ("--model", true),
        ("--system-prompt", true),
    ] {
        assert!(
            vet_args(&turn_without(flag, has_value)).is_err(),
            "a turn without {flag} was accepted"
        );
    }
}

#[test]
fn a_turn_in_another_order_is_refused() {
    // The shape is one list, in one order: a flag moved to where a value is
    // expected cannot be read as that value by one side and a flag by the other.
    let mut moved = turn();
    moved.swap(3, 4);
    assert!(vet_args(&moved).is_err());
}

#[test]
fn every_fixed_slot_of_a_turn_holds_only_its_own_argument() {
    // Swapping one flag for another keeps the length, so each fixed slot is
    // checked by what it holds: here, the webview's pick of a flag.
    let values = [6, 10];
    for at in (0..turn().len()).filter(|at| !values.contains(at)) {
        let mut shaped = turn();
        shaped[at] = "--mcp-config".into();
        assert!(vet_args(&shaped).is_err(), "argument {at} was open");
    }
}

#[test]
fn an_empty_model_is_refused() {
    let mut shaped = turn();
    shaped[6] = String::new();
    assert!(vet_args(&shaped).is_err());
}

#[test]
fn claude_code_tools_cannot_be_turned_back_on() {
    let mut with_bash = turn();
    let tools = with_bash.iter().position(|arg| arg == "--tools").unwrap();
    with_bash[tools + 1] = "Bash".into();
    assert!(vet_args(&with_bash).is_err());

    let without: Vec<String> = turn()
        .into_iter()
        .enumerate()
        .filter(|(at, _)| *at != 7 && *at != 8)
        .map(|(_, arg)| arg)
        .collect();
    let error = vet_args(&without).unwrap_err();
    assert!(error.contains("--tools"), "{error}");
}

#[test]
fn any_other_flag_or_shape_is_refused() {
    for extra in [
        &["--dangerously-skip-permissions"][..],
        &["--allowedTools", "Bash"],
        &["--mcp-config", "/tmp/x.json"],
        &["--add-dir", "/"],
        &["--settings", "{}"],
        &["--model", "-p"],
        &["--output-format", "text"],
        &["--setting-sources", "user"],
        &["--verbose"],
        &["--model"],
    ] {
        let mut shaped = turn();
        shaped.extend(args(extra));
        assert!(vet_args(&shaped).is_err(), "{extra:?} was accepted");
    }
    assert!(vet_args(&args(&["mcp", "add", "x"])).is_err());
    assert!(vet_args(&args(&["auth", "logout"])).is_err());
    assert!(vet_args(&[]).is_err());
}

/// What a run sent, collected in order.
struct Collected(Mutex<Sender<Output>>);

impl Sink for Collected {
    fn send(&self, output: Output) {
        self.0.lock().unwrap().send(output).unwrap();
    }
}

fn collector() -> (Arc<dyn Sink>, Receiver<Output>) {
    let (sender, receiver) = channel();
    (Arc::new(Collected(Mutex::new(sender))), receiver)
}

/// A fake Claude Code: a shell script named `claude` in a folder of its own.
fn fake_claude(script: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("claude");
    fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    dir
}

/// Longer than any test runs: no run here ends by its limit unless it asks to.
const NO_LIMIT: Limits = Limits {
    status: Duration::from_secs(3600),
    turn: Duration::from_secs(3600),
};

/// The host, looking for `claude` in these directories rather than where
/// Claude Code installs (the test hook; the webview has no such say).
fn looking_in(dirs: &[&str], limits: Limits) -> ModelProcesses {
    let dirs: Vec<String> = dirs.iter().map(|dir| dir.to_string()).collect();
    ModelProcesses::installed_in(dirs, limits)
}

/// The host, finding the fake `claude` in `dir` after a directory without one.
fn installed(dir: &Path) -> ModelProcesses {
    looking_in(&["/nonexistent", &dir.display().to_string()], NO_LIMIT)
}

fn status(run: &str, stdin: &str) -> StartRequest {
    StartRequest {
        run: run.into(),
        args: args(&["auth", "status"]),
        stdin: stdin.into(),
    }
}

fn start(processes: &ModelProcesses, run: &str, stdin: &str) -> Receiver<Output> {
    let (sink, received) = collector();
    processes.start(sink, status(run, stdin), None).unwrap();
    received
}

fn next(received: &Receiver<Output>) -> Output {
    received.recv_timeout(Duration::from_secs(10)).unwrap()
}

/// The run's exit, past any lines it printed first.
fn exit_of(received: &Receiver<Output>) -> Output {
    loop {
        let output = next(received);
        if matches!(output, Output::Exit { .. }) {
            return output;
        }
    }
}

#[test]
fn a_run_streams_each_line_then_its_exit() {
    let dir = fake_claude("echo \"got: $(cat)\"\necho second\necho oops >&2\nexit 3");
    let processes = installed(dir.path());
    let received = start(&processes, "r1", "the prompt");

    assert_eq!(
        next(&received),
        Output::Line {
            run: "r1".into(),
            text: "got: the prompt".into()
        }
    );
    assert_eq!(
        next(&received),
        Output::Line {
            run: "r1".into(),
            text: "second".into()
        }
    );
    assert_eq!(
        next(&received),
        Output::Exit {
            run: "r1".into(),
            code: Some(3),
            stderr: "oops\n".into()
        }
    );
}

#[test]
fn a_cancelled_run_is_killed_and_says_so() {
    let dir = fake_claude("echo started\nexec sleep 30");
    let processes = installed(dir.path());
    let received = start(&processes, "r2", "");
    assert!(matches!(next(&received), Output::Line { .. }));

    processes.cancel("r2");

    match next(&received) {
        Output::Exit { run, code, .. } => {
            assert_eq!(run, "r2");
            assert_eq!(code, None, "a killed program has no exit code");
        }
        other => panic!("expected the exit, got {other:?}"),
    }
    // Forgotten once ended: cancelling again is nothing.
    processes.cancel("r2");
}

#[test]
fn no_claude_is_reported_as_not_found_and_nothing_runs() {
    let empty = tempfile::tempdir().unwrap();
    let (sink, _received) = collector();
    let error = looking_in(
        &[&empty.path().display().to_string(), "relative/bin", "~/x"],
        NO_LIMIT,
    )
    .start(sink, status("r3", ""), None)
    .unwrap_err();
    assert!(error.starts_with("not_found:"), "{error}");
}

#[test]
fn a_file_named_claude_that_cannot_run_is_not_run() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("claude"), "#!/bin/sh\necho hi\n").unwrap();
    let (sink, _received) = collector();
    assert!(installed(dir.path())
        .start(sink, status("r4", ""), None)
        .is_err());
}

#[test]
fn a_home_folder_is_where_a_tilde_points() {
    let home = tempfile::tempdir().unwrap();
    let bin = home.path().join("bin");
    fs::create_dir(&bin).unwrap();
    fs::write(bin.join("claude"), "#!/bin/sh\necho home\n").unwrap();
    fs::set_permissions(bin.join("claude"), fs::Permissions::from_mode(0o755)).unwrap();
    let (sink, received) = collector();
    looking_in(&["~/bin"], NO_LIMIT)
        .start(sink, status("r5", ""), Some(home.path()))
        .unwrap();
    assert_eq!(
        next(&received),
        Output::Line {
            run: "r5".into(),
            text: "home".into()
        }
    );
}

#[test]
fn refused_arguments_run_nothing() {
    let dir = fake_claude("touch ran");
    let (sink, _received) = collector();
    let request = StartRequest {
        run: "r6".into(),
        args: args(&["-p", "--tools", "Bash"]),
        stdin: String::new(),
    };
    assert!(installed(dir.path()).start(sink, request, None).is_err());
    assert!(!std::env::temp_dir().join("ran").exists());
}

// ---- Adversarial (P27): what the webview could still get the host to run ----

/// `turn()` with `flag` — and its value, when it has one — left out.
fn turn_without(flag: &str, has_value: bool) -> Vec<String> {
    let mut shaped = turn();
    let at = shaped.iter().position(|arg| arg == flag).unwrap();
    shaped.drain(at..at + if has_value { 2 } else { 1 });
    shaped
}

#[test]
fn a_turn_without_strict_mcp_config_is_refused() {
    // Without it, every MCP server in the person's ~/.claude.json loads, and
    // `--tools ""` only turns off Claude Code's built-in tools: the model is
    // handed those servers' tools, writes included (ADR-0021).
    assert!(vet_args(&turn_without("--strict-mcp-config", false)).is_err());
}

#[test]
fn a_turn_without_empty_setting_sources_is_refused() {
    // Without it, user settings load: hooks (shell commands), permission
    // allow-lists and env from ~/.claude/settings.json (ADR-0021).
    assert!(vet_args(&turn_without("--setting-sources", true)).is_err());
}

#[test]
fn a_turn_without_no_session_persistence_is_refused() {
    // Without it, every prompt — the vault's text in it — is kept as a
    // Claude Code session on disk, outside the vault.
    assert!(vet_args(&turn_without("--no-session-persistence", false)).is_err());
}

#[test]
fn a_directory_carrying_a_path_separator_is_refused() {
    // Each directory handed in joins the child's PATH, which is where
    // `#!/usr/bin/env node` finds node: "/a:/b" smuggles in a second entry.
    let dir = fake_claude("echo \"$PATH\"");
    let (sink, _received) = collector();
    let smuggled = looking_in(
        &[
            "/nonexistent:/private/tmp/elsewhere",
            &dir.path().display().to_string(),
        ],
        NO_LIMIT,
    );
    assert!(smuggled.start(sink, status("adv-path", ""), None).is_err());

    // A home folder can carry one too, through a `~/` directory.
    let parent = tempfile::tempdir().unwrap();
    let home = parent.path().join("a:b");
    fs::create_dir_all(home.join("bin")).unwrap();
    fs::copy(dir.path().join("claude"), home.join("bin/claude")).unwrap();
    let (sink, _received) = collector();
    let tilde = looking_in(&["~/bin"], NO_LIMIT);
    assert!(tilde
        .start(sink, status("adv-home", ""), Some(&home))
        .is_err());
}

#[test]
fn claude_is_only_run_from_where_claude_code_installs() {
    // The directories were the webview's to name, so "the program is claude"
    // held for the file name only: an executable called `claude` anywhere the
    // webview pointed (a synced vault folder, a download) was started. Now the
    // request names no directory, and the host looks where Claude Code
    // installs: first the native installer's `~/.local/bin`.
    let home = tempfile::tempdir().unwrap();
    let bin = home.path().join(".local/bin");
    fs::create_dir_all(&bin).unwrap();
    fs::write(bin.join("claude"), "#!/bin/sh\necho installed\n").unwrap();
    fs::set_permissions(bin.join("claude"), fs::Permissions::from_mode(0o755)).unwrap();
    let (sink, received) = collector();
    ModelProcesses::default()
        .start(sink, status("adv-anywhere", ""), Some(home.path()))
        .unwrap();
    assert_eq!(
        next(&received),
        Output::Line {
            run: "adv-anywhere".into(),
            text: "installed".into()
        }
    );
}

#[test]
fn the_install_locations_are_absolute_and_the_program_is_a_bare_name() {
    assert!(!INSTALL_DIRS.is_empty());
    for dir in INSTALL_DIRS {
        assert!(
            dir.starts_with('/') || dir.starts_with("~/"),
            "{dir} is not absolute"
        );
        assert!(!dir.contains(':'), "{dir} would add a second PATH entry");
    }
    assert!(
        !PROGRAM.contains('/'),
        "the program is looked up, never a path"
    );
}

#[test]
fn the_child_gets_only_the_environment_it_needs() {
    // The host's own environment is not handed on: a variable the test
    // process has (cargo sets it) is not the child's.
    assert!(std::env::var_os("CARGO_MANIFEST_DIR").is_some());
    let dir = fake_claude("echo \"${CARGO_MANIFEST_DIR-unset}\"\necho \"$PATH\"\necho \"$HOME\"");
    let home = tempfile::tempdir().unwrap();
    let (sink, received) = collector();
    installed(dir.path())
        .start(sink, status("env", ""), Some(home.path()))
        .unwrap();
    let line = || match next(&received) {
        Output::Line { text, .. } => text,
        other => panic!("expected a line, got {other:?}"),
    };
    assert_eq!(line(), "unset");
    assert_eq!(
        line(),
        format!(
            "/nonexistent:{}:/usr/bin:/bin:/usr/sbin:/sbin",
            dir.path().display()
        )
    );
    assert_eq!(line(), home.path().display().to_string());
}

#[test]
fn a_run_past_its_limit_is_stopped_and_says_why() {
    let dir = fake_claude("echo started\nexec sleep 30");
    let limits = Limits {
        status: Duration::from_millis(200),
        turn: Duration::from_secs(3600),
    };
    let processes = looking_in(&[&dir.path().display().to_string()], limits);
    let received = start(&processes, "slow", "");
    match exit_of(&received) {
        Output::Exit { code, stderr, .. } => {
            assert_eq!(code, None, "a stopped program has no exit code");
            assert!(stderr.contains("ran longer than"), "{stderr}");
        }
        other => panic!("expected the exit, got {other:?}"),
    }
}

#[test]
fn a_turn_is_held_to_the_turn_limit() {
    let dir = fake_claude("cat >/dev/null\necho started\nexec sleep 30");
    let limits = Limits {
        status: Duration::from_secs(3600),
        turn: Duration::from_millis(200),
    };
    let processes = looking_in(&[&dir.path().display().to_string()], limits);
    let (sink, received) = collector();
    let request = StartRequest {
        run: "turn".into(),
        args: turn(),
        stdin: "the prompt".into(),
    };
    processes.start(sink, request, None).unwrap();
    match exit_of(&received) {
        Output::Exit { code, stderr, .. } => {
            assert_eq!(code, None);
            assert!(stderr.contains("ran longer than"), "{stderr}");
        }
        other => panic!("expected the exit, got {other:?}"),
    }
}

#[test]
fn a_run_stays_cancellable_when_its_id_is_reused() {
    // A second start under the same id replaces the first in the map; when
    // the second ends it removes the id, and the first can no longer be killed.
    let dir = fake_claude(
        "if [ \"$(cat)\" = quick ]; then echo quick; exit 0; fi\necho slow\nexec sleep 30",
    );
    let processes = installed(dir.path());
    let slow = start(&processes, "dup", "slow");
    assert!(matches!(next(&slow), Output::Line { .. }));
    let quick = start(&processes, "dup", "quick");
    assert!(matches!(next(&quick), Output::Line { .. }));
    assert!(matches!(next(&quick), Output::Exit { .. }));

    processes.cancel("dup");

    match slow.recv_timeout(Duration::from_secs(5)) {
        Ok(Output::Exit { code, .. }) => assert_eq!(code, None),
        other => panic!("the first run was not killed by cancel: {other:?}"),
    }
}

#[test]
fn a_line_longer_than_the_cap_is_cut_not_split_into_more_lines() {
    // MAX_LINE says an over-long line is cut; the reader instead emits the
    // rest of that line as further lines, each parsed by the webview.
    let dir = fake_claude("head -c 4194400 /dev/zero | tr '\\0' a; echo");
    let processes = installed(dir.path());
    let received = start(&processes, "long", "");
    assert!(matches!(next(&received), Output::Line { .. }));
    match next(&received) {
        Output::Exit { .. } => {}
        Output::Line { text, .. } => {
            panic!(
                "the rest of the line came as another line of {} bytes",
                text.len()
            )
        }
    }
}

#[test]
fn a_cancel_reaches_every_live_run_with_that_id() {
    let dir = fake_claude("echo started\nexec sleep 30");
    let processes = installed(dir.path());
    let first = start(&processes, "twice", "");
    let second = start(&processes, "twice", "");
    assert!(matches!(next(&first), Output::Line { .. }));
    assert!(matches!(next(&second), Output::Line { .. }));

    processes.cancel("twice");

    for received in [first, second] {
        match next(&received) {
            Output::Exit { code, .. } => assert_eq!(code, None),
            other => panic!("expected the exit, got {other:?}"),
        }
    }
}
