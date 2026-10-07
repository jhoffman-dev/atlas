//! Turning the API on and off, and keeping the connection file true to it.
//!
//! This is what the Settings commands drive. It owns the one running server (if
//! any), the token every request is checked against, and the file that tells
//! other tools where to knock. No Tauri here: what a request is forwarded to is
//! passed in.

use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};

use serde::Serialize;

use super::broker::{Answer, Broker};
use super::connection::{self, ConnectionFile};
use super::server::{self, Forward, Gate, RouterReady, Running, SharedToken, ANSWER_TIMEOUT};
use super::vet::MAX_BODY_BYTES;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiStatusReport {
    pub enabled: bool,
    /// The port in the connection file: the one listening now, or the one that
    /// will be tried first next time.
    pub port: Option<u16>,
    pub running: bool,
    /// Where the connection file is, for Settings to show.
    pub file: String,
}

pub struct ApiControl {
    dir: PathBuf,
    token: SharedToken,
    broker: Arc<Broker>,
    router_ready: RouterReady,
    inner: Mutex<Inner>,
}

struct Inner {
    file: ConnectionFile,
    running: Option<Running>,
}

impl ApiControl {
    /// Reads the connection file in `dir`, creating it (off) when there is none.
    pub fn load(dir: PathBuf) -> Result<Self, String> {
        let file = connection::load_or_create(&dir)?;
        Ok(ApiControl {
            dir,
            token: Arc::new(RwLock::new(file.token.clone())),
            broker: Arc::default(),
            // Not until the webview says so: it loads after the app starts.
            router_ready: Arc::new(AtomicBool::new(false)),
            inner: Mutex::new(Inner {
                file,
                running: None,
            }),
        })
    }

    fn inner(&self) -> MutexGuard<'_, Inner> {
        // Every change to `Inner` is a whole-field assignment, so a panic
        // elsewhere cannot leave it half-updated.
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn status(&self) -> ApiStatusReport {
        let inner = self.inner();
        ApiStatusReport {
            enabled: inner.file.enabled,
            port: (inner.file.port != 0).then_some(inner.file.port),
            running: inner.running.is_some(),
            file: connection::path_in(&self.dir).display().to_string(),
        }
    }

    pub fn token(&self) -> String {
        self.inner().file.token.clone()
    }

    /// On app start: serve again if the API was left on.
    pub fn resume(&self, forward: Forward) -> Result<(), String> {
        if self.inner().file.enabled {
            self.set_enabled(true, forward)?;
        }
        Ok(())
    }

    /// Starts or stops the server and records the choice. Either both happen or
    /// neither does: the file and what is running never disagree, so a failed
    /// save is an error and the state is as it was before the call.
    pub fn set_enabled(&self, enabled: bool, forward: Forward) -> Result<ApiStatusReport, String> {
        {
            let mut inner = self.inner();
            if enabled {
                self.turn_on(&mut inner, forward)?;
            } else {
                self.turn_off(&mut inner)?;
            }
        }
        Ok(self.status())
    }

    /// The file only says "on" once the server is bound, and says which port it
    /// got; nothing is served until the file says so.
    fn turn_on(&self, inner: &mut Inner, forward: Forward) -> Result<(), String> {
        let mut next = ConnectionFile {
            enabled: true,
            ..inner.file.clone()
        };
        if inner.running.is_some() {
            connection::save(&self.dir, &next)?;
            inner.file = next;
            return Ok(());
        }
        let listener = bind_recorded(&mut next)?;
        let gate = Arc::new(Gate {
            token: self.token.clone(),
            broker: self.broker.clone(),
            forward,
            answer_timeout: ANSWER_TIMEOUT,
            max_body: MAX_BODY_BYTES,
            router_ready: self.router_ready.clone(),
        });
        let (running, serving) = server::start(listener, gate)
            .map_err(|error| format!("cannot start the API server: {error}"))?;
        next.port = running.port;
        // Dropping `running` and `serving` on a failed save closes the listener
        // before it has served anything.
        connection::save(&self.dir, &next)?;
        self.put_token(&next.token);
        tauri::async_runtime::spawn(serving);
        inner.running = Some(running);
        inner.file = next;
        Ok(())
    }

    /// The file first: if it cannot say "off", the server keeps running and the
    /// caller is told, rather than the next launch turning back on an API the
    /// user saw go off.
    fn turn_off(&self, inner: &mut Inner) -> Result<(), String> {
        let next = ConnectionFile {
            enabled: false,
            ..inner.file.clone()
        };
        connection::save(&self.dir, &next)?;
        if let Some(running) = inner.running.take() {
            running.stop();
        }
        inner.file = next;
        Ok(())
    }

    fn put_token(&self, token: &str) {
        *self
            .token
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = token.to_string();
    }

    /// A new token, in force from the next request: the old one is refused at
    /// once, even on a connection that is already open.
    pub fn rotate_token(&self) -> Result<String, String> {
        let mut inner = self.inner();
        let next = ConnectionFile {
            token: connection::new_token()?,
            ..inner.file.clone()
        };
        // The file first: if it cannot be written, the old token stays in force
        // everywhere rather than callers holding one the server no longer takes.
        connection::save(&self.dir, &next)?;
        self.put_token(&next.token);
        inner.file = next;
        Ok(inner.file.token.clone())
    }

