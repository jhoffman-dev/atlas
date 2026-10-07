//! Whether a request may reach the app at all.
//!
//! Everything here is about the envelope — who is asking, from where, and how
//! much — never about what the request means. That is the router's business, in
//! TypeScript (ADR-0005). The refusals and their order are ADR-0016's security
//! model:
//!
//! 1. The request target names a host, or `Host` is not exactly
//!    `127.0.0.1:<port>` or `localhost:<port>` → 403.
//! 2. Any `Origin` header → 403.
//! 3. No token, or the wrong one → 401.
//! 4. A declared body over the cap → 413.
//!
//! Host and Origin come first because they are what a browser page trips, and a
//! page should learn nothing — not even whether it guessed the token — from a
//! request it was never allowed to make. Size comes last so that an
//! unauthenticated caller cannot probe anything but "no".

use std::hint::black_box;

/// ADR-0016: bodies over 1 MiB are refused before they are read into memory.
pub const MAX_BODY_BYTES: usize = 1024 * 1024;

/// Why the host answered a request itself instead of forwarding it.
///
/// The codes are `ApiErrorCode`s from `packages/application/src/api/contract.ts`,
/// and the statuses are `API_ERROR_STATUS` for them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refusal {
    pub status: u16,
    pub code: &'static str,
    pub message: &'static str,
}

impl Refusal {
    pub const UNAUTHORIZED: Refusal = Refusal {
        status: 401,
        code: "unauthorized",
        message: "a valid API token is required",
    };
    pub const FOREIGN_HOST: Refusal = Refusal {
        status: 403,
        code: "forbidden",
        message: "the Host header is not this machine",
    };
    pub const HOST_IN_TARGET: Refusal = Refusal {
        status: 403,
        code: "forbidden",
        message: "the request target names a host; send a path, as in `GET /v1/status`",
    };
    pub const BROWSER_ORIGIN: Refusal = Refusal {
        status: 403,
        code: "forbidden",
        message: "requests from a browser page are not accepted",
    };
    pub const TOO_LARGE: Refusal = Refusal {
        status: 413,
        code: "too_large",
        message: "the body is larger than 1 MiB",
    };
    pub const NOT_JSON: Refusal = Refusal {
        status: 400,
        code: "invalid",
        message: "the body is not JSON",
    };
    pub const QUERY_NOT_UTF8: Refusal = Refusal {
        status: 400,
        code: "invalid",
        message: "the query string does not decode to UTF-8",
    };
    pub const BODY_UNREADABLE: Refusal = Refusal {
        status: 400,
        code: "invalid",
        message: "the body could not be read",
    };
    pub const NO_ROUTE: Refusal = Refusal {
        status: 404,
        code: "not_found_route",
        message: "no route for this method and path",
    };
    pub const TIMEOUT: Refusal = Refusal {
        status: 504,
        code: "timeout",
        message: "Atlas did not answer in time",
    };
    pub const INTERNAL: Refusal = Refusal {
        status: 500,
        code: "internal",
        message: "the request could not be handed to Atlas",
    };

    /// The router is not listening yet: the app is starting, or its page is
    /// reloading. `internal` because the contract has no closer code.
    pub const STARTING: Refusal = Refusal {
        status: 500,
        code: "internal",
        message: "Atlas is still starting — try again in a moment",
    };

    /// The contract's error body: `{"error":{"code":..,"message":..}}`.
    pub fn body(&self) -> serde_json::Value {
        serde_json::json!({ "error": { "code": self.code, "message": self.message } })
    }
}

/// The parts of a request's envelope that decide whether it is let in.
///
/// Every header is given as all the values it arrived with, so a request that
/// repeats one to smuggle a second value past the check is refused rather than
/// judged on whichever copy happens to be first.
#[derive(Debug, Default)]
pub struct Envelope<'a> {
    /// The request line carried an authority (`GET http://host/v1/…`). RFC 9112
    /// makes that, not `Host`, the request's host, so the Host check would be
    /// judging a header the request itself says to ignore.
    pub target_names_host: bool,
    pub host: Vec<&'a [u8]>,
    pub origin: Vec<&'a [u8]>,
    pub authorization: Vec<&'a [u8]>,
    /// From `Content-Length`, when the request declared one.
    pub declared_length: Option<u64>,
}

/// What this server expects of a request.
pub struct Expected<'a> {
    pub port: u16,
    pub token: &'a str,
    pub max_body: usize,
}

pub fn vet(envelope: &Envelope<'_>, expected: &Expected<'_>) -> Result<(), Refusal> {
    if envelope.target_names_host {
        return Err(Refusal::HOST_IN_TARGET);
    }
    if !is_this_machine(&envelope.host, expected.port) {
        return Err(Refusal::FOREIGN_HOST);
    }
    if !envelope.origin.is_empty() {
        return Err(Refusal::BROWSER_ORIGIN);
    }
    if !carries_token(&envelope.authorization, expected.token) {
        return Err(Refusal::UNAUTHORIZED);
    }
    if envelope
        .declared_length
        .is_some_and(|length| length > expected.max_body as u64)
    {
        return Err(Refusal::TOO_LARGE);
    }
    Ok(())
}

