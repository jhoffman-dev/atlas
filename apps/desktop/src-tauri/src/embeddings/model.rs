//! One loaded embedding model: its tokenizer, its weights, and how a text's
//! token vectors become one vector. Everything here is the model's own
//! contract — the pooling it was trained with, the prefix it expects on a
//! query, the longest text it can read, what it cannot read at all — not a
//! choice about the vault.

use std::fs;
use std::path::Path;

use candle_core::{DType, Device, Tensor, D};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config};
use tokenizers::{Encoding, Tokenizer};

use super::refusal::{EmbedFailure, RefusalReason};

/// How many tokens go through the model at once, padding included. A pass is
/// padded to its longest text and attention grows with the square of that
/// length, so this bounds memory however many texts a caller sends. Measured
/// in the spike (ADR-0031): 256 was as fast per block as 512, 1024 or 8192
/// and peaked lowest, at about 350 MB against 2.5 GB for 8192.
pub(super) const PASS_TOKENS: usize = 256;

/// The longest stretch of a text the model may read as one unknown word
/// before the text is refused. WordPiece turns a word it has no pieces for —
/// a run of an unspaced script it lacks, or any word over 100 characters, such
/// as pasted base64 — into a single `[UNK]`, so the text would be embedded as
/// if that stretch were not there. A lone emoji or rare symbol is shorter than
/// this and harmless; a sentence of such a script is not.
pub const MAX_UNREADABLE_CHARS: usize = 24;

/// How the model's token vectors become one vector per text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pooling {
    /// The first token's vector, as BGE and Arctic Embed were trained.
    Cls,
    /// The average of the real tokens' vectors, as MiniLM was trained.
    Mean,
}

/// What a text is for. Some models are trained to read a question with a
/// prefix in front of it and a passage without one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Purpose {
    Query,
    Passage,
}

/// A file of a model, pinned by its SHA-256 and size.
#[derive(Debug)]
pub struct ModelFile {
    pub name: &'static str,
    pub sha256: &'static str,
    pub bytes: u64,
}

/// A model at one revision of its Hugging Face repository.
#[derive(Debug)]
pub struct ModelSpec {
    /// The folder it is kept in on this Mac.
    pub folder: &'static str,
    pub repository: &'static str,
    /// A commit, never a branch, so the files cannot change under their digests.
    pub revision: &'static str,
    /// `config.json`, `tokenizer.json` and `model.safetensors`.
    pub files: &'static [ModelFile],
    pub pooling: Pooling,
    /// Put in front of a query, as the model's card asks; empty when it asks none.
    pub query_prefix: &'static str,
    /// The most tokens it reads, its own markers included.
    pub max_tokens: usize,
}

/// Texts `Embedder::read` let through, tokenised, ready to run.
pub struct Reading {
    encodings: Vec<Encoding>,
}

pub struct Embedder {
    model: BertModel,
    tokenizer: Tokenizer,
    pad_id: u32,
    unknown_id: u32,
    pooling: Pooling,
    query_prefix: &'static str,
    max_tokens: usize,
    device: Device,
}

fn model_error(error: impl std::fmt::Display) -> String {
    format!("the embedding model failed: {error}")
}

impl Embedder {
    /// Loads the model whose files are in `folder`.
    pub fn load(folder: &Path, spec: &ModelSpec) -> Result<Self, String> {
        let device = Device::Cpu;
        let config = fs::read_to_string(folder.join("config.json"))
            .map_err(|error| format!("cannot read the embedding model's config: {error}"))?;
        let config: Config = serde_json::from_str(&config)
            .map_err(|error| format!("the embedding model's config is not valid: {error}"))?;
        let mut tokenizer = Tokenizer::from_file(folder.join("tokenizer.json"))
            .map_err(|error| format!("cannot read the embedding model's tokenizer: {error}"))?;
        // A tokenizer file can carry its own truncation and padding. Both are
        // off: a long text is refused rather than cut, and passes pad themselves.
        tokenizer
            .with_truncation(None)
            .map_err(model_error)?
            .with_padding(None);
        let pad_id = tokenizer
            .token_to_id("[PAD]")
            .ok_or("the embedding model's tokenizer has no [PAD] token")?;
        let unknown_id = tokenizer
            .token_to_id("[UNK]")
            .ok_or("the embedding model's tokenizer has no [UNK] token")?;
        let weights = fs::read(folder.join("model.safetensors"))
            .map_err(|error| format!("cannot read the embedding model's weights: {error}"))?;
        let weights = VarBuilder::from_buffered_safetensors(weights, DType::F32, &device)
            .map_err(model_error)?;
        let model = BertModel::load(weights, &config).map_err(model_error)?;
        Ok(Self {
            model,
            tokenizer,
            pad_id,
            unknown_id,
            pooling: spec.pooling,
            query_prefix: spec.query_prefix,
            max_tokens: spec.max_tokens,
            device,
        })
    }

