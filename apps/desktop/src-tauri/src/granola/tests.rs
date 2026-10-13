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

#[tokio::test(flavor = "multi_thread")]
async fn a_403_marks_the_key_refused_and_a_success_clears_it() {
    let setup = Setup::keyed().await;
    setup.granola().reply = Reply::Status(403);
    let answer = setup.session().request(NOTES, &no_query()).await.unwrap();
    assert_eq!(answer.status, 403);
    assert_eq!(setup.refusal(), Some(403));

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
    let seen = state.standing(VAULT);
    state.key_changed(VAULT);
    state.heard(VAULT, seen, 401);
    assert_eq!(state.standing(VAULT).refused, None);

    let now = state.standing(VAULT);
    state.heard(VAULT, now, 401);
    assert_eq!(state.standing(VAULT).refused, Some(401));
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
