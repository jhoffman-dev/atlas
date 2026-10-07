//! Running Claude Code for the chat (ADR-0021).
//!
//! This starts a program named `claude` from where Claude Code installs,
//! writes the prompt to its stdin, emits each line it prints to the webview,
//! and kills it on request or once it has run too long. What the lines mean is decided in TypeScript
//! (ADR-0005).
//!
//! Starting a process is the most a webview could ask of the host, and the
//! webview is the untrusted side (ADR-0017). So the host holds a fixed shape
//! it will run, as it holds the sites a secret is bound to — obeying a rule
//! rather than having one (ADR-0014): the program is `claude` and nothing
//! else, found only in `INSTALL_DIRS`; its arguments are `auth status` or the
//! whole of a turn's fixed list of flags (`TURN`), which turns off every one
//! of Claude Code's own tools, settings and MCP servers; and it is handed only
//! the environment it needs. Anything else is refused before anything runs.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// The event each line, and the end, of a run is emitted on.
pub const MODEL_PROCESS_EVENT: &str = "model-process";

/// A bare name, joined to each install directory: never a path of its own.
const PROGRAM: &str = "claude";
/// Where Claude Code installs `claude`, in the order it is looked for: the
/// native installer's link, its older local install, Homebrew, and the usual
/// npm, bun and Volta global folders. `~/` is the home folder. The host owns
/// this list: a directory the webview could name would let it start any
/// executable called `claude`, in a synced vault folder or a download.
const INSTALL_DIRS: &[&str] = &[
    "~/.local/bin",
    "~/.claude/local",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "~/.npm-global/bin",
    "~/.bun/bin",
    "~/.volta/bin",
];
/// The host's variables a child is handed, when the host has them: `USER`
/// and `LOGNAME` name the account whose keychain holds Claude Code's login,
/// `LANG` keeps its text UTF-8, and `TMPDIR` is macOS's per-user temp folder.
/// `HOME` (where Claude Code keeps its login) and `PATH` are set by the host.
/// Nothing else — no API key, proxy or `NODE_OPTIONS` — reaches the child.
const PASSED_ENV: &[&str] = &["USER", "LOGNAME", "LANG", "TMPDIR"];
/// The most `auth status` may take: it reads a file and the keychain.
const STATUS_LIMIT: Duration = Duration::from_secs(30);
/// The most a turn may take. The webview times a turn out itself; this is the
/// host's backstop for a run nothing else stops.
const TURN_LIMIT: Duration = Duration::from_secs(15 * 60);
/// How the webview is told no `claude` was found, so it can say how to install it.
const NOT_FOUND: &str = "not_found:";
/// A line longer than this is cut: a model's line is a JSON event, never this long.
const MAX_LINE: usize = 4 * 1024 * 1024;
/// Only the end of stderr is kept, to say why a run failed.
const MAX_STDERR: usize = 8 * 1024;
/// How often a run whose output has ended is checked for having exited.
const EXIT_POLL: Duration = Duration::from_millis(20);
/// Where a GUI app's child looks for what `claude` itself runs (`node`, for an npm install).
const SYSTEM_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

/// The one other thing Atlas asks `claude`: whether it is logged in.
const STATUS: [&str; 2] = ["auth", "status"];
/// A turn's arguments, whole and in order. `None` is where a value goes: the
/// model, then the system prompt. Every other slot is fixed, so a turn always
/// runs with Claude Code's own tools off (`--tools ""`), no user settings or
/// hooks (`--setting-sources ""`), no MCP servers (`--strict-mcp-config`) and
/// nothing kept on disk (`--no-session-persistence`).
const TURN: [Option<&str>; 15] = [
    Some("-p"),
    Some("--output-format"),
    Some("stream-json"),
    Some("--verbose"),
    Some("--include-partial-messages"),
    Some("--model"),
    None,
    Some("--tools"),
    Some(""),
    Some("--system-prompt"),
    None,
    Some("--no-session-persistence"),
    Some("--setting-sources"),
    Some(""),
    Some("--strict-mcp-config"),
];
/// Where the model goes in `TURN`.
const MODEL_AT: usize = 6;

