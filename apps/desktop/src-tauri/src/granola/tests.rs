//! The Granola module end to end, against a fake Granola on this machine's
//! loopback: the requests are real HTTP, and the Keychain is the in-memory
//! store.

use std::collections::BTreeMap;
use std::net::Ipv4Addr;
use std::sync::MutexGuard;

use reqwest::Url;

use super::fake_granola::{FakeGranola, Granola, Reply};
use super::{FailureKind, GranolaFailure, GranolaState, GranolaStatus, Session};
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

    /// With the key set in DFAI and honoured by the fake, and the request
    /// that checked it as it was set no longer counted among those heard.
    async fn keyed() -> Self {
        let setup = Self::new().await;
        setup.granola().key = Some(KEY.into());
        setup.session().set_key(KEY).await.unwrap();
        setup.granola().heard.clear();
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
    setup.granola().key = Some("grn_ANewOne".into());
    setup.granola().reply = Reply::Notes;
    let status = setup.session().set_key("grn_ANewOne").await.unwrap();
    assert_eq!(status.last_refusal, None);
    assert_eq!(setup.refusal(), None);

    setup.granola().reply = Reply::Status(401);
    setup.session().request(NOTES, &no_query()).await.unwrap();
    assert_eq!(setup.refusal(), Some(401));
    setup.session().forget_key().unwrap();
    assert_eq!(setup.refusal(), None);
}

/// Every answer is the latest word on the key: one that is not a 401 clears
/// a refusal, whatever it says otherwise.
#[tokio::test(flavor = "multi_thread")]
async fn any_other_status_is_an_answer_and_clears_a_refusal() {
    let setup = Setup::keyed().await;
    for status in [404, 413, 429, 500, 503] {
        setup.granola().reply = Reply::Status(401);
        setup.session().request(NOTES, &no_query()).await.unwrap();
        assert_eq!(setup.refusal(), Some(401), "{status}");

        setup.granola().reply = Reply::Status(status);
        let answer = setup.session().request(NOTES, &no_query()).await.unwrap();
        assert_eq!(answer.status, status);
        assert_eq!(setup.refusal(), None, "{status}");
    }
}

