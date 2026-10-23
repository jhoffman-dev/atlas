import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { readCacheLoad, tauriEmbeddingCache } = await import('./tauri-embedding-cache.ts');
const { browserIdle } = await import('./browser-idle.ts');

/** Bytes as `embedding_cache_load` writes them: header length, JSON header, little-endian f32s. */
function loadBytes(header: unknown, vectors: readonly number[]): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const bytes = new Uint8Array(4 + json.length + vectors.length * 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, json.length, true);
  bytes.set(json, 4);
  vectors.forEach((value, at) => view.setFloat32(4 + json.length + at * 4, value, true));
  return bytes.buffer;
}

const block = (path: string, ordinal: number, embedded: boolean) => ({
  path,
  ordinal,
  digest: `d${ordinal}`,
  anchor: null,
  heading: null,
  embedded,
});

describe('readCacheLoad', () => {
  it('matches each embedded block with its vector, in order, and gives the rest none', () => {
    const header = {
      notes: [{ path: 'a.md', digest: 'n', title: 'A' }],
      blocks: [block('a.md', 0, true), block('a.md', 1, false), block('a.md', 2, true)],
    };
    for (const pad of ['', 'x', 'xy', 'xyz']) {
      // Every header length, so the vectors start at every alignment.
      const loaded = readCacheLoad(loadBytes({ ...header, pad }, [1, 0, 0.5, -0.5]));
      expect(loaded.notes).toEqual(header.notes);
      expect(loaded.blocks.map((each) => each.vector && Array.from(each.vector))).toEqual([
        [1, 0],
        null,
        [0.5, -0.5],
      ]);
      expect(loaded.blocks[0]).toMatchObject({ path: 'a.md', ordinal: 0, digest: 'd0' });
      expect('embedded' in (loaded.blocks[0] as object)).toBe(false);
    }
  });

  it('reads an empty cache', () => {
    expect(readCacheLoad(loadBytes({ notes: [], blocks: [] }, []))).toEqual({
      notes: [],
      blocks: [],
    });
  });

  it('refuses numbers that cannot be cut evenly among the embedded blocks', () => {
    const header = { notes: [], blocks: [block('a.md', 0, true), block('a.md', 1, true)] };
    expect(() => readCacheLoad(loadBytes(header, [1, 2, 3]))).toThrow('cannot be 2 vectors');
    expect(() => readCacheLoad(loadBytes({ notes: [], blocks: [] }, [1]))).toThrow(
      'cannot be 0 vectors',
    );
  });
});

describe('tauriEmbeddingCache', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('opens the cache for a generation and says whether it is fresh', async () => {
    invoke.mockResolvedValue({ fresh: true });
    await expect(tauriEmbeddingCache.open({ generation: 'chunks-1' })).resolves.toEqual({
      fresh: true,
    });
    expect(invoke).toHaveBeenCalledWith('embedding_cache_open', { generation: 'chunks-1' });
  });

  it('sends vectors as plain numbers, and a block without one as null, naming the vault', async () => {
    invoke.mockResolvedValue(null);
    await tauriEmbeddingCache.put(
      [
        {
          path: 'a.md',
          digest: 'n',
          title: 'A',
          blocks: [
            {
              ordinal: 0,
              digest: 'd',
              anchor: 'k3',
              heading: 'H',
              excerpt: 'e',
              vector: Float32Array.from([0.5]),
            },
            { ordinal: 1, digest: 'e', anchor: null, heading: null, excerpt: '', vector: null },
          ],
        },
      ],
      { vault: '/Vault' },
    );
    expect(invoke).toHaveBeenCalledWith('embedding_cache_put', {
      vault: '/Vault',
      notes: [
        {
          path: 'a.md',
          digest: 'n',
          title: 'A',
          blocks: [
            { ordinal: 0, digest: 'd', anchor: 'k3', heading: 'H', excerpt: 'e', vector: [0.5] },
            { ordinal: 1, digest: 'e', anchor: null, heading: null, excerpt: '', vector: null },
          ],
        },
      ],
    });
  });

  it('asks for excerpts by block, removes by path, and clears', async () => {
    invoke.mockResolvedValue(['one']);
    await expect(tauriEmbeddingCache.excerpts([{ path: 'a.md', ordinal: 2, digest: 'd2' }])).resolves.toEqual([
      'one',
    ]);
    expect(invoke).toHaveBeenLastCalledWith('embedding_cache_excerpts', {
      keys: [{ path: 'a.md', ordinal: 2 }],
    });
    invoke.mockResolvedValue(null);
    await tauriEmbeddingCache.remove(['a.md'], { vault: '/Vault' });
    expect(invoke).toHaveBeenLastCalledWith('embedding_cache_remove', {
      vault: '/Vault',
      paths: ['a.md'],
    });
    await tauriEmbeddingCache.clear();
    expect(invoke).toHaveBeenLastCalledWith('embedding_cache_clear');
  });

  it('loads through the bytes the host sends', async () => {
    invoke.mockResolvedValue(loadBytes({ notes: [], blocks: [block('a.md', 0, true)] }, [1]));
    const loaded = await tauriEmbeddingCache.load();
    expect(Array.from(loaded.blocks[0]?.vector ?? [])).toEqual([1]);
    expect(invoke).toHaveBeenCalledWith('embedding_cache_load');
  });

  it('turns the host’s refusal into an Error that says it was the cache', async () => {
    invoke.mockRejectedValue('another vault was opened before this could be cached');
    await expect(tauriEmbeddingCache.remove(['a.md'], { vault: '/Other' })).rejects.toThrow(
      'The embeddings cache: another vault was opened before this could be cached',
    );
  });
});

describe('browserIdle', () => {
  it('waits for an idle callback where the webview has one', async () => {
    let handed: (() => void) | null = null;
    const idle = browserIdle({
      requestIdleCallback: (callback, options) => {
        expect(options.timeout).toBe(500);
        handed = callback;
        return 1;
      },
    });
    let done = false;
    const waiting = idle.idle().then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    (handed as unknown as () => void)();
    await waiting;
    expect(done).toBe(true);
  });

  it('takes its turn just after a frame where there is none, and after a while if no frame comes', async () => {
    vi.useFakeTimers();
    try {
      let frame: (() => void) | null = null;
      const framed = browserIdle({
        requestAnimationFrame: (callback) => {
          frame = callback;
          return 1;
        },
      });
      let done = false;
      const waiting = framed.idle().then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(100);
      expect(done).toBe(false);
      (frame as unknown as () => void)();
      await vi.advanceTimersByTimeAsync(0);
      await waiting;
      expect(done).toBe(true);

      let late = false;
      const never = browserIdle({ requestAnimationFrame: () => 1 });
      const lateWait = never.idle().then(() => {
        late = true;
      });
      await vi.advanceTimersByTimeAsync(499);
      expect(late).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await lateWait;
      expect(late).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
