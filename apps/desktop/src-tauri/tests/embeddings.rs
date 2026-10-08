//! The embedding model, for real: fetched from its pinned revision into the
//! build's temporary folder the first time (91 MB, so the first run needs the
//! network), checked, loaded, and run.

mod support;

use std::sync::OnceLock;

use atlas_lib::embeddings::fetch::ensure_model;
use atlas_lib::embeddings::model::{Embedder, Purpose, MAX_UNREADABLE_CHARS};
use atlas_lib::embeddings::refusal::{EmbedFailure, RefusalReason};
use atlas_lib::embeddings::{model_folder, MODEL};

const DIMENSIONS: usize = 384;

fn embedder() -> &'static Embedder {
    static EMBEDDER: OnceLock<Embedder> = OnceLock::new();
    EMBEDDER.get_or_init(|| {
        let folder = model_folder(&support::model_home(), &MODEL);
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(ensure_model(&folder, &MODEL))
            .expect("the model is fetched (the first run needs the network)");
        Embedder::load(&folder, &MODEL).expect("the model loads")
    })
}

fn texts(texts: &[&str]) -> Vec<String> {
    texts.iter().map(|text| text.to_string()).collect()
}

fn similarity(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn words(count: usize) -> String {
    vec!["ledger"; count].join(" ")
}

const PASSAGES: [&str; 3] = [
    "Larkspur Payroll pays Mara Quill every other Friday by direct deposit.",
    "Tobias Fenn keeps three hives of bees on the roof of the Larkspur office.",
    "The quarterly payroll tax return for Larkspur is due at the end of the month.",
];

#[test]
fn a_question_lands_nearest_the_passage_that_answers_it() {
    let passages = embedder()
        .embed(&texts(&PASSAGES), Purpose::Passage)
        .unwrap();
    let query = embedder()
        .embed(&texts(&["When does Mara get her pay?"]), Purpose::Query)
        .unwrap();

    let scores: Vec<f32> = passages.iter().map(|p| similarity(&query[0], p)).collect();

    assert!(
        scores[0] > scores[1] && scores[0] > scores[2],
        "scores {scores:?}"
    );
}

#[test]
fn each_text_gets_one_unit_length_vector_of_the_models_size() {
    let vectors = embedder()
        .embed(&texts(&PASSAGES), Purpose::Passage)
        .unwrap();

    assert_eq!(vectors.len(), PASSAGES.len());
    for vector in &vectors {
        assert_eq!(vector.len(), DIMENSIONS);
        let length = similarity(vector, vector).sqrt();
        assert!((length - 1.0).abs() < 1e-4, "length {length}");
    }
}

#[test]
fn vectors_come_back_in_the_order_the_texts_were_sent_whatever_their_lengths() {
    // Lengths that sort differently from the order sent, so passes regroup them.
    let sent = [
        words(300),
        PASSAGES[0].to_string(),
        words(5),
        PASSAGES[1].to_string(),
    ];
    let together = embedder().embed(&sent, Purpose::Passage).unwrap();

    for (text, vector) in sent.iter().zip(&together) {
        let alone = embedder()
            .embed(std::slice::from_ref(text), Purpose::Passage)
            .unwrap();
        let agreement = similarity(&alone[0], vector);
        assert!(agreement > 0.9999, "agreement {agreement}");
    }
}

#[test]
fn the_same_text_embeds_the_same_way_every_time() {
    let first = embedder()
        .embed(&texts(&PASSAGES[..1]), Purpose::Passage)
        .unwrap();
    let second = embedder()
        .embed(&texts(&PASSAGES[..1]), Purpose::Passage)
        .unwrap();

    assert_eq!(first, second);
}

#[test]
fn a_query_is_read_with_the_models_prefix_and_a_passage_without() {
    let text = texts(&["payroll calendar"]);
    let query = embedder().embed(&text, Purpose::Query).unwrap();
    let passage = embedder().embed(&text, Purpose::Passage).unwrap();

    assert!(similarity(&query[0], &passage[0]) < 0.999);
    let prefixed = MODEL.query_prefix.to_string() + "payroll calendar";
    assert_eq!(
        embedder()
            .token_count("payroll calendar", Purpose::Query)
            .unwrap(),
        embedder().token_count(&prefixed, Purpose::Passage).unwrap()
    );
}

#[test]
fn nothing_to_embed_is_no_vectors() {
    assert_eq!(
        embedder().embed(&[], Purpose::Passage).unwrap(),
        Vec::<Vec<f32>>::new()
    );
}

#[test]
fn a_text_as_long_as_the_model_reads_is_embedded() {
    // One token a word, and the model's two markers.
    let longest = words(MODEL.max_tokens - 2);
    assert_eq!(
        embedder().token_count(&longest, Purpose::Passage).unwrap(),
        MODEL.max_tokens
    );

    let vectors = embedder().embed(&[longest], Purpose::Passage).unwrap();

    assert_eq!(vectors[0].len(), DIMENSIONS);
}

#[test]
fn a_text_longer_than_the_model_reads_refuses_the_call_and_says_which() {
    let sent = vec![PASSAGES[0].to_string(), words(MODEL.max_tokens - 1)];

    let error = embedder().embed(&sent, Purpose::Passage).unwrap_err();

    assert_eq!(
        error,
        format!(
            "text 2 of 2 is {} tokens; the embedding model reads at most {}",
            MODEL.max_tokens + 1,
            MODEL.max_tokens
        )
    );
}

fn refusal(sent: &[&str], purpose: Purpose) -> EmbedFailure {
    match embedder().read(&texts(sent), purpose) {
        Ok(_) => panic!("{sent:?} was let through"),
        Err(failure) => failure,
    }
}

#[test]
fn a_refusal_for_length_names_the_text_and_the_reason() {
    let long = words(MODEL.max_tokens - 1);

    let failure = refusal(&[PASSAGES[0], &long, PASSAGES[1]], Purpose::Passage);

    assert_eq!(failure.text_index, Some(1));
    assert_eq!(failure.reason, Some(RefusalReason::TooLong));
    assert!(
        failure.message.starts_with("text 2 of 3 is "),
        "{}",
        failure.message
    );
}

#[test]
fn a_text_with_nothing_the_model_can_read_is_refused() {
    // Empty, spaces, a zero-width space, a control character, a lone emoji.
    for unreadable in ["", "   ", "\u{200b}", "\u{7}", "\u{1f44d}"] {
        let failure = refusal(&[PASSAGES[0], unreadable], Purpose::Passage);

        assert_eq!(failure.text_index, Some(1), "{unreadable:?}");
        assert_eq!(failure.reason, Some(RefusalReason::NothingReadable));
        assert_eq!(
            failure.message,
            "text 2 of 2 has nothing the embedding model can read"
        );
    }
}

#[test]
fn a_query_is_judged_on_its_own_words_not_the_prefix_put_before_it() {
    let failure = refusal(&["\u{1f44d}"], Purpose::Query);

    assert_eq!(failure.reason, Some(RefusalReason::NothingReadable));
}

#[test]
fn a_long_stretch_read_as_one_unknown_word_is_refused_with_its_length() {
    // A run of a script the model has no pieces for, inside readable words.
    let run = "\u{1780}".repeat(MAX_UNREADABLE_CHARS + 1);
    let text = format!("Larkspur Payroll pays {run} on Fridays");

    let failure = refusal(&[&text], Purpose::Passage);

    assert_eq!(failure.text_index, Some(0));
    assert_eq!(failure.reason, Some(RefusalReason::UnreadableRun));
    assert!(
        failure
            .message
            .contains(&format!("a run of {} characters", MAX_UNREADABLE_CHARS + 1)),
        "{}",
        failure.message
    );
}

#[test]
fn a_short_unknown_word_among_readable_ones_is_let_through() {
    let run = "\u{1780}".repeat(MAX_UNREADABLE_CHARS);
    let text = format!("Mara Quill \u{1f44d} signed off the {run} run");

    let vectors = embedder().embed(&[text], Purpose::Passage).unwrap();

    assert_eq!(vectors[0].len(), DIMENSIONS);
}