/// What a run tells the webview, tagged with the run it belongs to.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Output {
    Line {
        run: String,
        text: String,
    },
    Exit {
        run: String,
        code: Option<i32>,
        stderr: String,
    },
}

/// Where a run's output goes: the webview, or a test's list.
pub trait Sink: Send + Sync + 'static {
    fn send(&self, output: Output);
}

impl Sink for AppHandle {
    fn send(&self, output: Output) {
        // Emitting fails only once the window has gone, when nothing is left
        // to read the output; the run still ends and is forgotten.
        let _ = self.emit(MODEL_PROCESS_EVENT, output);
    }
}

/// Every live run under an id: the webview names its runs, so one id can be
/// started twice, and a cancel must reach both.
type Running = Arc<Mutex<HashMap<String, Vec<Arc<Mutex<Child>>>>>>;

/// How long each shape of run may take before the host stops it.
#[derive(Clone, Copy)]
struct Limits {
    status: Duration,
    turn: Duration,
}

/// The runs in progress, by id, so one can be cancelled; and where `claude`
/// is looked for, and for how long it may run.
pub struct ModelProcesses {
    running: Running,
    installs: Vec<String>,
    limits: Limits,
}

impl Default for ModelProcesses {
    fn default() -> Self {
        Self {
            running: Running::default(),
            installs: INSTALL_DIRS.iter().map(|dir| dir.to_string()).collect(),
            limits: Limits {
                status: STATUS_LIMIT,
                turn: TURN_LIMIT,
            },
        }
    }
}

/// Checks the arguments against the two shapes the host runs `claude` with.
pub fn vet_args(args: &[String]) -> Result<(), String> {
    let refused = |why: &str| {
        Err(format!(
            "the arguments are not ones Atlas runs claude with: {why}"
        ))
    };
    if args == STATUS {
        return Ok(());
    }
    for (at, expected) in TURN.iter().enumerate() {
        let Some(arg) = args.get(at) else {
            return refused(&format!(
                "a turn is {} arguments, not {}",
                TURN.len(),
                args.len()
            ));
        };
        if let Some(fixed) = expected {
            if arg != fixed {
                return refused(&format!("argument {at} must be {fixed:?}, not {arg:?}"));
            }
        }
    }
    if args.len() != TURN.len() {
        return refused(&format!(
            "a turn is {} arguments, not {}",
            TURN.len(),
            args.len()
        ));
    }
    let model = &args[MODEL_AT];
    if model.is_empty() || model.starts_with('-') {
        return refused(&format!("--model {model:?}"));
    }
    Ok(())
}

/// `~/x` as a path under the home folder; anything not absolute is refused.
fn expand(dir: &str, home: Option<&Path>) -> Option<PathBuf> {
    match dir.strip_prefix("~/") {
        Some(rest) => home.map(|home| home.join(rest)),
        None => Some(PathBuf::from(dir)).filter(|path| path.is_absolute()),
    }
}

fn is_executable(path: &Path) -> bool {
    path.metadata()
        .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}

/// The first `claude` in the directories, in order, and the directories as a PATH.
fn locate(dirs: &[String], home: Option<&Path>) -> Result<(PathBuf, String), String> {
    let expanded: Vec<PathBuf> = dirs.iter().filter_map(|dir| expand(dir, home)).collect();
    // Each directory joins the child's PATH, where `#!/usr/bin/env node` finds
    // node: one holding the separator would add an entry nobody listed.
    if let Some(dir) = expanded
        .iter()
        .find(|dir| dir.as_os_str().as_encoded_bytes().contains(&b':'))
    {
        return Err(format!("{} cannot be a PATH entry", dir.display()));
    }
    let program = expanded
        .iter()
        .map(|dir| dir.join(PROGRAM))
        .find(|candidate| is_executable(candidate))
        .ok_or_else(|| format!("{NOT_FOUND} no {PROGRAM} in {}", dirs.join(", ")))?;
    let mut path: Vec<String> = expanded
        .iter()
        .map(|dir| dir.display().to_string())
        .collect();
    path.push(SYSTEM_PATH.to_string());
    Ok((program, path.join(":")))
}

