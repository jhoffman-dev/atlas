//! The Granola module end to end, against a fake Granola on this machine's
//! loopback: the requests are real HTTP, and the Keychain is the in-memory
//! store.

use std::collections::BTreeMap;
use std::net::Ipv4Addr;
use std::sync::MutexGuard;

use reqwest::Url;

use super::fake_granola::{FakeGranola, Granola, Reply};
use super::{FailureKind, GranolaFailure, GranolaState, GranolaStatus, Kept, Session};
use crate::secrets::{MemoryStore, SecretStore};

const VAULT: &str = "v1";
const KEY: &str = "grn_Fict10nalLarkspurKey";

struct Setup {
    fake: FakeGranola,
    store: MemoryStore,
    state: GranolaState,
}

impl Setup {
    async fn new() -> Self {
        Self {
            fake: FakeGranola::start().await,
            store: MemoryStore::default(),
            state: GranolaState::default(),
        }
    }

    /// With the key set in Atlas and honoured by the fake.
    async fn keyed() -> Self {
        let setup = Self::new().await;
        setup.granola().key = Some(KEY.into());
        setup.session().set_key(KEY).unwrap();
        setup
    }

    fn session(&self) -> Session<'_> {
        self.session_for(VAULT)
    }

    fn session_for<'a>(&'a self, scope: &'a str) -> Session<'a> {
        Session {
            origin: &self.fake.origin,
            store: &self.store,
            scope,
            state: &self.state,
        }
    }

    fn granola(&self) -> MutexGuard<'_, Granola> {
        self.fake.granola.lock().unwrap()
    }

    fn heard(&self) -> usize {
        self.granola().heard.len()
    }

    fn refusal(&self) -> Option<u16> {
        self.session().status().unwrap().last_refusal
    }
}

fn no_query() -> BTreeMap<String, String> {
    BTreeMap::new()
}

const NOTES: &str = "/v1/notes";

