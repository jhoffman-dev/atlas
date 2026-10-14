// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createVaultPath } from '@atlas/domain';
import {
  createNoteChanges,
  fakeIndexPort,
  fakeMarkdown,
  fakeVaultFs,
  INDEX_BATCH_SIZE,
  recordingActivity,
} from '@atlas/application';
import { IndexProgressPill, LiveIndexSettings } from './index-progress.tsx';
import { useIndex, type IndexPorts, type IndexStatus } from './use-index.ts';

const VAULT = '/vaults/Larkspur';

/** A vault of this many notes, over an index that holds none of them yet. */
function vaultOf(count: number): IndexPorts {
  const paths = Array.from({ length: count }, (_, n) => `Note ${n}.md`);
  return {
    fs: fakeVaultFs({
      listNotes: async () =>
        paths.map((path) => ({ name: path, path: createVaultPath(path), modified: 1, size: 4 })),
      readNotes: async (wanted) =>
        wanted.map((path) => ({ path, text: 'note', modified: 1, size: 4 })),
    }),
    index: fakeIndexPort({ stats: async () => ({ notes: count, properties: 0, links: 0 }) }),
    markdown: fakeMarkdown(),
  };
}

/** Builds the index of a vault this size, and says what the window was told on the way. */
async function build(count: number) {
  const statuses: IndexStatus[] = [];
  const ticks: number[] = [];
  let renders = 0;
  const activity = recordingActivity();
  const changes = createNoteChanges({ onError: () => {} });
  const ports = vaultOf(count);
  const { result } = renderHook(() => {
    renders += 1;
    const index = useIndex({ ports, vaultKey: VAULT, activity, changes });
    if (statuses.at(-1) !== index.status) statuses.push(index.status);
    return index;
  });
  result.current.progress.subscribe(() => ticks.push(result.current.progress.current().done));
  await waitFor(() => expect(result.current.status.kind).toBe('ready'));
  return { statuses, ticks, renders, index: result.current };
}

describe('useIndex while a vault is being indexed (#135)', () => {
  it('tells the window that it is working once, however many batches the build takes', async () => {
    const small = await build(INDEX_BATCH_SIZE);
    const large = await build(INDEX_BATCH_SIZE * 8);

    // Everything that re-reads when the index moves hangs off `status`: a
    // status per batch would run every one of those reads per batch.
    expect(large.statuses.map((status) => status.kind)).toEqual(['idle', 'working', 'ready']);
    expect(large.renders).toBe(small.renders);
  });

  it('says how far it has got to whoever asks, batch by batch', async () => {
    const { ticks, index } = await build(INDEX_BATCH_SIZE * 3);

    expect(ticks.filter((done) => done > 0)).toEqual([
      INDEX_BATCH_SIZE,
      INDEX_BATCH_SIZE * 2,
      INDEX_BATCH_SIZE * 3,
    ]);
    expect(index.progress.current()).toEqual({
      done: INDEX_BATCH_SIZE * 3,
      total: INDEX_BATCH_SIZE * 3,
    });
  });

  it('counts each finished build as a move of the index', async () => {
    const { index } = await build(3);
    expect(index.status).toEqual({ kind: 'ready', notes: 3, revision: 1 });
  });
});

describe('useIndex: whether a refresh caught up (ADR-0034)', () => {
  it('says true once the index holds the files, and false when it could not read them', async () => {
    const activity = recordingActivity();
    const changes = createNoteChanges({ onError: () => {} });
    const ports = vaultOf(2);
    const { result } = renderHook(() => useIndex({ ports, vaultKey: VAULT, activity, changes }));
    await waitFor(() => expect(result.current.status.kind).toBe('ready'));
    let caughtUp: boolean | null = null;
    await act(async () => {
      caughtUp = await result.current.refresh();
    });
    expect(caughtUp).toBe(true);

    ports.fs.listNotes = async () => {
      throw new Error('the disk went away');
    };
    await act(async () => {
      caughtUp = await result.current.refresh();
    });
    expect(caughtUp).toBe(false);
    expect(result.current.status.kind).toBe('failed');
  });
});

describe('useIndex, asked to refresh while a build is running (#135)', () => {
  it('keeps saying how far the build has got', async () => {
    const ports = vaultOf(INDEX_BATCH_SIZE * 2);
    let letSecondBatchIn = () => {};
    const held = new Promise<void>((resolve) => (letSecondBatchIn = resolve));
    let puts = 0;
    ports.index = { ...ports.index, put: async () => void (++puts === 2 && (await held)) };
    const activity = recordingActivity();
    const changes = createNoteChanges({ onError: () => {} });
    const { result } = renderHook(() => useIndex({ ports, vaultKey: VAULT, activity, changes }));
    const halfway = { done: INDEX_BATCH_SIZE, total: INDEX_BATCH_SIZE * 2 };
    await waitFor(() => expect(result.current.progress.current()).toEqual(halfway));

    // What a save does, through the watcher, while the build is still going.
    let refreshed: Promise<unknown> = Promise.resolve();
    act(() => {
      refreshed = result.current.refresh();
    });

    expect(result.current.progress.current()).toEqual(halfway);
    expect(result.current.status.kind).toBe('working');
    letSecondBatchIn();
    await act(() => refreshed);
    expect(result.current.status).toMatchObject({ kind: 'ready', revision: 2 });
  });
});

describe('IndexProgressPill', () => {
  const progress = (done: number, total: number) => {
    const reached = { done, total };
    return { subscribe: () => () => {}, current: () => reached };
  };
  const working = { kind: 'working', done: 0, total: 0 } as const;

  it('shows how far a build has got, from the progress rather than the status', () => {
    render(<IndexProgressPill status={working} progress={progress(1240, 5000)} />);
    expect(screen.getByText('Indexing 1,240 of 5,000…')).toBeDefined();
  });

  it('is not said to a screen reader, which hears the start and the end from the status', () => {
    render(<IndexProgressPill status={working} progress={progress(1240, 5000)} />);
    expect(screen.getByText('Indexing 1,240 of 5,000…').getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows nothing for a build of one batch, which is over before it could be read', () => {
    const { container } = render(
      <IndexProgressPill status={working} progress={progress(1, INDEX_BATCH_SIZE)} />,
    );
    expect(container.textContent).toBe('');
  });

  it('shows nothing once the build is done', () => {
    const { container } = render(
      <IndexProgressPill
        status={{ kind: 'ready', notes: 5000, revision: 1 }}
        progress={progress(5000, 5000)}
      />,
    );
    expect(container.textContent).toBe('');
  });
});

describe('LiveIndexSettings', () => {
  it('says how far a build has got, and will not start another meanwhile', () => {
    const reached = { done: 1240, total: 5000 };
    render(
      <LiveIndexSettings
        index={{ kind: 'working', done: 0, total: 0 }}
        progress={{ subscribe: () => () => {}, current: () => reached }}
        app={{ kind: 'loading' }}
        onRebuild={() => {}}
      />,
    );
    expect(screen.getByText('Indexing 1,240 of 5,000…')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Rebuild' }).hasAttribute('disabled')).toBe(true);
  });
});
