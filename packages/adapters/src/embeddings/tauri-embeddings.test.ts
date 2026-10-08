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

  const refusal = async (): Promise<EmbeddingError> => {
    try {
      await tauriEmbeddings.embed({ texts: ['Mara Quill', 'Tobias Fenn'], purpose: 'passage' });
    } catch (error) {
      return error as EmbeddingError;
    }
    throw new Error('the call was not refused');
  };

  it('names the text the host refused for being too long, and why', async () => {
    invoke.mockRejectedValue({
      message: 'text 2 of 2 is 731 tokens; the embedding model reads at most 512',
      textIndex: 1,
      reason: 'too-long',
    });
    const error = await refusal();
    expect(error).toBeInstanceOf(EmbeddingError);
    expect(error.message).toBe('text 2 of 2 is 731 tokens; the embedding model reads at most 512');
    expect(error.refused).toEqual({ textIndex: 1, reason: 'too-long' });
  });

  it('names a text the model cannot read', async () => {
    invoke.mockRejectedValue({
      message: 'text 1 of 2 has nothing the embedding model can read',
      textIndex: 0,
      reason: 'nothing-readable',
    });
    const error = await refusal();
    expect(error.refused).toEqual({ textIndex: 0, reason: 'nothing-readable' });
  });

  it('names no text when the call as a whole was refused', async () => {
    invoke.mockRejectedValue({
      message: '257 texts were sent to embed at once; the most is 256',
      textIndex: null,
      reason: null,
    });
    const error = await refusal();
    expect(error).toBeInstanceOf(EmbeddingError);
    expect(error.message).toBe('257 texts were sent to embed at once; the most is 256');
    expect(error.refused).toBeUndefined();
  });

  it('turns a bare message from the host into an EmbeddingError', async () => {
    invoke.mockRejectedValue('the embedding model stopped');
    const error = await refusal();
    expect(error).toBeInstanceOf(EmbeddingError);
    expect(error.message).toBe('the embedding model stopped');
  });

  it('passes an Error the bridge itself raised through unchanged', async () => {
    const bridge = new Error('IPC is not available');
    invoke.mockRejectedValue(bridge);
    expect(await refusal()).toBe(bridge);
  });
});