/// What the webview asks to run. It names no directory: where `claude` is
/// looked for is the host's.
pub struct StartRequest {
    pub run: String,
    pub args: Vec<String>,
    pub stdin: String,
}

impl ModelProcesses {
    /// Looks for `claude` in `installs` instead of where Claude Code installs,
    /// and stops runs at `limits`. Tests only: nothing the webview sends can
    /// reach it.
    #[cfg(test)]
    fn installed_in(installs: Vec<String>, limits: Limits) -> Self {
        Self {
            running: Running::default(),
            installs,
            limits,
        }
    }

    /// Vets, finds and starts `claude`, then streams its output to `sink`
    /// from a thread of its own until it exits.
    pub fn start(
        &self,
        sink: Arc<dyn Sink>,
        request: StartRequest,
        home: Option<&Path>,
    ) -> Result<(), String> {
        vet_args(&request.args)?;
        let limit = if request.args == STATUS {
            self.limits.status
        } else {
            self.limits.turn
        };
        let (program, path) = locate(&self.installs, home)?;
        let mut command = Command::new(program);
        command.env_clear().env("PATH", path);
        if let Some(home) = home {
            command.env("HOME", home);
        }
        for name in PASSED_ENV {
            if let Some(value) = std::env::var_os(name) {
                command.env(name, value);
            }
        }
        let mut child = command
            .args(&request.args)
            // Away from any project, so no CLAUDE.md or settings are found near it.
            .current_dir(std::env::temp_dir())
            // A group of its own, so cancelling reaches anything it started too.
            .process_group(0)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("cannot start {PROGRAM}: {error}"))?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let child = Arc::new(Mutex::new(child));
        lock(&self.running)
            .entry(request.run.clone())
            .or_default()
            .push(Arc::clone(&child));

        if let Some(mut pipe) = stdin {
            let prompt = request.stdin;
            // Its own thread, so a long prompt cannot deadlock against output
            // the program is waiting to write. A write that fails means the
            // program has already gone, which its exit reports.
            thread::spawn(move || {
                let _ = pipe.write_all(prompt.as_bytes());
            });
        }
        let tail = stderr.map(|pipe| thread::spawn(move || stderr_tail(pipe)));
        let (ended, timed_out) = watch(Arc::clone(&child), limit);
        let running = Arc::clone(&self.running);
        thread::spawn(move || {
            if let Some(pipe) = stdout {
                stream_lines(pipe, &request.run, sink.as_ref());
            }
            let code = wait(&child);
            drop(ended);
            let mut stderr = tail
                .and_then(|handle| handle.join().ok())
                .unwrap_or_default();
            if timed_out.load(Ordering::SeqCst) {
                stderr.push_str(&format!(
                    "Atlas stopped {PROGRAM}: it ran longer than {limit:?}."
                ));
            }
            forget(&running, &request.run, &child);
            sink.send(Output::Exit {
                run: request.run,
                code,
                stderr,
            });
        });
        Ok(())
    }

    /// Kills every live run with this id. One that has already ended is
    /// nothing to cancel.
    pub fn cancel(&self, run: &str) {
        let children = lock(&self.running).get(run).cloned().unwrap_or_default();
        for child in children {
            kill(&child);
        }
    }
}

/// Kills a run's program and everything it started.
fn kill(child: &Mutex<Child>) {
    let mut child = lock(child);
    if let Ok(group) = i32::try_from(child.id()) {
        // SAFETY: kill(2) with a negative pid signals that process
        // group; it touches no memory. The group is the child's own
        // (`process_group(0)`), so nothing else is reached.
        unsafe {
            libc::kill(-group, libc::SIGKILL);
        }
    }
    // Fails only when the program has already exited, which is what
    // killing it asked for.
    let _ = child.kill();
}

