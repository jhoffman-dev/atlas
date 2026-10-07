//! Turning an admitted HTTP request into the contract's `ApiRequest`.
//!
//! Translation only: which method, which path, which query values, which JSON.
//! Whether any of it names something real is for the router to say.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;

use super::vet::Refusal;

/// `API_VERSION_PREFIX` in the contract.
const VERSION_PREFIX: &str = "/v1";

/// The methods `ApiRequest.method` may hold.
const METHODS: [&str; 5] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/// `ApiRequest` in `packages/application/src/api/contract.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ApiRequest {
    pub id: String,
    pub method: &'static str,
    /// Still percent-encoded, exactly as it arrived.
    pub path: String,
    pub query: HashMap<String, String>,
    pub body: serde_json::Value,
}

/// A request id unique for the life of the process, across server restarts, so
/// an answer that arrives late for a request of a server since stopped cannot be
/// mistaken for the answer to a new one.
pub fn next_id() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    format!("req-{}", NEXT.fetch_add(1, Ordering::Relaxed))
}

/// Only `/v1` is forwarded, and only for the contract's methods. Anything else
/// has no route, which the host can say without asking the app.
pub fn route(method: &str, path: &str) -> Result<&'static str, Refusal> {
    let versioned = path == VERSION_PREFIX
        || path
            .strip_prefix(VERSION_PREFIX)
            .is_some_and(|rest| rest.starts_with('/'));
    let method = METHODS.iter().find(|known| **known == method);
    match (versioned, method) {
        (true, Some(method)) => Ok(method),
        _ => Err(Refusal::NO_ROUTE),
    }
}

/// Decoded, and a repeated key keeps its last value, as the contract says.
/// A key or value that does not decode to UTF-8 is refused: rewriting it would
/// hand the router a different request from the one sent.
pub fn parse_query(query: Option<&str>) -> Result<HashMap<String, String>, Refusal> {
    query
        .unwrap_or("")
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            Ok((decode_component(key)?, decode_component(value)?))
        })
        .collect()
}

/// `application/x-www-form-urlencoded`: `+` is a space, `%XX` is a byte.
fn decode_component(encoded: &str) -> Result<String, Refusal> {
    let spaced = encoded.replace('+', " ");
    let bytes: Vec<u8> = percent_encoding::percent_decode_str(&spaced).collect();
    String::from_utf8(bytes).map_err(|_| Refusal::QUERY_NOT_UTF8)
}

/// No body is `null`; a body that is there must be JSON.
pub fn parse_body(bytes: &[u8]) -> Result<serde_json::Value, Refusal> {
    if bytes.is_empty() {
        return Ok(serde_json::Value::Null);
    }
    serde_json::from_slice(bytes).map_err(|_| Refusal::NOT_JSON)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn forwards_the_contract_methods_under_v1() {
        for method in METHODS {
            assert_eq!(route(method, "/v1/notes"), Ok(method));
        }
        assert_eq!(route("GET", "/v1"), Ok("GET"));
        assert_eq!(route("GET", "/v1/"), Ok("GET"));
    }

    #[test]
    fn has_no_route_outside_v1() {
        for path in [
            "/",
            "/v2/notes",
            "/v10/notes",
            "/v1notes",
            "/api/v1/notes",
            "",
        ] {
            assert_eq!(route("GET", path), Err(Refusal::NO_ROUTE), "{path:?}");
        }
    }

    #[test]
    fn has_no_route_for_other_methods() {
        for method in ["HEAD", "OPTIONS", "TRACE", "CONNECT", "get"] {
            assert_eq!(
                route(method, "/v1/status"),
                Err(Refusal::NO_ROUTE),
                "{method}"
            );
        }
    }

    #[test]
    fn decodes_the_query_and_keeps_the_last_of_a_repeated_key() {
        let query = parse_query(Some(
            "q=hello%20world&limit=5&limit=10&tag=a%2Fb&&sp=a+b%2B&flag&caf%C3%A9=%E2%9C%93",
        ))
        .unwrap();
        assert_eq!(query.get("q").map(String::as_str), Some("hello world"));
        assert_eq!(query.get("limit").map(String::as_str), Some("10"));
        assert_eq!(query.get("tag").map(String::as_str), Some("a/b"));
        assert_eq!(query.get("sp").map(String::as_str), Some("a b+"));
        assert_eq!(query.get("flag").map(String::as_str), Some(""));
        assert_eq!(query.get("café").map(String::as_str), Some("✓"));
        assert_eq!(query.len(), 6);
    }

    #[test]
    fn an_absent_query_is_empty() {
        assert!(parse_query(None).unwrap().is_empty());
        assert!(parse_query(Some("")).unwrap().is_empty());
    }

    #[test]
    fn a_query_that_does_not_decode_to_utf8_is_refused() {
        for query in ["q=%FF", "q=%C3", "%FE=x", "a=1&q=caf%E9"] {
            assert_eq!(
                parse_query(Some(query)),
                Err(Refusal::QUERY_NOT_UTF8),
                "{query}"
            );
        }
    }

    #[test]
    fn no_body_is_null() {
        assert_eq!(parse_body(b""), Ok(serde_json::Value::Null));
    }

    #[test]
    fn a_json_body_is_parsed() {
        assert_eq!(
            parse_body(br#"{"title":"Hi","n":[1,2]}"#),
            Ok(json!({ "title": "Hi", "n": [1, 2] }))
        );
    }

    #[test]
    fn a_body_that_is_not_json_is_invalid() {
        assert_eq!(parse_body(b"title=Hi"), Err(Refusal::NOT_JSON));
        assert_eq!(parse_body(b"{\"a\":"), Err(Refusal::NOT_JSON));
        assert_eq!(parse_body(&[0xff, 0xfe]), Err(Refusal::NOT_JSON));
    }

    #[test]
    fn ids_are_unique() {
        let ids: std::collections::HashSet<String> = (0..1000).map(|_| next_id()).collect();
        assert_eq!(ids.len(), 1000);
    }

    #[test]
    fn serialises_as_the_contract_shape() {
        let request = ApiRequest {
            id: "req-1".into(),
            method: "GET",
            path: "/v1/notes/a%20b.md".into(),
            query: HashMap::from([("q".to_string(), "x".to_string())]),
            body: serde_json::Value::Null,
        };
        assert_eq!(
            serde_json::to_value(&request).unwrap(),
            json!({
                "id": "req-1",
                "method": "GET",
                "path": "/v1/notes/a%20b.md",
                "query": { "q": "x" },
                "body": null
            })
        );
    }
}
