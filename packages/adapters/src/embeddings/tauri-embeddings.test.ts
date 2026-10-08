import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EmbeddingError } from '@atlas/application';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { tauriEmbeddings } = await import('./tauri-embeddings.ts');

describe('tauriEmbeddings', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('asks the host to embed the texts for their purpose', async () => {
    invoke.mockResolvedValue([[1, 0]]);
    await tauriEmbeddings.embed({ texts: ['When is Mara Quill paid?'], purpose: 'query' });
    expect(invoke).toHaveBeenCalledWith('embed', {
      texts: ['When is Mara Quill paid?'],
      purpose: 'query',
    });
  });

  it('hands back each vector, in order, as a Float32Array', async () => {
    invoke.mockResolvedValue([
      [0.6, 0.8],
      [-1, 0],
    ]);
    const vectors = await tauriEmbeddings.embed({
      texts: ['Larkspur Payroll pays on Fridays.', 'Tobias Fenn keeps bees.'],
      purpose: 'passage',
    });
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(vectors[0]!)).toEqual([Math.fround(0.6), Math.fround(0.8)]);
    expect(Array.from(vectors[1]!)).toEqual([-1, 0]);
  });

  it('hands back no vectors for no texts', async () => {
    invoke.mockResolvedValue([]);
    await expect(tauriEmbeddings.embed({ texts: [], purpose: 'passage' })).resolves.toEqual([]);
  });

  it('turns the refusal of a text too long into an error that names it', async () => {
    invoke.mockRejectedValue('text 2 of 2 is 731 tokens; the embedding model reads at most 512');
    const error = await tauriEmbeddings
      .embed({ texts: ['short', 'long '.repeat(700)], purpose: 'passage' })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(EmbeddingError);
    expect((error as Error).message).toBe(
      'text 2 of 2 is 731 tokens; the embedding model reads at most 512',
    );
  });

  it('turns the refusal of too many texts into an EmbeddingError', async () => {
    invoke.mockRejectedValue('257 texts were sent to embed at once; the most is 256');
    const error = await tauriEmbeddings
      .embed({ texts: Array.from({ length: 257 }, () => 'a'), purpose: 'passage' })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(EmbeddingError);
    expect((error as Error).message).toContain('the most is 256');
  });
});