/// Kills the run once `limit` has passed, unless the returned sender is
/// dropped first (the run ended). The flag says whether it was killed.
fn watch(
    child: Arc<Mutex<Child>>,
    limit: Duration,
) -> (std::sync::mpsc::Sender<()>, Arc<AtomicBool>) {
    let (ended, on_end) = channel::<()>();
    let timed_out = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&timed_out);
    thread::spawn(move || {
        if on_end.recv_timeout(limit) == Err(RecvTimeoutError::Timeout) {
            flag.store(true, Ordering::SeqCst);
            kill(&child);
        }
    });
    (ended, timed_out)
}

/// Drops one ended run from its id, leaving any other run under that id.
fn forget(running: &Running, run: &str, child: &Arc<Mutex<Child>>) {
    let mut running = lock(running);
    if let Some(children) = running.get_mut(run) {
        children.retain(|live| !Arc::ptr_eq(live, child));
        if children.is_empty() {
            running.remove(run);
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    // A thread that panicked holding the lock left the map or child as it was;
    // carrying on with it is safer than taking the app down.
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn stream_lines(pipe: impl Read, run: &str, sink: &dyn Sink) {
    let mut reader = BufReader::new(pipe);
    let mut line = Vec::new();
    loop {
        line.clear();
        match reader
            .by_ref()
            .take(MAX_LINE as u64)
            .read_until(b'\n', &mut line)
        {
            Ok(0) | Err(_) => return,
            Ok(read) => {
                if read == MAX_LINE && line.last() != Some(&b'\n') {
                    // The rest of an over-long line is dropped, not handed on
                    // as lines of its own. A read error here is met again by
                    // the next read, which ends the stream.
                    let _ = skip_line(&mut reader);
                }
                let text = String::from_utf8_lossy(&line)
                    .trim_end_matches(['\n', '\r'])
                    .to_string();
                sink.send(Output::Line {
                    run: run.to_string(),
                    text,
                });
            }
        }
    }
}

/// Reads past the next newline, keeping nothing (`BufRead::skip_until` is
/// newer than the crate's minimum Rust).
fn skip_line(reader: &mut impl BufRead) -> std::io::Result<()> {
    loop {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            return Ok(());
        }
        match buffer.iter().position(|&byte| byte == b'\n') {
            Some(at) => {
                reader.consume(at + 1);
                return Ok(());
            }
            None => {
                let read = buffer.len();
                reader.consume(read);
            }
        }
    }
}

fn stderr_tail(pipe: impl Read) -> String {
    let mut all = Vec::new();
    // Whatever could be read is what is reported; a read error ends it early.
    let _ = BufReader::new(pipe).read_to_end(&mut all);
    let start = all.len().saturating_sub(MAX_STDERR);
    String::from_utf8_lossy(&all[start..]).into_owned()
}

/// Waits for the program to exit without holding its lock, so a cancel can
/// still reach it. None when it was killed rather than exiting.
fn wait(child: &Mutex<Child>) -> Option<i32> {
    loop {
        match lock(child).try_wait() {
            Ok(Some(status)) => return status.code(),
            Ok(None) => {}
            Err(_) => return None,
        }
        thread::sleep(EXIT_POLL);
    }
}

#[tauri::command]
pub fn model_process_start(
    app: AppHandle,
    state: State<'_, ModelProcesses>,
    run: String,
    args: Vec<String>,
    stdin: String,
) -> Result<(), String> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let request = StartRequest { run, args, stdin };
    state.start(Arc::new(app), request, home.as_deref())
}

#[tauri::command]
pub fn model_process_cancel(state: State<'_, ModelProcesses>, run: String) {
    state.cancel(&run);
}

#[cfg(test)]
mod tests;