    /// How many tokens the model would read for `text`, its markers included.
    pub fn token_count(&self, text: &str, purpose: Purpose) -> Result<usize, String> {
        let encoding = self
            .tokenizer
            .encode(self.prepared(text, purpose), true)
            .map_err(model_error)?;
        Ok(encoding.len())
    }

    /// One vector per text, in order, each of unit length. Refuses the whole
    /// batch, before any work, when a text is one the model cannot read whole.
    pub fn embed(&self, texts: &[String], purpose: Purpose) -> Result<Vec<Vec<f32>>, String> {
        let reading = self
            .read(texts, purpose)
            .map_err(|failure| failure.message)?;
        self.vectors(&reading)
    }

    /// Tokenises the texts and checks the model can read each one whole: not
    /// longer than it reads, not without a word it knows, and with no long
    /// stretch it reads as one unknown word. The first text that fails is
    /// named in the refusal.
    pub fn read(&self, texts: &[String], purpose: Purpose) -> Result<Reading, EmbedFailure> {
        let prepared: Vec<String> = texts
            .iter()
            .map(|text| self.prepared(text, purpose))
            .collect();
        let encodings = self
            .tokenizer
            .encode_batch(prepared.clone(), true)
            .map_err(model_error)?;
        let own_from = match purpose {
            Purpose::Query => self.query_prefix.len(),
            Purpose::Passage => 0,
        };
        let count = encodings.len();
        for (index, (encoding, text)) in encodings.iter().zip(&prepared).enumerate() {
            if let Some((reason, why)) = self.unreadable(encoding, text, own_from) {
                return Err(EmbedFailure::of_text(index, count, reason, &why));
            }
        }
        Ok(Reading { encodings })
    }

    /// The vectors of texts `read` let through, in order.
    pub fn vectors(&self, reading: &Reading) -> Result<Vec<Vec<f32>>, String> {
        let encodings = &reading.encodings;
        let mut vectors = vec![Vec::new(); encodings.len()];
        let lengths: Vec<usize> = encodings.iter().map(Encoding::len).collect();
        for pass in passes(&lengths) {
            let texts: Vec<&Encoding> = pass.iter().map(|&index| &encodings[index]).collect();
            let pooled = self.run(&texts).map_err(model_error)?;
            for (index, vector) in pass.into_iter().zip(pooled) {
                vectors[index] = vector;
            }
        }
        Ok(vectors)
    }

    fn prepared(&self, text: &str, purpose: Purpose) -> String {
        match purpose {
            Purpose::Query => format!("{}{text}", self.query_prefix),
            Purpose::Passage => text.to_string(),
        }
    }