/// No key was set in this run: a refusal of the one kept from an earlier run
/// is heard like any other.
#[tokio::test(flavor = "multi_thread")]
async fn a_refusal_of_a_key_kept_from_an_earlier_run_is_kept() {
    let setup = Setup::new().await;
    super::key::save(&setup.store, VAULT, KEY).await.unwrap();

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

    setup.session().set_key("not-a-key").await.unwrap_err();

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
    session.set_key(KEY).await.unwrap();
    let failure = session.request(NOTES, &no_query()).await.unwrap_err();
    assert_eq!(failure.kind, FailureKind::Unreachable);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_key_that_is_empty_or_not_granolas_is_refused_and_the_kept_one_stays() {
    let setup = Setup::keyed().await;
    for key in ["", "grn_", "sk-ant-Fict10nal", "Bearer grn_abc", "grn_a b"] {
        let failure = setup.session().set_key(key).await.unwrap_err();
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
    let mut handed = vec![
        as_handed(session.set_key(KEY).await),
        as_handed(session.status()),
    ];
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
    handed.push(as_handed(session.set_key("not-a-key").await));
    handed.push(as_handed(session.forget_key()));
    handed.push(as_handed(session.request(NOTES, &no_query()).await));

    assert_eq!(setup.heard(), 9, "every reply was not exercised");
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

/// Setting a key asks Granola once with it — the first page of one note —
/// and answers with what Granola said: a key it does not know is reported
/// refused at once, and one it knows clears that.
#[tokio::test(flavor = "multi_thread")]
async fn setting_a_key_asks_granola_once_and_answers_whether_it_was_refused() {
    let setup = Setup::new().await;
    setup.granola().key = Some(KEY.into());

    let refused = setup.session().set_key("grn_ATypoOfTheKey").await.unwrap();
    assert_eq!(
        refused,
        GranolaStatus {
            has_key: true,
            last_refusal: Some(401)
        }
    );
    assert_eq!(setup.refusal(), Some(401));

    let known = setup.session().set_key(KEY).await.unwrap();
    assert_eq!(
        known,
        GranolaStatus {
            has_key: true,
            last_refusal: None
        }
    );
    let heard = setup.granola().heard.clone();
    assert_eq!(heard.len(), 2, "each key was checked once");
    assert_eq!(heard[1].method, "GET");
    assert_eq!(heard[1].target, "/v1/notes?page_size=1");
    assert_eq!(heard[1].authorization, format!("Bearer {KEY}"));
}

/// Granola cannot be reached when the key is set: it is kept, and nothing
/// has been heard about it, so no refusal is reported — not even the last
/// key's.
#[tokio::test(flavor = "multi_thread")]
async fn a_key_set_while_granola_cannot_be_reached_is_kept_with_no_refusal() {
    let closed = {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        Url::parse(&format!(
            "http://127.0.0.1:{}",
            listener.local_addr().unwrap().port()
        ))
        .unwrap()
    };
    let (store, state) = (MemoryStore::default(), GranolaState::default());
    let session = Session {
        origin: &closed,
        store: &store,
        scope: VAULT,
        state: &state,
    };
    state.heard(VAULT, 401);

    let status = session.set_key(KEY).await.unwrap();

    assert_eq!(
        status,
        GranolaStatus {
            has_key: true,
            last_refusal: None
        }
    );
    assert_eq!(session.status().unwrap(), status);
}

/// A Keychain failure changes nothing that was kept, so what Granola last
/// said stands, and the key is not checked.
#[tokio::test(flavor = "multi_thread")]
async fn a_failed_save_or_forget_leaves_the_last_refusal_standing() {
    let fake = FakeGranola::start().await;
    let store = RefusingStore(MemoryStore::default());
    super::key::save(&store.0, VAULT, KEY).await.unwrap();
    let state = GranolaState::default();
    let session = Session {
        origin: &fake.origin,
        store: &store,
        scope: VAULT,
        state: &state,
    };
    state.heard(VAULT, 401);

    let failed_save = session.set_key("grn_ANewOne").await.unwrap_err();
    assert_eq!(failed_save.kind, FailureKind::Keychain);
    assert_eq!(session.status().unwrap().last_refusal, Some(401));
    let failed_forget = session.forget_key().unwrap_err();
    assert_eq!(failed_forget.kind, FailureKind::Keychain);

    assert_eq!(
        session.status().unwrap(),
        GranolaStatus {
            has_key: true,
            last_refusal: Some(401)
        }
    );
    assert!(
        fake.granola.lock().unwrap().heard.is_empty(),
        "a key was checked"
    );
}

/// A Keychain that keeps what it is given and then reports that it failed.
struct KeepsButFailsStore(MemoryStore);

impl SecretStore for KeepsButFailsStore {
    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        self.0.set(account, value)?;
        Err("the keychain timed out".into())
    }
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        self.0.get(account)
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        self.0.delete(account)
    }
    fn accounts(&self) -> Result<Vec<String>, String> {
        self.0.accounts()
    }
}

/// Round 3 found that, with the standing tied to which key an answer was
/// about, a save the Keychain reported failed but kept could pin the old
/// key's 401 against the new one for the rest of the run. Now the last answer
/// is the word, whichever key it was about: the failed save clears nothing,
/// and the next answer — to the key the Keychain did keep — replaces the 401.
#[tokio::test(flavor = "multi_thread")]
async fn after_a_save_reported_failed_the_next_answer_is_the_word_on_the_key() {
    let fake = FakeGranola::start().await;
    let new = "grn_TheNewKey";
    fake.granola.lock().unwrap().key = Some(new.into());
    let store = KeepsButFailsStore(MemoryStore::default());
    super::key::save(&store.0, VAULT, KEY).await.unwrap();
    let state = GranolaState::default();
    let session = Session {
        origin: &fake.origin,
        store: &store,
        scope: VAULT,
        state: &state,
    };
    state.heard(VAULT, 401);

    assert_eq!(
        session.set_key(new).await.unwrap_err().kind,
        FailureKind::Keychain
    );
    assert_eq!(session.status().unwrap().last_refusal, Some(401));

    let answer = session.request(NOTES, &no_query()).await.unwrap();
    assert_eq!(answer.status, 200, "the key the Keychain kept works");
    assert_eq!(session.status().unwrap().last_refusal, None);
}

/// A store whose next write, once armed, holds until let go — a Keychain
/// prompt the person is looking at — and then fails without writing, as when
/// the prompt is denied.
struct DeniedStore {
    inner: MemoryStore,
    armed: std::sync::atomic::AtomicBool,
    prompting: std::sync::mpsc::SyncSender<()>,
    answered: std::sync::Mutex<std::sync::mpsc::Receiver<()>>,
}

impl SecretStore for DeniedStore {
    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        if self.armed.load(std::sync::atomic::Ordering::SeqCst) {
            let _ = self.prompting.send(());
            let _ = self.answered.lock().unwrap().recv();
            return Err("the person denied Keychain access".into());
        }
        self.inner.set(account, value)
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

/// Round 3 found that a 401 heard while a new key's save waited on a Keychain
/// prompt was set aside as being about another key, and lost when the prompt
/// was denied. Now it is the last answer, and the denied save clears nothing,
/// so it stands.
#[tokio::test(flavor = "multi_thread")]
async fn a_refusal_heard_while_a_save_waits_on_the_keychain_stands_when_the_save_fails() {
    let fake = FakeGranola::start().await;
    fake.granola.lock().unwrap().key = Some(KEY.into());
    let (prompting, prompted) = std::sync::mpsc::sync_channel(1);
    let (answer, answered) = std::sync::mpsc::channel();
    let store: &'static DeniedStore = Box::leak(Box::new(DeniedStore {
        inner: MemoryStore::default(),
        armed: std::sync::atomic::AtomicBool::new(false),
        prompting,
        answered: std::sync::Mutex::new(answered),
    }));
    let state: &'static GranolaState = Box::leak(Box::default());
    let origin: &'static Url = Box::leak(Box::new(fake.origin.clone()));
    let session = move || Session {
        origin,
        store,
        scope: VAULT,
        state,
    };
    assert_eq!(session().set_key(KEY).await.unwrap().last_refusal, None);
    store.armed.store(true, std::sync::atomic::Ordering::SeqCst);

    let setting = std::thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(session().set_key("grn_TheNewKey"))
            .unwrap_err()
    });
    prompted.recv().unwrap();
    fake.granola.lock().unwrap().key = Some("grn_RevokedMeanwhile".into());
    let refused = session().request(NOTES, &no_query()).await.unwrap();
    answer.send(()).unwrap();
    assert_eq!(setting.join().unwrap().kind, FailureKind::Keychain);

    assert_eq!(refused.status, 401);
    assert_eq!(session().status().unwrap().last_refusal, Some(401));
}