/// This is what defeats DNS rebinding: a page on `evil.test` that resolves to
/// 127.0.0.1 still sends `Host: evil.test`.
fn is_this_machine(host: &[&[u8]], port: u16) -> bool {
    let [only] = host else {
        return false;
    };
    let loopback = format!("127.0.0.1:{port}");
    let localhost = format!("localhost:{port}");
    *only == loopback.as_bytes() || *only == localhost.as_bytes()
}

fn carries_token(authorization: &[&[u8]], token: &str) -> bool {
    let [only] = authorization else {
        return false;
    };
    // The scheme is case-insensitive (RFC 9110 §11.1); the token is not.
    const SCHEME: &[u8] = b"bearer ";
    if only.len() < SCHEME.len() || !only[..SCHEME.len()].eq_ignore_ascii_case(SCHEME) {
        return false;
    }
    constant_time_eq(&only[SCHEME.len()..], token.as_bytes())
}

/// Compares two byte strings in time that depends only on their length.
///
/// A plain `==` returns at the first differing byte, so how long a wrong guess
/// takes says how much of it was right. The token's length is not a secret (it
/// is always 64 hex characters), so returning early on a length mismatch leaks
/// nothing worth having.
pub fn constant_time_eq(presented: &[u8], expected: &[u8]) -> bool {
    if presented.len() != expected.len() {
        return false;
    }
    let difference = presented
        .iter()
        .zip(expected)
        .fold(0u8, |acc, (a, b)| black_box(acc | (a ^ b)));
    black_box(difference) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12";
    const PORT: u16 = 27183;

    fn expected() -> Expected<'static> {
        Expected {
            port: PORT,
            token: TOKEN,
            max_body: MAX_BODY_BYTES,
        }
    }

    fn bearer() -> Vec<u8> {
        format!("Bearer {TOKEN}").into_bytes()
    }

    fn envelope_with<'a>(host: &'a [u8], authorization: &'a [u8]) -> Envelope<'a> {
        Envelope {
            host: vec![host],
            authorization: vec![authorization],
            ..Envelope::default()
        }
    }

    #[test]
    fn lets_in_a_request_from_this_machine_with_the_token() {
        let auth = bearer();
        assert_eq!(
            vet(&envelope_with(b"127.0.0.1:27183", &auth), &expected()),
            Ok(())
        );
        assert_eq!(
            vet(&envelope_with(b"localhost:27183", &auth), &expected()),
            Ok(())
        );
    }

    #[test]
    fn refuses_a_target_that_names_a_host_even_with_a_good_host_header() {
        let auth = bearer();
        let envelope = Envelope {
            target_names_host: true,
            ..envelope_with(b"127.0.0.1:27183", &auth)
        };
        assert_eq!(vet(&envelope, &expected()), Err(Refusal::HOST_IN_TARGET));
    }

    #[test]
    fn refuses_a_request_with_no_token() {
        let envelope = Envelope {
            host: vec![b"127.0.0.1:27183"],
            ..Envelope::default()
        };
        assert_eq!(vet(&envelope, &expected()), Err(Refusal::UNAUTHORIZED));
    }

    #[test]
    fn refuses_the_wrong_token() {
        let wrong = format!("Bearer {}", TOKEN.replace('a', "b"));
        let envelope = envelope_with(b"127.0.0.1:27183", wrong.as_bytes());
        assert_eq!(vet(&envelope, &expected()), Err(Refusal::UNAUTHORIZED));
    }

    #[test]
    fn refuses_a_token_that_is_only_a_prefix_or_has_a_tail() {
        for presented in [
            format!("Bearer {}", &TOKEN[..63]),
            format!("Bearer {TOKEN}0"),
            format!("Bearer  {TOKEN}"),
            format!("Bearer {TOKEN} "),
        ] {
            let envelope = envelope_with(b"127.0.0.1:27183", presented.as_bytes());
            assert_eq!(
                vet(&envelope, &expected()),
                Err(Refusal::UNAUTHORIZED),
                "{presented:?}"
            );
        }
    }

    #[test]
    fn refuses_another_scheme_but_accepts_bearer_in_any_case() {
        let basic = format!("Basic {TOKEN}");
        let envelope = envelope_with(b"127.0.0.1:27183", basic.as_bytes());
        assert_eq!(vet(&envelope, &expected()), Err(Refusal::UNAUTHORIZED));

        let lower = format!("bearer {TOKEN}");
        let envelope = envelope_with(b"127.0.0.1:27183", lower.as_bytes());
        assert_eq!(vet(&envelope, &expected()), Ok(()));
    }

    #[test]
    fn refuses_a_repeated_authorization_header_even_if_one_copy_is_right() {
        let auth = bearer();
        let envelope = Envelope {
            host: vec![b"127.0.0.1:27183"],
            authorization: vec![&auth, b"Bearer nope"],
            ..Envelope::default()
        };
        assert_eq!(vet(&envelope, &expected()), Err(Refusal::UNAUTHORIZED));
    }

    #[test]
    fn refuses_a_foreign_host_even_with_the_token() {
        let auth = bearer();
        for host in [
            &b"evil.test"[..],
            b"evil.test:27183",
            b"127.0.0.1",
            b"localhost",
            b"127.0.0.1:27184",
            b"0.0.0.0:27183",
            b"[::1]:27183",
            b"127.0.0.1:27183.evil.test",
            b"",
        ] {
            let envelope = envelope_with(host, &auth);
            assert_eq!(
                vet(&envelope, &expected()),
                Err(Refusal::FOREIGN_HOST),
                "{}",
                String::from_utf8_lossy(host)
            );
        }
    }

    #[test]
    fn refuses_a_missing_or_repeated_host() {
        let auth = bearer();
        let missing = Envelope {
            authorization: vec![&auth],
            ..Envelope::default()
        };
        assert_eq!(vet(&missing, &expected()), Err(Refusal::FOREIGN_HOST));

        let repeated = Envelope {
            host: vec![b"127.0.0.1:27183", b"evil.test"],
            authorization: vec![&auth],
            ..Envelope::default()
        };
        assert_eq!(vet(&repeated, &expected()), Err(Refusal::FOREIGN_HOST));
    }

    #[test]
    fn refuses_any_origin_even_an_empty_or_local_one() {
        let auth = bearer();
        for origin in [
            &b"https://evil.test"[..],
            b"http://127.0.0.1:27183",
            b"null",
            b"",
        ] {
            let envelope = Envelope {
                origin: vec![origin],
                ..envelope_with(b"127.0.0.1:27183", &auth)
            };
            assert_eq!(vet(&envelope, &expected()), Err(Refusal::BROWSER_ORIGIN));
        }
    }

    #[test]
    fn refuses_a_declared_body_over_the_cap_and_accepts_one_at_it() {
        let auth = bearer();
        let at_cap = Envelope {
            declared_length: Some(MAX_BODY_BYTES as u64),
            ..envelope_with(b"127.0.0.1:27183", &auth)
        };
        assert_eq!(vet(&at_cap, &expected()), Ok(()));

        let over = Envelope {
            declared_length: Some(MAX_BODY_BYTES as u64 + 1),
            ..envelope_with(b"127.0.0.1:27183", &auth)
        };
        assert_eq!(vet(&over, &expected()), Err(Refusal::TOO_LARGE));
    }

    #[test]
    fn the_cap_is_one_mebibyte() {
        assert_eq!(MAX_BODY_BYTES, 1_048_576);
    }

    #[test]
    fn a_browser_is_told_forbidden_before_it_learns_anything_about_the_token() {
        let envelope = Envelope {
            host: vec![b"evil.test"],
            origin: vec![b"https://evil.test"],
            declared_length: Some(u64::MAX),
            ..Envelope::default()
        };
        assert_eq!(vet(&envelope, &expected()), Err(Refusal::FOREIGN_HOST));

        let right_host = Envelope {
            host: vec![b"127.0.0.1:27183"],
            ..envelope
        };
        assert_eq!(vet(&right_host, &expected()), Err(Refusal::BROWSER_ORIGIN));
    }

    #[test]
    fn size_is_only_judged_for_a_caller_holding_the_token() {
        let envelope = Envelope {
            host: vec![b"127.0.0.1:27183"],
            declared_length: Some(u64::MAX),
            ..Envelope::default()
        };
        assert_eq!(vet(&envelope, &expected()), Err(Refusal::UNAUTHORIZED));
    }

    #[test]
    fn constant_time_eq_matches_only_identical_bytes() {
        assert!(constant_time_eq(b"", b""));
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"xbc"));
        assert!(!constant_time_eq(b"abc", b"ab"));
        assert!(!constant_time_eq(b"ab", b"abc"));
        // A difference in any single bit of any byte is caught.
        for index in 0..3 {
            for bit in 0..8 {
                let mut flipped = *b"abc";
                flipped[index] ^= 1 << bit;
                assert!(!constant_time_eq(&flipped, b"abc"));
            }
        }
    }

    #[test]
    fn refusal_bodies_follow_the_contract() {
        assert_eq!(
            Refusal::UNAUTHORIZED.body(),
            serde_json::json!({
                "error": { "code": "unauthorized", "message": "a valid API token is required" }
            })
        );
        let statuses = [
            (Refusal::UNAUTHORIZED, 401, "unauthorized"),
            (Refusal::FOREIGN_HOST, 403, "forbidden"),
            (Refusal::BROWSER_ORIGIN, 403, "forbidden"),
            (Refusal::TOO_LARGE, 413, "too_large"),
            (Refusal::NOT_JSON, 400, "invalid"),
            (Refusal::NO_ROUTE, 404, "not_found_route"),
            (Refusal::TIMEOUT, 504, "timeout"),
            (Refusal::INTERNAL, 500, "internal"),
        ];
        for (refusal, status, code) in statuses {
            assert_eq!((refusal.status, refusal.code), (status, code));
        }
    }
}