    /// The webview's router started or stopped listening for requests.
    pub fn set_router_ready(&self, ready: bool) {
        self.router_ready.store(ready, Ordering::SeqCst);
    }

    /// The app's answer to a forwarded request. An id nobody is waiting on —
    /// too late, or never asked — is ignored.
    pub fn respond(&self, id: &str, answer: Answer) {
        if !self.broker.answer(id, answer) {
            log::debug!("API answer for {id} arrived with nobody waiting");
        }
    }
}

/// Binds the port `next` records, or another. On another port `next` gets a new
/// token: whoever holds the recorded port may have been collecting the old one
/// from tools that knocked there while Atlas was closed.
fn bind_recorded(next: &mut ConnectionFile) -> Result<TcpListener, String> {
    let cannot_listen = |error: std::io::Error| format!("cannot listen on 127.0.0.1: {error}");
    let listener = server::bind(next.port).map_err(cannot_listen)?;
    let port = listener.local_addr().map_err(cannot_listen)?.port();
    if next.port != 0 && port != next.port {
        log::warn!(
            "API port {} was taken; the token is replaced before serving on {port}",
            next.port
        );
        next.token = connection::new_token()?;
    }
    Ok(listener)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    /// A router that is listening and answers with the path it was asked for.
    fn echo(control: &Arc<ApiControl>) -> Forward {
        control.set_router_ready(true);
        let control = Arc::downgrade(control);
        Arc::new(move |request| {
            if let Some(control) = control.upgrade() {
                let body = serde_json::json!({ "path": request.path });
                control.respond(&request.id, Answer { status: 200, body });
            }
            Ok(())
        })
    }

    fn get_status(port: u16, token: &str) -> std::io::Result<String> {
        let mut stream = TcpStream::connect(("127.0.0.1", port))?;
        write!(
            stream,
            "GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
             Authorization: Bearer {token}\r\nConnection: close\r\n\r\n"
        )?;
        let mut response = String::new();
        stream.read_to_string(&mut response)?;
        Ok(response)
    }

    fn loaded() -> (tempfile::TempDir, Arc<ApiControl>) {
        let dir = tempfile::tempdir().unwrap();
        let control = Arc::new(ApiControl::load(dir.path().join("app")).unwrap());
        (dir, control)
    }

    #[test]
    fn is_off_until_turned_on() {
        let (_dir, control) = loaded();
        let status = control.status();
        assert!(!status.enabled);
        assert!(!status.running);
        assert_eq!(status.port, None);
        assert!(status.file.ends_with("api.json"));
    }

    #[test]
    fn turning_it_on_serves_and_records_the_port() {
        let (dir, control) = loaded();
        let status = control.set_enabled(true, echo(&control)).unwrap();
        assert!(status.enabled && status.running);
        let port = status.port.unwrap();

        let file = connection::load_or_create(&dir.path().join("app")).unwrap();
        assert!(file.enabled);
        assert_eq!(file.port, port);

        let response = get_status(port, &control.token()).unwrap();
        assert!(response.starts_with("HTTP/1.1 200"), "{response}");
        assert!(response.ends_with(r#"{"path":"/v1/status"}"#), "{response}");
    }

    #[test]
    fn turning_it_off_stops_serving_and_is_recorded() {
        let (dir, control) = loaded();
        let port = control
            .set_enabled(true, echo(&control))
            .unwrap()
            .port
            .unwrap();

        let status = control.set_enabled(false, echo(&control)).unwrap();
        assert!(!status.enabled && !status.running);
        assert!(
            !connection::load_or_create(&dir.path().join("app"))
                .unwrap()
                .enabled
        );

        // Turning off returns only once the listener is closed.
        assert!(
            get_status(port, &control.token()).is_err(),
            "the port still answers after the API was turned off"
        );
    }

    /// Off then straight back on must not find Atlas's own old listener still
    /// holding the port, take it for a squatter, move and replace the token.
    #[test]
    fn turning_it_off_and_straight_back_on_keeps_the_port_and_the_token() {
        let (_dir, control) = loaded();
        let port = control.set_enabled(true, echo(&control)).unwrap().port;
        let token = control.token();

        for toggle in 0..50 {
            control.set_enabled(false, echo(&control)).unwrap();
            let status = control.set_enabled(true, echo(&control)).unwrap();
            assert_eq!(status.port, port, "moved port on toggle {toggle}");
            assert_eq!(control.token(), token, "replaced token on toggle {toggle}");
        }
        assert!(get_status(port.unwrap(), &token)
            .unwrap()
            .starts_with("HTTP/1.1 200"));
    }

    #[test]
    fn rotating_the_token_refuses_the_old_one_at_once() {
        let (dir, control) = loaded();
        let port = control
            .set_enabled(true, echo(&control))
            .unwrap()
            .port
            .unwrap();
        let old = control.token();

        let new = control.rotate_token().unwrap();
        assert_ne!(new, old);
        assert_eq!(control.token(), new);
        assert_eq!(
            connection::load_or_create(&dir.path().join("app"))
                .unwrap()
                .token,
            new
        );

        assert!(get_status(port, &old).unwrap().starts_with("HTTP/1.1 401"));
        assert!(get_status(port, &new).unwrap().starts_with("HTTP/1.1 200"));
    }

    /// A file left on, as the app would find it at launch.
    fn left_on_at(dir: &std::path::Path, port: u16) {
        let file = ConnectionFile {
            port,
            enabled: true,
            ..ConnectionFile::fresh().unwrap()
        };
        connection::save(dir, &file).unwrap();
    }

    #[test]
    fn resumes_on_the_recorded_port_when_left_on() {
        let dir = tempfile::tempdir().unwrap();
        let free = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = free.local_addr().unwrap().port();
        drop(free);
        left_on_at(dir.path(), port);

        let control = Arc::new(ApiControl::load(dir.path().to_path_buf()).unwrap());
        let recorded = control.token();
        control.resume(echo(&control)).unwrap();

        let status = control.status();
        assert!(status.running);
        assert_eq!(status.port, Some(port));
        assert_eq!(control.token(), recorded, "a free port keeps the token");
        assert!(get_status(port, &control.token())
            .unwrap()
            .starts_with("HTTP/1.1 200"));
    }

    #[test]
    fn a_taken_port_is_replaced_by_one_the_os_chooses_and_recorded() {
        let dir = tempfile::tempdir().unwrap();
        let squatter = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let taken = squatter.local_addr().unwrap().port();
        left_on_at(dir.path(), taken);

        let control = Arc::new(ApiControl::load(dir.path().to_path_buf()).unwrap());
        control.resume(echo(&control)).unwrap();

        let port = control.status().port.unwrap();
        assert_ne!(port, taken);
        assert_eq!(connection::load_or_create(dir.path()).unwrap().port, port);
        assert!(get_status(port, &control.token())
            .unwrap()
            .starts_with("HTTP/1.1 200"));
    }

    #[test]
    fn a_taken_port_replaces_the_token_before_anything_is_served() {
        let dir = tempfile::tempdir().unwrap();
        let squatter = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        left_on_at(dir.path(), squatter.local_addr().unwrap().port());
        let control = Arc::new(ApiControl::load(dir.path().to_path_buf()).unwrap());
        let collected = control.token();

        control.resume(echo(&control)).unwrap();

        let token = control.token();
        assert_ne!(token, collected);
        assert_eq!(connection::load_or_create(dir.path()).unwrap().token, token);
        let port = control.status().port.unwrap();
        assert!(get_status(port, &collected)
            .unwrap()
            .starts_with("HTTP/1.1 401"));
        assert!(get_status(port, &token)
            .unwrap()
            .starts_with("HTTP/1.1 200"));
    }

    #[cfg(unix)]
    fn set_mode(path: &std::path::Path, mode: u32) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).unwrap();
    }

    /// Runs `during` with `dir` read-only, so any save in it fails.
    #[cfg(unix)]
    fn with_read_only<T>(dir: &std::path::Path, during: impl FnOnce() -> T) -> T {
        set_mode(dir, 0o500);
        let result = during();
        set_mode(dir, 0o700);
        result
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_turn_on_on_a_taken_port_keeps_the_token_the_file_holds() {
        let dir = tempfile::tempdir().unwrap();
        let squatter = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        left_on_at(dir.path(), squatter.local_addr().unwrap().port());
        let control = Arc::new(ApiControl::load(dir.path().to_path_buf()).unwrap());
        let recorded = control.token();

        let resumed = with_read_only(dir.path(), || control.resume(echo(&control)));

        assert!(resumed.is_err());
        assert!(!control.status().running);
        assert_eq!(control.token(), recorded);
        assert_eq!(*control.token.read().unwrap(), recorded);
        assert_eq!(
            connection::load_or_create(dir.path()).unwrap().token,
            recorded
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_turn_off_leaves_it_on_and_serving_as_the_file_says() {
        let (dir, control) = loaded();
        let app = dir.path().join("app");
        let port = control
            .set_enabled(true, echo(&control))
            .unwrap()
            .port
            .unwrap();

        let turned_off = with_read_only(&app, || control.set_enabled(false, echo(&control)));

        assert!(turned_off.is_err());
        let status = control.status();
        assert!(status.enabled && status.running, "{status:?}");
        assert!(connection::load_or_create(&app).unwrap().enabled);
        assert!(get_status(port, &control.token())
            .unwrap()
            .starts_with("HTTP/1.1 200"));
    }

    #[test]
    fn stays_off_when_left_off() {
        let (_dir, control) = loaded();
        control.resume(echo(&control)).unwrap();
        assert!(!control.status().running);
    }

    #[test]
    fn an_answer_nobody_waits_for_is_ignored() {
        let (_dir, control) = loaded();
        control.respond(
            "never-asked",
            Answer {
                status: 200,
                body: serde_json::Value::Null,
            },
        );
        assert_eq!(control.broker.waiting(), 0);
    }
}