    /// Why the model cannot read `text` whole, if it cannot. Only the text's
    /// own tokens count — those from byte `own_from` on, past a query's
    /// prefix — and never the model's markers.
    fn unreadable(
        &self,
        encoding: &Encoding,
        text: &str,
        own_from: usize,
    ) -> Option<(RefusalReason, String)> {
        if encoding.len() > self.max_tokens {
            let why = format!(
                "is {} tokens; the embedding model reads at most {}",
                encoding.len(),
                self.max_tokens
            );
            return Some((RefusalReason::TooLong, why));
        }
        let own = own_tokens(encoding, own_from);
        if own.iter().all(|&(id, _)| id == self.unknown_id) {
            let why = "has nothing the embedding model can read".to_string();
            return Some((RefusalReason::NothingReadable, why));
        }
        let longest = own
            .iter()
            .filter(|&&(id, _)| id == self.unknown_id)
            .map(|&(_, (start, end))| text.get(start..end).map_or(0, |run| run.chars().count()))
            .max()
            .unwrap_or(0);
        (longest > MAX_UNREADABLE_CHARS).then(|| {
            let why = format!(
                "has a run of {longest} characters the embedding model cannot read; \
                 it lets through at most {MAX_UNREADABLE_CHARS}"
            );
            (RefusalReason::UnreadableRun, why)
        })
    }

    /// One pass through the model: pads the texts to the longest of them,
    /// runs it, pools and normalises.
    fn run(&self, pass: &[&Encoding]) -> candle_core::Result<Vec<Vec<f32>>> {
        let width = pass
            .iter()
            .map(|encoding| encoding.len())
            .max()
            .unwrap_or(0);
        let mut ids = Vec::with_capacity(pass.len() * width);
        let mut mask = Vec::with_capacity(pass.len() * width);
        for encoding in pass {
            let padding = width - encoding.len();
            ids.extend(encoding.get_ids());
            ids.extend(std::iter::repeat(self.pad_id).take(padding));
            mask.extend(std::iter::repeat(1u32).take(encoding.len()));
            mask.extend(std::iter::repeat(0u32).take(padding));
        }
        let shape = (pass.len(), width);
        let ids = Tensor::from_vec(ids, shape, &self.device)?;
        let mask = Tensor::from_vec(mask, shape, &self.device)?;
        let types = ids.zeros_like()?;
        let tokens = self.model.forward(&ids, &types, Some(&mask))?;
        let pooled = match self.pooling {
            Pooling::Cls => tokens.narrow(1, 0, 1)?.squeeze(1)?,
            Pooling::Mean => mean_of_real_tokens(&tokens, &mask)?,
        };
        let length = pooled.sqr()?.sum_keepdim(D::Minus1)?.sqrt()?;
        pooled.broadcast_div(&length)?.to_vec2()
    }
}

/// The indexes of texts of these token lengths, grouped into passes of
/// similar length so little of a pass is padding, each within `PASS_TOKENS`
/// once padded. A text alone is always a pass, however long.
pub(super) fn passes(lengths: &[usize]) -> Vec<Vec<usize>> {
    let mut by_length: Vec<usize> = (0..lengths.len()).collect();
    by_length.sort_by_key(|&index| lengths[index]);
    let mut passes: Vec<Vec<usize>> = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    for index in by_length {
        // Sorted ascending, so this text is the longest the pass would hold.
        let padded = (current.len() + 1) * lengths[index];
        if !current.is_empty() && padded > PASS_TOKENS {
            passes.push(std::mem::take(&mut current));
        }
        current.push(index);
    }
    if !current.is_empty() {
        passes.push(current);
    }
    passes
}

/// A text's own tokens, with where each sits in it: not the model's markers,
/// and none before byte `own_from` (a query's prefix).
fn own_tokens(encoding: &Encoding, own_from: usize) -> Vec<(u32, (usize, usize))> {
    encoding
        .get_ids()
        .iter()
        .zip(encoding.get_offsets())
        .zip(encoding.get_special_tokens_mask())
        .filter(|((_, &(start, _)), &special)| special == 0 && start >= own_from)
        .map(|((&id, &offsets), _)| (id, offsets))
        .collect()
}

/// The average over each text's own tokens, leaving out its padding.
fn mean_of_real_tokens(tokens: &Tensor, mask: &Tensor) -> candle_core::Result<Tensor> {
    let mask = mask.to_dtype(tokens.dtype())?.unsqueeze(2)?;
    let summed = tokens.broadcast_mul(&mask)?.sum(1)?;
    summed.broadcast_div(&mask.sum(1)?)
}
