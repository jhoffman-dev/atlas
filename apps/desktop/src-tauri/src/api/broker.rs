//! Matching the app's answers to the requests waiting for them.
//!
//! A request is handed to the webview as an event and answered later through a
//! command, so between the two it waits here under its id. An answer for an id
//! nobody is waiting on — late, duplicated, or made up — is dropped.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use tokio::sync::oneshot;

/// What the app answered: `ApiResponse` without its id.
#[derive(Debug, Clone, PartialEq)]
pub struct Answer {
    pub status: u16,
    pub body: serde_json::Value,
}

#[derive(Default)]
pub struct Broker {
    pending: Mutex<HashMap<String, oneshot::Sender<Answer>>>,
}

/// A request's place in the queue. Dropping it stops waiting.
pub struct Ticket<'a> {
    broker: &'a Broker,
    id: String,
    receiver: oneshot::Receiver<Answer>,
}

impl Broker {
    fn pending(&self) -> std::sync::MutexGuard<'_, HashMap<String, oneshot::Sender<Answer>>> {
        // A panic while holding this lock leaves a map that is still a valid
        // map; carrying on is safer than refusing every request from now on.
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Starts waiting for `id`. Register before handing the request over, so an
    /// answer that comes back quickly has somewhere to land.
    pub fn register(&self, id: &str) -> Ticket<'_> {
        let (sender, receiver) = oneshot::channel();
        self.pending().insert(id.to_string(), sender);
        Ticket {
            broker: self,
            id: id.to_string(),
            receiver,
        }
    }

    /// Delivers an answer. False when nobody was waiting for this id.
    pub fn answer(&self, id: &str, answer: Answer) -> bool {
        match self.pending().remove(id) {
            // The receiver is gone only if its ticket was dropped between the
            // remove and here; there is nobody left to tell.
            Some(sender) => sender.send(answer).is_ok(),
            None => false,
        }
    }

    #[cfg(test)]
    pub fn waiting(&self) -> usize {
        self.pending().len()
    }
}

impl Ticket<'_> {
    /// The answer, or None if none came within `timeout`.
    pub async fn wait(mut self, timeout: Duration) -> Option<Answer> {
        tokio::time::timeout(timeout, &mut self.receiver)
            .await
            .ok()
            .and_then(Result::ok)
    }
}

impl Drop for Ticket<'_> {
    fn drop(&mut self) {
        // Whether answered, timed out or abandoned (the caller hung up), the id
        // stops being answerable, so the map cannot grow without bound.
        self.broker.pending().remove(&self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ok(body: serde_json::Value) -> Answer {
        Answer { status: 200, body }
    }

    #[tokio::test]
    async fn delivers_an_answer_to_the_request_waiting_for_it() {
        let broker = Broker::default();
        let first = broker.register("a");
        let second = broker.register("b");

        assert!(broker.answer("b", ok(json!("for b"))));
        assert!(broker.answer("a", ok(json!("for a"))));

        assert_eq!(
            first.wait(Duration::from_secs(1)).await,
            Some(ok(json!("for a")))
        );
        assert_eq!(
            second.wait(Duration::from_secs(1)).await,
            Some(ok(json!("for b")))
        );
        assert_eq!(broker.waiting(), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn gives_up_after_the_timeout_and_forgets_the_request() {
        let broker = Broker::default();
        let ticket = broker.register("slow");

        assert_eq!(ticket.wait(Duration::from_secs(30)).await, None);
        assert_eq!(broker.waiting(), 0);
        assert!(
            !broker.answer("slow", ok(json!(null))),
            "a late answer is dropped"
        );
    }

    #[test]
    fn ignores_an_answer_for_an_unknown_id() {
        let broker = Broker::default();
        let _ticket = broker.register("real");
        assert!(!broker.answer("made-up", ok(json!(null))));
        assert_eq!(broker.waiting(), 1);
    }

    #[test]
    fn ignores_a_second_answer_for_the_same_id() {
        let broker = Broker::default();
        let _ticket = broker.register("once");
        assert!(broker.answer("once", ok(json!(1))));
        assert!(!broker.answer("once", ok(json!(2))));
    }

    #[test]
    fn a_dropped_ticket_is_no_longer_answerable() {
        let broker = Broker::default();
        drop(broker.register("gone"));
        assert_eq!(broker.waiting(), 0);
        assert!(!broker.answer("gone", ok(json!(null))));
    }
}