/// A key kept before DFAI refused one it could not strike from an answer is
/// not sent: the request is refused before it goes, and says what to do.
#[tokio::test(flavor = "multi_thread")]
async fn a_key_kept_too_long_to_protect_is_refused_before_anything_is_sent() {
    let setup = Setup::new().await;
    let kept = format!("grn_{}", crate::secrets::tests::a_signed_token(8 * 1024));
    setup.store.set("v1:apikey/granola", &kept).unwrap();

    let failure = setup
        .session()
        .request(NOTES, &no_query())
        .await
        .unwrap_err();

    assert_eq!(failure.kind, FailureKind::Invalid);
    assert!(
        failure.message.contains("replace it"),
        "{}",
        failure.message
    );
    assert_eq!(setup.heard(), 0, "the key went out");
}

/// A Granola on loopback that takes one request and answers it with
/// `status` only when released, so that a test can act while it is out.
struct HeldGranola {
    origin: &'static Url,
    arrived: tokio::sync::oneshot::Receiver<()>,
    release: tokio::sync::oneshot::Sender<()>,
}

impl HeldGranola {
    async fn start(status: &'static str) -> Self {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let origin: &'static Url = Box::leak(Box::new(
            Url::parse(&format!(
                "http://127.0.0.1:{}",
                listener.local_addr().unwrap().port()
            ))
            .unwrap(),
        ));
        let (arrived_tx, arrived) = tokio::sync::oneshot::channel();
        let (release, released) = tokio::sync::oneshot::channel::<()>();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 4096];
            let _ = socket.read(&mut request).await.unwrap();
            arrived_tx.send(()).unwrap();
            released.await.unwrap();
            let body = r#"{"notes":[],"hasMore":false,"cursor":null}"#;
            let response = format!(
                "HTTP/1.1 {status}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        Self {
            origin,
            arrived,
            release,
        }
    }
}

