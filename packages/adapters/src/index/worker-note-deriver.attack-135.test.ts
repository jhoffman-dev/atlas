import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import {
  createIndexSyncer,
  createNoteChanges,
  fakeIndexPort,
  fakeVaultFs,
  recordingActivity,
} from '@atlas/application';
import { remarkMarkdown } from '../markdown/markdown-port.ts';
import {
  serveNoteDerivation,
  workerNoteDeriver,
  type DerivationAnswer,
  type DerivationRequest,
  type DerivationWorker,
} from './worker-note-deriver.ts';

type Heard = Parameters<DerivationWorker['listen']>[0];

/** The worker's side in this process: messages copied as `postMessage` copies them, a task later. */
function answeringWorker() {
  let heard: Heard | null = null;
  const serve = serveNoteDerivation({
    markdown: remarkMarkdown,
    answer: (answer: DerivationAnswer) => {
      const copy = structuredClone(answer);
      setTimeout(() => heard?.onAnswer(copy));
    },
  });
  const worker: DerivationWorker = {
    post: (request) => {
      const copy = structuredClone(request);
      setTimeout(() => serve(copy));
    },
    listen: (listener) => {
      heard = listener;
    },
  };
  return worker;
}

/**
 * A worker that takes every request and never answers, and never says it has
 * died: one whose thread is stuck reading a note (a reader that does not
 * come back from some input), which raises no `error` event.
 */
function stuckWorker() {
  const requests: DerivationRequest[] = [];
  const worker: DerivationWorker = {
    post: (request) => void requests.push(request),
    listen: () => {},
  };
  return { worker, requests };
}

describe('a worker that stops answering (attack on #135)', () => {
  afterEach(() => vi.useRealTimers());

  const VAULTS = { larkspur: '/vaults/Larkspur', quill: '/vaults/Quill' };

  it('does not keep the next vault from being indexed, once the first is switched away from', async () => {
    vi.useFakeTimers();
    const stuck = stuckWorker();
    const spawn = vi.fn<() => DerivationWorker>();
    spawn.mockReturnValueOnce(stuck.worker).mockImplementation(answeringWorker);
    let open: string = VAULTS.larkspur;
    const put = vi.fn(async () => {});
    const syncer = createIndexSyncer({
      fs: fakeVaultFs({
        listNotes: async () => [
          { name: 'Idea.md', path: createVaultPath('Idea.md'), modified: 1, size: 8 },
        ],
        readNotes: async (paths) =>
          paths.map((path) => ({ path, text: `a spark in ${open}\n`, modified: 1, size: 8 })),
      }),
      index: fakeIndexPort({ put }),
      markdown: remarkMarkdown,
      deriver: workerNoteDeriver(spawn),
      activity: recordingActivity(),
      changes: createNoteChanges({ onError: () => {} }),
      openVault: () => open,
    });

    // The first vault's build reaches the worker, which never answers.
    void syncer.sync({ vault: VAULTS.larkspur, fromScratch: false }).catch(() => {});
    await vi.waitFor(() =>
      expect(stuck.requests.map((request) => request.kind)).toContain('derive'),
    );

    // The vault is switched. Its build is no longer wanted; the new vault's is.
    open = VAULTS.quill;
    let settled = false;
    void syncer.sync({ vault: VAULTS.quill, fromScratch: false }).then(
      () => (settled = true),
      () => (settled = true),
    );
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    // Ten minutes on, the second vault is still waiting behind a build nobody wants.
    expect(settled).toBe(true);
    expect(put).toHaveBeenCalledTimes(1);
  });
});
