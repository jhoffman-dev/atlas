//! One loaded embedding model: its tokenizer, its weights, and how a text's
//! token vectors become one vector. Everything here is the model's own
//! contract — the pooling it was trained with, the prefix it expects on a
//! query, the longest text it can read — not a choice about the vault.

use std::fs;
use std::path::Path;

use candle_core::{DType, Device, Tensor, D};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config};
use tokenizers::{Encoding, Tokenizer};

/// How many tokens go through the model at once, padding included. A pass is
/// padded to its longest text and attention grows with the square of that
/// length, so this bounds memory however many texts a caller sends. Measured
/// in the spike (ADR-0031): 256 was as fast per block as 512, 1024 or 8192
/// and peaked lowest, at about 350 MB against 2.5 GB for 8192.
pub(super) const PASS_TOKENS: usize = 256;

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

pub struct Embedder {
    model: BertModel,
    tokenizer: Tokenizer,
    pad_id: u32,
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
        let weights = fs::read(folder.join("model.safetensors"))
            .map_err(|error| format!("cannot read the embedding model's weights: {error}"))?;
        let weights = VarBuilder::from_buffered_safetensors(weights, DType::F32, &device)
            .map_err(model_error)?;
        let model = BertModel::load(weights, &config).map_err(model_error)?;
        Ok(Self {
            model,
            tokenizer,
            pad_id,
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

    /// The most tokens the model reads, its markers included.
    pub fn max_tokens(&self) -> usize {
        self.max_tokens
    }

    /// One vector per text, in order, each of unit length. Refuses the whole
    /// batch, before any work, when a text is longer than the model reads.
    pub fn embed(&self, texts: &[String], purpose: Purpose) -> Result<Vec<Vec<f32>>, String> {
        let prepared: Vec<String> = texts
            .iter()
            .map(|text| self.prepared(text, purpose))
            .collect();
        let encodings = self
            .tokenizer
            .encode_batch(prepared, true)
            .map_err(model_error)?;
        self.check_lengths(&encodings)?;
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

    fn check_lengths(&self, encodings: &[Encoding]) -> Result<(), String> {
        let count = encodings.len();
        match encodings
            .iter()
            .position(|encoding| encoding.len() > self.max_tokens)
        {
            Some(index) => Err(format!(
                "text {} of {count} is {} tokens; the embedding model reads at most {}",
                index + 1,
                encodings[index].len(),
                self.max_tokens
            )),
            None => Ok(()),
        }
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

/// The average over each text's own tokens, leaving out its padding.
fn mean_of_real_tokens(tokens: &Tensor, mask: &Tensor) -> candle_core::Result<Tensor> {
    let mask = mask.to_dtype(tokens.dtype())?.unsqueeze(2)?;
    let summed = tokens.broadcast_mul(&mask)?.sum(1)?;
    summed.broadcast_div(&mask.sum(1)?)
}