/// A session over memory that lives as long as the test's spawned tasks.
fn leaked_session(origin: &'static Url, key: &str) -> impl Fn() -> Session<'static> + Copy {
    let store: &'static MemoryStore = Box::leak(Box::default());
    let state: &'static GranolaState = Box::leak(Box::default());
    store.set("v1:apikey/granola", key).unwrap();
    move || Session {
        origin,
        store,
        scope: VAULT,
        state,
    }
}

/// Adversarial (P28-10 round 3, after 0d51773), rewritten for round 4. A
/// pull already out with the key strikes its answer after the key was
/// forgotten, and that builds or uses the forgotten key's matcher again.
/// Forgetting never let go of it for good; what holds is the bound: it is
/// let go once eight other values have been used.
#[tokio::test(flavor = "multi_thread")]
async fn a_key_forgotten_while_a_request_is_out_is_let_go_once_eight_other_values_are_used() {
    let key = "grn_InFlightForgottenLarkspurKey";
    let granola = HeldGranola::start("200 OK").await;
    let session = leaked_session(granola.origin, key);

    let out = tokio::spawn(async move { session().request(NOTES, &no_query()).await });
    granola.arrived.await.unwrap();
    session().forget_key().unwrap();
    granola.release.send(()).unwrap();
    assert_eq!(out.await.unwrap().unwrap().status, 200);

    crate::secrets::tests::use_eight_other_values();

    assert!(
        !crate::secrets::holds_matcher(key),
        "the forgotten key's matcher outlived eight others"
    );
}

/// A 401 to a request sent before the key was forgotten arrives after it. It
/// is news about a key no longer kept, so it is not reported as a refusal;
/// and a key set afterwards starts with none.
#[tokio::test(flavor = "multi_thread")]
async fn a_401_that_arrives_after_the_key_was_forgotten_is_not_reported() {
    let granola = HeldGranola::start("401 Unauthorized").await;
    let session = leaked_session(granola.origin, KEY);

    let out = tokio::spawn(async move { session().request(NOTES, &no_query()).await });
    granola.arrived.await.unwrap();
    session().forget_key().unwrap();
    granola.release.send(()).unwrap();
    assert_eq!(out.await.unwrap().unwrap().status, 401);

    assert_eq!(
        session().status().unwrap(),
        GranolaStatus {
            has_key: false,
            last_refusal: None
        }
    );
}

/// Adversarial (P28-10 round 3, after 0d51773), rewritten for round 4.
/// `key::save` builds the new key's matcher before the Keychain is asked;
/// when the Keychain refuses it the key is not kept, and its matcher is held
/// until eight other values have been used.
#[tokio::test(flavor = "multi_thread")]
async fn a_key_the_keychain_refused_is_let_go_once_eight_other_values_are_used() {
    let fake = FakeGranola::start().await;
    let store = RefusingStore(MemoryStore::default());
    let state = GranolaState::default();
    let session = Session {
        origin: &fake.origin,
        store: &store,
        scope: VAULT,
        state: &state,
    };
    let refused = "grn_KeychainRefusedLarkspurKey";

    assert_eq!(
        session.set_key(refused).await.unwrap_err().kind,
        FailureKind::Keychain
    );
    crate::secrets::tests::use_eight_other_values();

    assert!(
        !crate::secrets::holds_matcher(refused),
        "the refused key's matcher outlived eight others"
    );
}

/// Setting a key builds its matcher — most of a second for a long one in a
/// debug build — on a thread kept for it, not on the async worker.
#[tokio::test]
async fn setting_a_key_never_stalls_the_worker() {
    let setup = Setup::new().await;
    let long = format!(
        "grn_SetNotYetBuilt{}",
        crate::secrets::tests::a_signed_token(2_000)
    );

    let status =
        crate::secrets::tests::assert_never_stalls_the_worker(setup.session().set_key(&long))
            .await
            .unwrap();

    assert!(status.has_key);
}

/// A request checks the kept key can be struck before it goes, which builds
/// its matcher when it is not held, on a thread kept for it.
#[tokio::test]
async fn a_request_never_stalls_the_worker() {
    let setup = Setup::new().await;
    let long = format!(
        "grn_SentNotYetBuilt{}",
        crate::secrets::tests::a_signed_token(2_000)
    );
    setup.store.set("v1:apikey/granola", &long).unwrap();

    let answer = crate::secrets::tests::assert_never_stalls_the_worker(
        setup.session().request(NOTES, &no_query()),
    )
    .await
    .unwrap();

    assert_eq!(answer.status, 401);
}