#[tokio::test(flavor = "multi_thread")]
async fn a_get_carries_the_key_to_the_v1_path_and_hands_back_what_granola_said() {
    let setup = Setup::keyed().await;
    let query = BTreeMap::from([
        ("page_size".to_string(), "30".to_string()),
        (
            "updated_after".to_string(),
            "2026-10-01T00:00:00Z".to_string(),
        ),
    ]);

    let answer = setup.session().request(NOTES, &query).await.unwrap();

    assert_eq!(answer.status, 200);
    assert!(
        answer.body.contains("Larkspur Payroll kickoff"),
        "{}",
        answer.body
    );
    let heard = setup.granola().heard.clone();
    assert_eq!(heard.len(), 1);
    assert_eq!(heard[0].method, "GET");
    assert_eq!(
        heard[0].target,
        "/v1/notes?page_size=30&updated_after=2026-10-01T00%3A00%3A00Z"
    );
    assert_eq!(heard[0].authorization, format!("Bearer {KEY}"));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_path_that_leaves_v1_or_the_origin_is_refused_before_anything_is_sent() {
    let setup = Setup::keyed().await;
    for path in [
        "/v1/../admin",
        "/v1/notes/../../admin",
        "/v1/%2e%2e/admin",
        "/v1/%2E%2E/%2E%2E/admin",
        "//evil.example/v1/notes",
        "https://evil.example/v1/notes",
        "/v2/notes",
        "/v1/notes?cursor=x",
    ] {
        let failure = setup
            .session()
            .request(path, &no_query())
            .await
            .unwrap_err();
        assert_eq!(failure.kind, FailureKind::Invalid, "{path}");
    }
    assert_eq!(setup.heard(), 0, "a refused path reached Granola");
}

#[tokio::test(flavor = "multi_thread")]
async fn without_a_key_nothing_is_sent() {
    let setup = Setup::new().await;
    let failure = setup
        .session()
        .request(NOTES, &no_query())
        .await
        .unwrap_err();
    assert_eq!(failure.kind, FailureKind::NoKey);
    assert_eq!(setup.heard(), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn one_vaults_key_is_never_sent_for_another() {
    let setup = Setup::keyed().await;
    let other = setup.session_for("v2");
    assert!(!other.status().unwrap().has_key);
    let failure = other.request(NOTES, &no_query()).await.unwrap_err();
    assert_eq!(failure.kind, FailureKind::NoKey);
    assert_eq!(setup.heard(), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_401_is_handed_back_as_itself_with_the_key_struck_and_marks_the_key_refused() {
    let setup = Setup::keyed().await;
    setup.granola().key = Some("grn_TheOneGranolaHasNow".into());
    setup.granola().echoes = true;

    let answer = setup.session().request(NOTES, &no_query()).await.unwrap();

    assert_eq!(answer.status, 401);
    assert!(answer.body.contains("authorization"), "{}", answer.body);
    assert!(!answer.body.contains(KEY), "{}", answer.body);
    assert!(answer.body.contains("[secret granola-api-key removed]"));
    assert_eq!(setup.refusal(), Some(401));
}

/// A 403 is a call the key may not make, not a key Granola does not know.
#[tokio::test(flavor = "multi_thread")]
async fn a_403_is_an_answer_that_does_not_refuse_the_key_and_a_success_clears_a_refusal() {
    let setup = Setup::keyed().await;
    setup.granola().reply = Reply::Status(403);
    let answer = setup.session().request(NOTES, &no_query()).await.unwrap();
    assert_eq!(answer.status, 403);
    assert_eq!(setup.refusal(), None);

    setup.granola().reply = Reply::Status(401);
    setup.session().request(NOTES, &no_query()).await.unwrap();
    assert_eq!(setup.refusal(), Some(401));
    setup.granola().reply = Reply::Notes;
    setup.session().request(NOTES, &no_query()).await.unwrap();
    assert_eq!(setup.refusal(), None);
}

#[tokio::test(flavor = "multi_thread")]
async fn setting_or_forgetting_the_key_clears_a_refusal() {
    let setup = Setup::keyed().await;
    setup.granola().reply = Reply::Status(401);
    setup.session().request(NOTES, &no_query()).await.unwrap();
    assert_eq!(setup.refusal(), Some(401));
    let status = setup.session().set_key("grn_ANewOne").unwrap();
    assert_eq!(status.last_refusal, None);
    assert_eq!(setup.refusal(), None);

    setup.granola().key = Some("grn_ANewOne".into());
    setup.session().request(NOTES, &no_query()).await.unwrap();
    assert_eq!(setup.refusal(), Some(401));
    setup.session().forget_key().unwrap();
    assert_eq!(setup.refusal(), None);
}

#[tokio::test(flavor = "multi_thread")]
async fn any_other_status_is_an_answer_and_says_nothing_about_the_key() {
    let setup = Setup::keyed().await;
    for status in [404, 413, 429, 500, 503] {
        setup.granola().reply = Reply::Status(status);
        let answer = setup.session().request(NOTES, &no_query()).await.unwrap();
        assert_eq!(answer.status, status);
        assert_eq!(setup.refusal(), None, "{status}");
    }
}

#[test]
fn an_answer_to_a_key_since_replaced_says_nothing_about_the_new_one() {
    let state = GranolaState::default();
    state.now_keeping(VAULT, state.fingerprint("grn_TheOldOne"));
    state.now_keeping(VAULT, state.fingerprint("grn_TheNewOne"));
    state.heard(VAULT, "grn_TheOldOne", 401);
    assert_eq!(state.standing(VAULT).refused, None);

    state.heard(VAULT, "grn_TheNewOne", 401);
    assert_eq!(state.standing(VAULT).refused, Some(401));
    state.heard(VAULT, "grn_TheOldOne", 200);
    assert_eq!(
        state.standing(VAULT).refused,
        Some(401),
        "a success for the old key cleared the new one's refusal"
    );
}

#[test]
fn an_answer_heard_once_the_key_is_forgotten_says_nothing() {
    let state = GranolaState::default();
    state.now_keeping(VAULT, Kept::Nothing);
    state.heard(VAULT, KEY, 401);
    assert_eq!(state.standing(VAULT).refused, None);
}

/// No key was set in this run: the one kept from an earlier run is the one
/// Granola's answers are about.
#[tokio::test(flavor = "multi_thread")]
async fn a_refusal_of_a_key_kept_from_an_earlier_run_is_kept() {
    let setup = Setup::new().await;
    super::key::save(&setup.store, VAULT, KEY).unwrap();

    let answer = setup.session().request(NOTES, &no_query()).await.unwrap();

    assert_eq!(answer.status, 401);
    assert_eq!(setup.refusal(), Some(401));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_key_that_is_not_granolas_leaves_the_kept_ones_refusal_standing() {
    let setup = Setup::keyed().await;
    setup.granola().key = Some("grn_TheOneGranolaHasNow".into());
    setup.session().request(NOTES, &no_query()).await.unwrap();
    assert_eq!(setup.refusal(), Some(401));

    setup.session().set_key("not-a-key").unwrap_err();

    assert_eq!(setup.refusal(), Some(401));
}

/// A Keychain that keeps nothing new and lets nothing go.
struct RefusingStore(MemoryStore);

impl SecretStore for RefusingStore {
    fn set(&self, _: &str, _: &str) -> Result<(), String> {
        Err("the keychain is locked".into())
    }
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        self.0.get(account)
    }
    fn delete(&self, _: &str) -> Result<(), String> {
        Err("the keychain is locked".into())
    }
    fn accounts(&self) -> Result<Vec<String>, String> {
        self.0.accounts()
    }
}

/// The Keychain refused the change, so it still holds the old key, and a
/// refusal of that key is heard as one.
#[tokio::test(flavor = "multi_thread")]
async fn after_the_keychain_refuses_a_change_a_refusal_of_the_key_it_holds_is_kept() {
    let fake = FakeGranola::start().await;
    let store = RefusingStore(MemoryStore::default());
    super::key::save(&store.0, VAULT, KEY).unwrap();
    let state = GranolaState::default();
    let session = Session {
        origin: &fake.origin,
        store: &store,
        scope: VAULT,
        state: &state,
    };

    let refused_once_changed = |change: Result<GranolaStatus, GranolaFailure>| async {
        assert_eq!(change.unwrap_err().kind, FailureKind::Keychain);
        session.request(NOTES, &no_query()).await.unwrap();
        session.status().unwrap().last_refusal
    };
    assert_eq!(
        refused_once_changed(session.set_key("grn_ANewOne")).await,
        Some(401)
    );
    assert_eq!(refused_once_changed(session.forget_key()).await, Some(401));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_redirect_is_handed_back_not_followed() {
    let setup = Setup::keyed().await;
    let elsewhere = setup
        .fake
        .origin
        .join("/v1/notes/not_1d3tmYTlCICgjy")
        .unwrap();
    setup.granola().reply = Reply::Redirect(elsewhere.to_string());

    let answer = setup.session().request(NOTES, &no_query()).await.unwrap();

    assert_eq!(answer.status, 302);
    assert_eq!(setup.heard(), 1, "the redirect was followed");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_answer_may_reach_the_cap() {
    let setup = Setup::keyed().await;
    setup.granola().reply = Reply::AtTheCap;
    let answer = setup.session().request(NOTES, &no_query()).await.unwrap();
    assert_eq!(answer.status, 200);
    assert_eq!(answer.body.len(), super::api::MAX_ANSWER_BYTES);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_answer_larger_than_the_cap_is_refused() {
    let setup = Setup::keyed().await;
    setup.granola().reply = Reply::Oversized;
    let failure = setup
        .session()
        .request(NOTES, &no_query())
        .await
        .unwrap_err();
    assert_eq!(failure.kind, FailureKind::TooLarge);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_answer_that_is_not_text_is_malformed() {
    let setup = Setup::keyed().await;
    setup.granola().reply = Reply::NotText;
    let failure = setup
        .session()
        .request(NOTES, &no_query())
        .await
        .unwrap_err();
    assert_eq!(failure.kind, FailureKind::Malformed);
}

#[tokio::test(start_paused = true)]
async fn a_granola_that_never_answers_times_out() {
    let setup = Setup::keyed().await;
    setup.granola().reply = Reply::Silent;
    let failure = setup
        .session()
        .request(NOTES, &no_query())
        .await
        .unwrap_err();
    assert_eq!(failure.kind, FailureKind::Timeout, "{}", failure.message);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_granola_that_cannot_be_reached_is_unreachable() {
    let closed = {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        Url::parse(&format!(
            "http://127.0.0.1:{}",
            listener.local_addr().unwrap().port()
        ))
        .unwrap()
    };
    let store = MemoryStore::default();
    let state = GranolaState::default();
    let session = Session {
        origin: &closed,
        store: &store,
        scope: VAULT,
        state: &state,
    };
    session.set_key(KEY).unwrap();
    let failure = session.request(NOTES, &no_query()).await.unwrap_err();
    assert_eq!(failure.kind, FailureKind::Unreachable);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_key_that_is_empty_or_not_granolas_is_refused_and_the_kept_one_stays() {
    let setup = Setup::keyed().await;
    for key in ["", "grn_", "sk-ant-Fict10nal", "Bearer grn_abc", "grn_a b"] {
        let failure = setup.session().set_key(key).unwrap_err();
        assert_eq!(failure.kind, FailureKind::Invalid, "{key:?}");
    }
    assert!(setup.session().status().unwrap().has_key);
    setup.session().request(NOTES, &no_query()).await.unwrap();
    assert_eq!(
        setup.granola().heard[0].authorization,
        format!("Bearer {KEY}")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn forgetting_the_key_removes_it_and_ends_the_requests() {
    let setup = Setup::keyed().await;
    let status = setup.session().forget_key().unwrap();
    assert_eq!(
        status,
        GranolaStatus {
            has_key: false,
            last_refusal: None
        }
    );
    assert!(setup.store.accounts().unwrap().is_empty());
    let failure = setup
        .session()
        .request(NOTES, &no_query())
        .await
        .unwrap_err();
    assert_eq!(failure.kind, FailureKind::NoKey);
    assert_eq!(setup.heard(), 0);
}

/// What Tauri would hand the webview for a command's result.
fn as_handed<T: serde::Serialize>(result: Result<T, GranolaFailure>) -> String {
    match result {
        Ok(value) => serde_json::to_string(&value).unwrap(),
        Err(failure) => serde_json::to_string(&failure).unwrap(),
    }
}

/// P28-10's acceptance: no command answers with the key. Every value each
/// Granola command can hand the webview — its answer or its failure — is
/// serialized as Tauri would, with the fake echoing the Authorization header
/// it was sent, and searched for the key.
#[tokio::test(flavor = "multi_thread")]
async fn no_answer_or_failure_handed_to_the_webview_carries_the_key() {
    let setup = Setup::new().await;
    setup.granola().key = Some(KEY.into());
    setup.granola().echoes = true;
    let session = setup.session();
    let mut handed = vec![as_handed(session.set_key(KEY)), as_handed(session.status())];
    let echoed = session.request(NOTES, &no_query()).await;
    assert!(echoed.as_ref().unwrap().body.contains("authorization"));
    handed.push(as_handed(echoed));
    for reply in [
        Reply::Status(403),
        Reply::Status(404),
        Reply::Status(429),
        Reply::Redirect("https://evil.example/".into()),
        Reply::NotText,
        Reply::Oversized,
    ] {
        setup.granola().reply = reply;
        handed.push(as_handed(session.request(NOTES, &no_query()).await));
    }
    setup.granola().key = Some("grn_TheOneGranolaHasNow".into());
    handed.push(as_handed(session.request(NOTES, &no_query()).await));
    handed.push(as_handed(session.status()));
    handed.push(as_handed(
        session.request("/v1/../admin", &no_query()).await,
    ));
    handed.push(as_handed(session.set_key("not-a-key")));
    handed.push(as_handed(session.forget_key()));
    handed.push(as_handed(session.request(NOTES, &no_query()).await));

    assert_eq!(setup.heard(), 8, "every reply was not exercised");
    for value in &handed {
        assert!(
            !value.contains(KEY),
            "the key reached the webview in {value}"
        );
    }
}

/// Adversarial (P28-10): Granola echoing its Authorization header encoded
/// whole. base64 of `Bearer <key>` puts the key at byte 7, off the 3-byte
/// grid that `redact` encodes the bare key on, so no form it looks for
/// matches, and anyone who decodes the answer reads the key.
#[tokio::test(flavor = "multi_thread")]
async fn the_key_is_struck_from_an_echo_of_the_authorization_header_in_base64() {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    let setup = Setup::keyed().await;
    setup.granola().echoes = true;
    setup.granola().echo_as = Some(|header| STANDARD.encode(header));

    let answer = setup.session().request(NOTES, &no_query()).await.unwrap();

    let body: serde_json::Value = serde_json::from_str(&answer.body).unwrap();
    let echoed = body["authorization"].as_str().unwrap_or_default();
    let decoded = STANDARD
        .decode(echoed)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default();
    assert!(
        !decoded.contains(KEY),
        "the key reached the webview as base64: {echoed} decodes to {decoded}"
    );
}

/// Adversarial (P28-10): an echo that escapes every character, letters and
/// digits too, with its hex in either case. Every form is legal (`g` is `g`
/// to any JSON parser, `%67` and `%6e` to any URL decoder), but `redact`
/// matched letters and digits only as themselves, so the key survived in the
/// answer TypeScript parses.
#[tokio::test(flavor = "multi_thread")]
async fn the_key_is_struck_from_an_echo_that_escapes_letters_and_digits() {
    /// Upper-case hex on every other character, lower-case on the rest.
    fn mixed(at: usize, hex: String) -> String {
        if at % 2 == 0 {
            hex.to_uppercase()
        } else {
            hex
        }
    }
    fn json_escaped(header: &str) -> String {
        header
            .chars()
            .map(|c| format!("\\u{:04x}", c as u32))
            .collect()
    }
    fn json_escaped_mixed(header: &str) -> String {
        header
            .chars()
            .enumerate()
            .map(|(at, c)| format!("\\u{}", mixed(at, format!("{:04x}", c as u32))))
            .collect()
    }
    fn percent_encoded(header: &str) -> String {
        header.bytes().map(|byte| format!("%{byte:02X}")).collect()
    }
    fn percent_encoded_mixed(header: &str) -> String {
        header
            .bytes()
            .enumerate()
            .map(|(at, byte)| format!("%{}", mixed(at, format!("{byte:02x}"))))
            .collect()
    }
    fn json_parsed(echoed: &str) -> String {
        echoed.to_string()
    }
    fn percent_decoded(echoed: &str) -> String {
        Url::parse(&format!("http://x/?a={echoed}"))
            .unwrap()
            .query_pairs()
            .next()
            .map(|(_, value)| value.into_owned())
            .unwrap_or_default()
    }
    let setup = Setup::keyed().await;
    setup.granola().echoes = true;

    for (form, read) in [
        (
            json_escaped as fn(&str) -> String,
            json_parsed as fn(&str) -> String,
        ),
        (json_escaped_mixed, json_parsed),
        (percent_encoded, percent_decoded),
        (percent_encoded_mixed, percent_decoded),
    ] {
        setup.granola().echo_as = Some(form);
        let answer = setup.session().request(NOTES, &no_query()).await.unwrap();
        let body: serde_json::Value = serde_json::from_str(&answer.body).unwrap();
        let echoed = body["authorization"].as_str().unwrap_or_default();
        let read = read(echoed);
        assert!(
            !read.contains(KEY),
            "the echo {} reads as {read}",
            form("Bearer grn_")
        );
    }
}

/// A store whose write of a key holds, once written, until let go: the
/// moment between `set_key` keeping the new key and noting that it changed.
struct HeldStore {
    inner: MemoryStore,
    written: std::sync::mpsc::SyncSender<()>,
    let_go: std::sync::Mutex<std::sync::mpsc::Receiver<()>>,
}

impl SecretStore for HeldStore {
    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        self.inner.set(account, value)?;
        let _ = self.written.send(());
        let _ = self.let_go.lock().unwrap().recv();
        Ok(())
    }
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        self.inner.get(account)
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        self.inner.delete(account)
    }
    fn accounts(&self) -> Result<Vec<String>, String> {
        self.inner.accounts()
    }
}

/// Adversarial (P28-10): a pull racing `granola_set_key`. `set_key` keeps the
/// key before it bumps `changes`, so a request in between reads the old
/// standing, sends the NEW key, and Granola's 401 for it is then wiped by the
/// bump. The kept key was refused, and status says it was not.
#[tokio::test(flavor = "multi_thread")]
async fn a_refusal_of_the_new_key_heard_while_it_is_being_set_is_kept() {
    let fake = FakeGranola::start().await; // honours no key: every request is 401
    let (written, was_written) = std::sync::mpsc::sync_channel(1);
    let (let_go, held) = std::sync::mpsc::channel();
    let store: &'static HeldStore = Box::leak(Box::new(HeldStore {
        inner: MemoryStore::default(),
        written,
        let_go: std::sync::Mutex::new(held),
    }));
    let state: &'static GranolaState = Box::leak(Box::default());
    let origin: &'static Url = Box::leak(Box::new(fake.origin.clone()));
    let session = move || Session {
        origin,
        store,
        scope: VAULT,
        state,
    };

    let setting = std::thread::spawn(move || session().set_key("grn_TheNewKey").unwrap());
    was_written.recv().unwrap();
    let answer = session().request(NOTES, &no_query()).await.unwrap();
    let_go.send(()).unwrap();
    setting.join().unwrap();

    assert_eq!(answer.status, 401);
    assert_eq!(
        fake.granola.lock().unwrap().heard[0].authorization,
        "Bearer grn_TheNewKey",
        "the refused request carried the key now kept"
    );
    assert_eq!(session().status().unwrap().last_refusal, Some(401));
}

/// A Keychain whose writes fail while `refusing` is set, whose reads fail
/// while `unreadable` is, and which keeps a value it then says it failed to
/// keep while `keeps_but_fails` is.
#[derive(Default)]
struct FlakyStore {
    inner: MemoryStore,
    refusing: std::sync::atomic::AtomicBool,
    unreadable: std::sync::atomic::AtomicBool,
    keeps_but_fails: std::sync::atomic::AtomicBool,
}

impl FlakyStore {
    fn is(flag: &std::sync::atomic::AtomicBool) -> bool {
        flag.load(std::sync::atomic::Ordering::SeqCst)
    }
}

impl SecretStore for FlakyStore {
    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        if Self::is(&self.refusing) {
            return Err("the keychain is locked".into());
        }
        self.inner.set(account, value)?;
        if Self::is(&self.keeps_but_fails) {
            return Err("the keychain timed out".into());
        }
        Ok(())
    }
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        if Self::is(&self.unreadable) {
            return Err("the keychain is locked".into());
        }
        self.inner.get(account)
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        if Self::is(&self.refusing) {
            return Err("the keychain is locked".into());
        }
        self.inner.delete(account)
    }
    fn accounts(&self) -> Result<Vec<String>, String> {
        self.inner.accounts()
    }
}

/// Adversarial (P28-10 fix). After a Keychain failure the standing is
/// `Unknown`, and the first answer heard pins `kept` to whatever key that
/// request carried — even one sent before the key now in the Keychain was set.
/// The stale 401 then stands against the kept key, and every success of the
/// kept key is ignored (`kept != sent`) for the rest of the run.
#[tokio::test(flavor = "multi_thread")]
async fn a_late_answer_to_an_earlier_key_after_a_keychain_failure_does_not_pin_the_standing() {
    let fake = FakeGranola::start().await;
    let store = FlakyStore::default();
    let state = GranolaState::default();
    let session = Session {
        origin: &fake.origin,
        store: &store,
        scope: VAULT,
        state: &state,
    };
    let (earlier, kept) = ("grn_TheEarlierKey", "grn_TheKeptKey");
    fake.granola.lock().unwrap().key = Some(kept.into());

    session.set_key(earlier).unwrap();
    // A pull goes out with the earlier key and is still waiting on Granola…
    session.set_key(kept).unwrap();
    store
        .refusing
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(
        session
            .set_key("grn_ATypoTheKeychainRefused")
            .unwrap_err()
            .kind,
        FailureKind::Keychain
    );
    store
        .refusing
        .store(false, std::sync::atomic::Ordering::SeqCst);
    // …and Granola's 401 for the earlier key lands now.
    state.heard(VAULT, earlier, 401);

    let answer = session.request(NOTES, &no_query()).await.unwrap();
    assert_eq!(answer.status, 200, "the kept key works");
    assert_eq!(
        session.status().unwrap().last_refusal,
        None,
        "the kept key answered 200, yet it stands refused for a 401 to the earlier key"
    );
}

fn flaky_session<'a>(
    fake: &'a FakeGranola,
    store: &'a FlakyStore,
    state: &'a GranolaState,
) -> Session<'a> {
    Session {
        origin: &fake.origin,
        store,
        scope: VAULT,
        state,
    }
}

fn set(flag: &std::sync::atomic::AtomicBool, on: bool) {
    flag.store(on, std::sync::atomic::Ordering::SeqCst);
}

/// A Keychain failure while setting a key changes nothing that was kept, so
/// what Granola said of the kept key still stands.
#[tokio::test(flavor = "multi_thread")]
async fn a_failed_save_keeps_the_refusal_of_the_key_still_kept() {
    let fake = FakeGranola::start().await;
    let (store, state) = (FlakyStore::default(), GranolaState::default());
    let session = flaky_session(&fake, &store, &state);
    session.set_key(KEY).unwrap();
    state.heard(VAULT, KEY, 401);

    set(&store.refusing, true);
    let failure = session.set_key("grn_ATypoTheKeychainRefused").unwrap_err();
    set(&store.refusing, false);

    assert_eq!(failure.kind, FailureKind::Keychain);
    assert_eq!(session.status().unwrap().last_refusal, Some(401));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_failed_forget_keeps_the_refusal_of_the_key_still_kept() {
    let fake = FakeGranola::start().await;
    let (store, state) = (FlakyStore::default(), GranolaState::default());
    let session = flaky_session(&fake, &store, &state);
    session.set_key(KEY).unwrap();
    state.heard(VAULT, KEY, 401);

    set(&store.refusing, true);
    let failure = session.forget_key().unwrap_err();
    set(&store.refusing, false);

    assert_eq!(failure.kind, FailureKind::Keychain);
    assert_eq!(
        session.status().unwrap(),
        GranolaStatus {
            has_key: true,
            last_refusal: Some(401)
        }
    );
}

/// When the Keychain can be neither written nor read, which key it holds is
/// not known, and the standing is left as it was rather than guessed at.
#[tokio::test(flavor = "multi_thread")]
async fn a_failed_save_that_cannot_be_read_back_leaves_the_standing_as_it_was() {
    let fake = FakeGranola::start().await;
    let (store, state) = (FlakyStore::default(), GranolaState::default());
    let session = flaky_session(&fake, &store, &state);
    session.set_key(KEY).unwrap();
    state.heard(VAULT, KEY, 401);

    set(&store.refusing, true);
    set(&store.unreadable, true);
    session.set_key("grn_ATypoTheKeychainRefused").unwrap_err();
    set(&store.refusing, false);
    set(&store.unreadable, false);

    assert_eq!(session.status().unwrap().last_refusal, Some(401));
    state.heard(VAULT, "grn_AnEarlierKey", 200);
    assert_eq!(
        session.status().unwrap().last_refusal,
        Some(401),
        "an answer to some other key was taken as the word on the kept one"
    );
}

/// A Keychain that kept the new key but reported a failure: the new key is
/// what is sent from now on, and what Granola said of the old one is not about
/// it.
#[tokio::test(flavor = "multi_thread")]
async fn a_save_reported_failed_that_kept_the_key_stands_for_the_new_key() {
    let fake = FakeGranola::start().await;
    let (store, state) = (FlakyStore::default(), GranolaState::default());
    let session = flaky_session(&fake, &store, &state);
    let new = "grn_TheNewKey";
    session.set_key(KEY).unwrap();
    state.heard(VAULT, KEY, 401);

    set(&store.keeps_but_fails, true);
    session.set_key(new).unwrap_err();
    set(&store.keeps_but_fails, false);

    assert_eq!(session.status().unwrap().last_refusal, None);
    state.heard(VAULT, KEY, 401);
    assert_eq!(
        session.status().unwrap().last_refusal,
        None,
        "a 401 to the old key stood against the new"
    );
    state.heard(VAULT, new, 401);
    assert_eq!(session.status().unwrap().last_refusal, Some(401));
}

/// Setting the kept key again, when the Keychain fails, changes nothing, and
/// Granola's refusal of that key stands.
#[tokio::test(flavor = "multi_thread")]
async fn a_failed_save_of_the_key_already_kept_keeps_its_refusal() {
    let fake = FakeGranola::start().await;
    let (store, state) = (FlakyStore::default(), GranolaState::default());
    let session = flaky_session(&fake, &store, &state);
    session.set_key(KEY).unwrap();
    state.heard(VAULT, KEY, 401);

    set(&store.refusing, true);
    session.set_key(KEY).unwrap_err();
    set(&store.refusing, false);

    assert_eq!(session.status().unwrap().last_refusal, Some(401));
}

/// A key kept from an earlier run is not known until it is used. A failed
/// save reads it back, and from then on an answer to any other key is not
/// taken as the word on it.
#[tokio::test(flavor = "multi_thread")]
async fn a_failed_save_learns_the_key_kept_from_an_earlier_run() {
    let fake = FakeGranola::start().await;
    let (store, state) = (FlakyStore::default(), GranolaState::default());
    let session = flaky_session(&fake, &store, &state);
    super::key::save(&store, VAULT, KEY).unwrap();

    set(&store.refusing, true);
    session.set_key("grn_ATypoTheKeychainRefused").unwrap_err();
    set(&store.refusing, false);
    state.heard(VAULT, "grn_AnEarlierKey", 401);

    assert_eq!(session.status().unwrap().last_refusal, None);
    state.heard(VAULT, KEY, 401);
    assert_eq!(session.status().unwrap().last_refusal, Some(401));
}
