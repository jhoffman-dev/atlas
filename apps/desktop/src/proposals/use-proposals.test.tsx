// @vitest-environment jsdom
/**
 * The Inbox's Proposals section as the app drives it, over a vault in memory and the
 * real markdown adapter: what is listed, what an answer writes and moves, and
 * what the page is told afterwards.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createVaultPath, type VaultPath } from '@atlas/domain';
import { recordingActivity, type ProposalPorts } from '@atlas/application';
import { inMemoryProposalVault as vault } from './proposals.test-support.ts';
import { useProposals } from './use-proposals.ts';

const path = (raw: string): VaultPath => createVaultPath(raw);
/** A window whose close is never watched here. */
const noClosing = { beforeClose: async () => () => {} };
const PROPOSAL = 'Inbox/Proposals/Send the file.md';
/** A task an accepted proposal makes lands in its type's home folder for the day it was answered (#214). */
const TASK = 'Tasks/2026/10/Send Mara the payroll file.md';

const PROPOSAL_TEXT = `---
type: proposal
kind: task
source: "[[2026-10-01 Standup#^t0003]]"
payload:
  title: Send Mara the payroll file
  properties:
    meeting: "[[2026-10-01 Standup]]"
---
`;

/** A task waiting on a person whose note is not in the vault: Accept refuses it. */
const GONE_TEXT = PROPOSAL_TEXT.replace(
  '    meeting: "[[2026-10-01 Standup]]"\n',
  '    meeting: "[[2026-10-01 Standup]]"\n    status: waiting\n    waiting_on: "[[Tobias Fenn]]"\n',
);

function render(
  notes: Record<string, string> = { [PROPOSAL]: PROPOSAL_TEXT },
  failCreate: string | null = null,
) {
  const setup = vault(notes);
  const ports: ProposalPorts =
    failCreate === null
      ? setup.ports
      : {
          ...setup.ports,
          fs: {
            ...setup.ports.fs,
            createNote: async () => {
              throw new Error(failCreate);
            },
          },
        };
  return drive(setup, ports);
}

/** The hook over `ports`, as the Inbox page drives it. */
function drive(setup: ReturnType<typeof vault>, ports: ProposalPorts) {
  const onSettled = vi.fn();
  const activity = recordingActivity();
  const hook = renderHook(
    ({ indexKey }: { indexKey: string }) =>
      useProposals({
        ports,
        clock: { today: () => '2026-10-08' },
        indexKey,
        onSettled,
        activity,
        closing: noClosing,
      }),
    { initialProps: { indexKey: 'v1' } },
  );
  return { ...setup, hook, onSettled, activity };
}

describe('useProposals', () => {
  it('lists the open proposals and counts them for the sidebar', async () => {
    const { hook } = render();
    await waitFor(() => expect(hook.result.current.count).toBe(1));
    expect(hook.result.current.section.contents?.open[0]?.path).toBe(PROPOSAL);
  });

  it('accepts one: the task is made, the proposal archived, and the page offers to open it', async () => {
    const { hook, files, onSettled } = render();
    await waitFor(() => expect(hook.result.current.count).toBe(1));

    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));
    expect(hook.result.current.count).toBe(0);
    await waitFor(() => expect(hook.result.current.section.notice).not.toBeNull());

    expect(files.get(TASK)?.text).toContain('source: "[[2026-10-01 Standup#^t0003]]"');
    expect(files.get(`Archive/${PROPOSAL}`)?.text).toContain('state: accepted');
    expect(hook.result.current.section.notice).toEqual({
      text: 'Accepted: Send Mara the payroll file.',
      opens: { path: TASK, title: 'Send Mara the payroll file' },
      undoable: true,
      failed: false,
    });
    expect(onSettled).toHaveBeenCalled();
  });

  it('undoes the accept: the task goes and the proposal is back, open', async () => {
    const { hook, files } = render();
    await waitFor(() => expect(hook.result.current.count).toBe(1));
    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));
    await waitFor(() => expect(hook.result.current.section.notice?.undoable).toBe(true));

    act(() => hook.result.current.section.onUndo());
    await waitFor(() => expect(hook.result.current.count).toBe(1));

    expect(files.has(TASK)).toBe(false);
    expect(files.get(PROPOSAL)?.text).toContain('state: open');
    expect(hook.result.current.section.notice).toMatchObject({
      text: 'Undone: Send Mara the payroll file is back in the Inbox.',
      undoable: false,
    });
  });

  it('lets go of a chosen proposal once Accept answers it alone, so Undo brings it back unticked', async () => {
    const { hook } = render();
    await waitFor(() => expect(hook.result.current.count).toBe(1));
    act(() => hook.result.current.section.selection.onToggle(PROPOSAL));

    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));
    await waitFor(() => expect(hook.result.current.section.notice?.undoable).toBe(true));
    act(() => hook.result.current.section.onUndo());
    await waitFor(() => expect(hook.result.current.count).toBe(1));

    expect(hook.result.current.section.selection.selected.size).toBe(0);
  });

  it('lets go of a chosen proposal once Reject answers it alone', async () => {
    const { hook, files } = render();
    await waitFor(() => expect(hook.result.current.count).toBe(1));
    act(() => hook.result.current.section.selection.onToggle(PROPOSAL));

    act(() => hook.result.current.section.onReject(path(PROPOSAL)));
    await waitFor(() => expect(hook.result.current.section.notice).not.toBeNull());
    // Put back by hand — out of the Archive, open again — it comes back unticked.
    files.delete(`Archive/${PROPOSAL}`);
    files.set(PROPOSAL, { text: PROPOSAL_TEXT, modified: 99 });
    hook.rerender({ indexKey: 'v2' });
    await waitFor(() => expect(hook.result.current.count).toBe(1));

    expect(hook.result.current.section.selection.selected.size).toBe(0);
  });

  it('keeps a proposal chosen when Accept could not answer it', async () => {
    const { hook } = render({ [PROPOSAL]: GONE_TEXT });
    await waitFor(() => expect(hook.result.current.count).toBe(1));
    act(() => hook.result.current.section.selection.onToggle(PROPOSAL));

    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));
    await waitFor(() => expect(hook.result.current.section.problems.size).toBe(1));

    expect([...hook.result.current.section.selection.selected]).toEqual([PROPOSAL]);
  });

  it('says on the proposal why an accept was refused, and writes nothing', async () => {
    const { hook, files } = render({ [PROPOSAL]: GONE_TEXT });
    await waitFor(() => expect(hook.result.current.count).toBe(1));

    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));
    await waitFor(() => expect(hook.result.current.section.problems.size).toBe(1));

    expect(hook.result.current.section.problems.get(path(PROPOSAL))).toMatch(
      /which is not a note any more/,
    );
    expect(hook.result.current.section.busy).toBeNull();
    expect(files.has(TASK)).toBe(false);
  });

  it('records a refused accept nowhere, and an accept it gave up on once', async () => {
    const refused = render({ [PROPOSAL]: GONE_TEXT });
    await waitFor(() => expect(refused.hook.result.current.count).toBe(1));
    act(() => refused.hook.result.current.section.onAccept(path(PROPOSAL)));
    await waitFor(() => expect(refused.hook.result.current.section.problems.size).toBe(1));
    expect(refused.activity.reports).toEqual([]);

    const failed = render({ [PROPOSAL]: PROPOSAL_TEXT }, 'The disk is full.');
    await waitFor(() => expect(failed.hook.result.current.count).toBe(1));
    act(() => failed.hook.result.current.section.onAccept(path(PROPOSAL)));
    await waitFor(() => expect(failed.hook.result.current.section.problems.size).toBe(1));
    expect(failed.activity.reports).toEqual([
      expect.objectContaining({
        level: 'error',
        kind: 'save',
        subject: { kind: 'note', path: PROPOSAL },
      }),
    ]);
    expect(failed.activity.reports[0]?.message).toMatch(/^Could not answer the proposal/);
  });

  it('rejects one, archiving it, with nothing to undo', async () => {
    const { hook, files } = render();
    await waitFor(() => expect(hook.result.current.count).toBe(1));

    act(() => hook.result.current.section.onReject(path(PROPOSAL)));
    expect(hook.result.current.count).toBe(0);
    await waitFor(() => expect(hook.result.current.section.notice).not.toBeNull());

    expect(files.get(`Archive/${PROPOSAL}`)?.text).toContain('state: rejected');
    expect(files.has(TASK)).toBe(false);
    expect(hook.result.current.section.notice).toEqual({
      text: 'Rejected: Send the file.',
      opens: null,
      undoable: false,
      failed: false,
    });
  });

  it('answers one proposal at a time, so a second press does nothing', async () => {
    const { hook, files } = render();
    await waitFor(() => expect(hook.result.current.count).toBe(1));

    act(() => {
      hook.result.current.section.onAccept(path(PROPOSAL));
      hook.result.current.section.onReject(path(PROPOSAL));
    });
    await waitFor(() => expect(hook.result.current.count).toBe(0));

    expect(files.get(`Archive/${PROPOSAL}`)?.text).toContain('state: accepted');
    expect(hook.result.current.section.problems.size).toBe(0);
  });
});

const SECOND = 'Inbox/Proposals/Call Tobias.md';
const SECOND_TEXT = PROPOSAL_TEXT.replace(
  'title: Send Mara the payroll file',
  'title: Call Tobias Fenn',
);
const SECOND_TASK = 'Tasks/2026/10/Call Tobias Fenn.md';
const THIRD = 'Inbox/Proposals/Book the room.md';

/** A vault whose notes are not made until `release`: an answer caught while it is being written. */
function heldVault(notes: Record<string, string>) {
  const setup = vault(notes);
  let release = () => {};
  const gate = new Promise<void>((open) => (release = open));
  const reads = { count: 0 };
  let readGate: Promise<void> = Promise.resolve();
  /** Holds the next reads of the proposals until the returned function is called. */
  const holdReads = () => {
    let open = () => {};
    readGate = new Promise<void>((resolve) => (open = resolve));
    return open;
  };
  const ports: ProposalPorts = {
    ...setup.ports,
    fs: {
      ...setup.ports.fs,
      createNote: async (note) => {
        await gate;
        return setup.ports.fs.createNote(note);
      },
      readNotes: async (paths) => {
        reads.count += 1;
        const read = await setup.ports.fs.readNotes(paths);
        await readGate;
        return read;
      },
    },
  };
  return { ...drive(setup, ports), release, reads, holdReads };
}

const openTitles = (hook: { result: { current: ReturnType<typeof useProposals> } }) =>
  hook.result.current.section.contents?.open.map((proposal) => proposal.path) ?? null;

describe('useProposals — an answer leaves the list at once (#166)', () => {
  it('takes the answered proposal off the list before its write lands, holding no other', async () => {
    const { hook, files, release } = heldVault({
      [PROPOSAL]: PROPOSAL_TEXT,
      [SECOND]: SECOND_TEXT,
    });
    await waitFor(() => expect(hook.result.current.count).toBe(2));

    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));

    expect(openTitles(hook)).toEqual([SECOND]);
    expect(hook.result.current.count).toBe(1);
    expect(hook.result.current.section.busy).toBeNull();
    expect(files.has(TASK)).toBe(false);
    expect(hook.result.current.section.answering).toBe(true);

    release();
    await waitFor(() => expect(hook.result.current.section.notice?.undoable).toBe(true));
    expect(files.has(TASK)).toBe(true);
    expect(openTitles(hook)).toEqual([SECOND]);
  });

  it('answers the next proposal while the one before is still being written', async () => {
    const { hook, files, release } = heldVault({
      [PROPOSAL]: PROPOSAL_TEXT,
      [SECOND]: SECOND_TEXT,
    });
    await waitFor(() => expect(hook.result.current.count).toBe(2));

    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));
    act(() => hook.result.current.section.onReject(path(SECOND)));
    expect(openTitles(hook)).toEqual([]);

    release();
    await waitFor(() => expect(files.has(`Archive/${SECOND}`)).toBe(true));
    expect(files.get(`Archive/${PROPOSAL}`)?.text).toContain('state: accepted');
    expect(files.get(`Archive/${SECOND}`)?.text).toContain('state: rejected');
    expect(files.has(SECOND_TASK)).toBe(false);
    await waitFor(() => expect(hook.result.current.count).toBe(0));
  });

  it('does not bring an answered proposal back from a read begun before it was answered', async () => {
    const { hook, release, holdReads } = heldVault({
      [PROPOSAL]: PROPOSAL_TEXT,
      [SECOND]: SECOND_TEXT,
    });
    await waitFor(() => expect(hook.result.current.count).toBe(2));
    const letReadIn = holdReads();
    hook.rerender({ indexKey: 'v2' });

    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));
    letReadIn();
    await act(() => new Promise((settle) => setTimeout(settle, 20)));
    expect(openTitles(hook)).toEqual([SECOND]);

    release();
    await waitFor(() => expect(hook.result.current.section.notice?.undoable).toBe(true));
    await act(() => new Promise((settle) => setTimeout(settle, 20)));
    expect(openTitles(hook)).toEqual([SECOND]);
  });

  it('puts the proposal back, saying why, when its write fails', async () => {
    const { hook } = render({ [PROPOSAL]: PROPOSAL_TEXT }, 'The disk is full.');
    await waitFor(() => expect(hook.result.current.count).toBe(1));

    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));
    expect(openTitles(hook)).toEqual([]);

    await waitFor(() => expect(openTitles(hook)).toEqual([PROPOSAL]));
    expect(hook.result.current.section.problems.get(path(PROPOSAL))).toMatch(/The disk is full/);
    expect(hook.result.current.section.notice?.undoable ?? false).toBe(false);
  });

  it('reads the proposals again once the answers are written, not once for each', async () => {
    const { hook, release, reads, onSettled } = heldVault({
      [PROPOSAL]: PROPOSAL_TEXT,
      [SECOND]: SECOND_TEXT,
      [THIRD]: SECOND_TEXT.replace('Call Tobias Fenn', 'Book the room'),
    });
    await waitFor(() => expect(hook.result.current.count).toBe(3));
    const before = reads.count;

    act(() => hook.result.current.section.onReject(path(PROPOSAL)));
    act(() => hook.result.current.section.onReject(path(SECOND)));
    release();
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    await act(() => new Promise((settle) => setTimeout(settle, 20)));

    expect(reads.count - before).toBe(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(openTitles(hook)).toEqual([THIRD]);
  });
});

describe('useProposals — the undo lasts as long as its notice (#165)', () => {
  it('takes nothing back once the notice offering Undo has gone', async () => {
    const { hook, files } = render();
    await waitFor(() => expect(hook.result.current.count).toBe(1));
    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));
    await waitFor(() => expect(hook.result.current.section.notice?.undoable).toBe(true));

    act(() => hook.result.current.section.onDismissNotice());
    expect(hook.result.current.section.notice).toBeNull();

    act(() => hook.result.current.section.onUndo());
    await act(() => new Promise((settle) => setTimeout(settle, 20)));
    expect(files.has(TASK)).toBe(true);
    expect(files.get(`Archive/${PROPOSAL}`)?.text).toContain('state: accepted');
  });
});

describe('useProposals — adversarial: another vault opened after an accept', () => {
  // The hook holds the last accept for its Undo, and the notice offering it,
  // across a change of `ports` — which is what opening another vault is. The
  // page then offers "Undo" in vault B for what was accepted in vault A, and
  // pressing it runs A's paths against B's files.
  it('no longer offers Undo once the ports are another vault’s', async () => {
    const first = vault({ [PROPOSAL]: PROPOSAL_TEXT });
    const second = vault({ 'Elsewhere.md': 'Another vault.\n' });
    const hook = renderHook(
      ({ ports }: { ports: ProposalPorts }) =>
        useProposals({
          ports,
          clock: { today: () => '2026-10-08' },
          indexKey: 'v1',
          onSettled: () => {},
          activity: recordingActivity(),
          closing: noClosing,
        }),
      { initialProps: { ports: first.ports } },
    );
    await waitFor(() => expect(hook.result.current.count).toBe(1));
    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));
    await waitFor(() => expect(hook.result.current.section.notice?.undoable).toBe(true));

    hook.rerender({ ports: second.ports });
    await waitFor(() => expect(hook.result.current.count).toBe(0));

    expect(hook.result.current.section.notice?.undoable ?? false).toBe(false);
  });
});

describe('useProposals — answering several at once (#168)', () => {
  const THREE = {
    [PROPOSAL]: PROPOSAL_TEXT,
    [SECOND]: SECOND_TEXT,
    [THIRD]: SECOND_TEXT.replace('Call Tobias Fenn', 'Book the room'),
  };

  it('accepts each chosen one as Accept does one, and one Undo takes them all back', async () => {
    const { hook, files } = render(THREE);
    await waitFor(() => expect(hook.result.current.count).toBe(3));
    act(() => hook.result.current.section.selection.onToggle(PROPOSAL));
    act(() => hook.result.current.section.selection.onToggle(SECOND));

    act(() => hook.result.current.section.onAcceptMany([path(PROPOSAL), path(SECOND)]));
    expect(openTitles(hook)).toEqual([THIRD]);
    await waitFor(() => expect(hook.result.current.section.notice?.undoable).toBe(true));

    expect(hook.result.current.section.notice?.text).toBe('Accepted 2 proposals.');
    for (const accepted of [PROPOSAL, SECOND]) {
      expect(files.get(`Archive/${accepted}`)?.text).toContain('state: accepted');
      expect(files.get(`Archive/${accepted}`)?.text).toContain('answered_via: app');
    }
    expect(files.has(TASK)).toBe(true);
    expect(files.has(SECOND_TASK)).toBe(true);

    act(() => hook.result.current.section.onUndo());
    await waitFor(() => expect(hook.result.current.section.notice?.undoable).toBe(false));
    expect(hook.result.current.section.notice?.text).toBe(
      'Undone: 2 proposals are back in the Inbox.',
    );
    expect(files.has(TASK)).toBe(false);
    expect(files.has(SECOND_TASK)).toBe(false);
    expect(files.get(PROPOSAL)?.text).toContain('state: open');
    expect(files.get(SECOND)?.text).toContain('state: open');
    await waitFor(() => expect(hook.result.current.count).toBe(3));
    // Answered, they were let go of: back on the list, they are not chosen again.
    expect(hook.result.current.section.selection.selected.size).toBe(0);
  });

  it('says on its card why one was refused, keeps it chosen, and still answers the rest', async () => {
    const { hook, files } = render({ ...THREE, [PROPOSAL]: GONE_TEXT });
    await waitFor(() => expect(hook.result.current.count).toBe(3));
    act(() => hook.result.current.section.selection.onToggle(PROPOSAL));
    act(() => hook.result.current.section.selection.onToggle(SECOND));

    act(() => hook.result.current.section.onAcceptMany([path(PROPOSAL), path(SECOND)]));
    await waitFor(() => expect(hook.result.current.section.notice).not.toBeNull());

    expect(hook.result.current.section.notice).toEqual({
      text: 'Accepted 1 proposal. 1 was not: its card says why.',
      opens: null,
      undoable: true,
      failed: false,
    });
    expect(hook.result.current.section.problems.get(path(PROPOSAL))).toMatch(
      /which is not a note any more/,
    );
    expect(files.has(SECOND_TASK)).toBe(true);
    await waitFor(() => expect(openTitles(hook)).toEqual([PROPOSAL, THIRD].sort()));
    expect([...hook.result.current.section.selection.selected]).toEqual([PROPOSAL]);
  });

  it('keeps what was chosen while the batch was written, with the ones it could not answer (review)', async () => {
    const setup = holdingOne({ ...THREE, [PROPOSAL]: GONE_TEXT }, SECOND_TASK);
    const { hook } = drive(setup, setup.ports);
    await waitFor(() => expect(hook.result.current.count).toBe(3));
    act(() => hook.result.current.section.selection.onToggle(PROPOSAL));
    act(() => hook.result.current.section.selection.onToggle(SECOND));
    act(() => hook.result.current.section.onAcceptMany([path(PROPOSAL), path(SECOND)]));

    act(() => hook.result.current.section.selection.onToggle(THIRD));
    setup.release();
    await waitFor(() => expect(hook.result.current.section.notice).not.toBeNull());
    await waitFor(() => expect(hook.result.current.count).toBe(2));

    expect([...hook.result.current.section.selection.selected].sort()).toEqual(
      [PROPOSAL, THIRD].sort(),
    );
  });

  it('chooses again the ones it could not answer, though the choice was cleared meanwhile (review)', async () => {
    const setup = holdingOne({ ...THREE, [PROPOSAL]: GONE_TEXT }, SECOND_TASK);
    const { hook } = drive(setup, setup.ports);
    await waitFor(() => expect(hook.result.current.count).toBe(3));
    act(() => hook.result.current.section.selection.onToggle(PROPOSAL));
    act(() => hook.result.current.section.selection.onToggle(SECOND));
    act(() => hook.result.current.section.onAcceptMany([path(PROPOSAL), path(SECOND)]));

    act(() => hook.result.current.section.onClearSelection());
    setup.release();
    await waitFor(() => expect(hook.result.current.count).toBe(2));
    expect([...hook.result.current.section.selection.selected]).toEqual([PROPOSAL]);
  });

  it('rejects each chosen one, archiving it, with nothing to undo', async () => {
    const { hook, files } = render(THREE);
    await waitFor(() => expect(hook.result.current.count).toBe(3));

    act(() => hook.result.current.section.onRejectMany([path(PROPOSAL), path(THIRD)]));
    await waitFor(() => expect(hook.result.current.section.notice).not.toBeNull());

    expect(hook.result.current.section.notice).toEqual({
      text: 'Rejected 2 proposals.',
      opens: null,
      undoable: false,
      failed: false,
    });
    expect(files.get(`Archive/${PROPOSAL}`)?.text).toContain('state: rejected');
    expect(files.get(`Archive/${THIRD}`)?.text).toContain('state: rejected');
    expect(openTitles(hook)).toEqual([SECOND]);
  });

  it('answers once a proposal chosen twice, or already being answered', async () => {
    const { hook, files } = render(THREE);
    await waitFor(() => expect(hook.result.current.count).toBe(3));

    act(() => {
      hook.result.current.section.onAccept(path(PROPOSAL));
      hook.result.current.section.onRejectMany([path(PROPOSAL), path(SECOND)]);
    });
    await waitFor(() => expect(files.has(`Archive/${SECOND}`)).toBe(true));
    await act(() => new Promise((settle) => setTimeout(settle, 20)));

    expect(files.get(`Archive/${PROPOSAL}`)?.text).toContain('state: accepted');
    expect(files.get(`Archive/${SECOND}`)?.text).toContain('state: rejected');
    expect(hook.result.current.section.problems.size).toBe(0);
  });
});

describe('useProposals — adversarial: a queued answer fails after another vault opened', () => {
  // `withGiveUpRecorded` asks `activity.inOpenVault()` when the write begins.
  // Queued (#166), a write begins only once the ones before it are written, so
  // one asked for in vault A that begins after vault B opened is recorded in B's log.
  it('records the give-up in the Activity log of the vault it was answered in', async () => {
    const first = vault({ [PROPOSAL]: PROPOSAL_TEXT, [SECOND]: SECOND_TEXT });
    const second = vault({ 'Elsewhere.md': 'Another vault.\n' });
    let release = () => {};
    const gate = new Promise<void>((open) => (release = open));
    const firstPorts: ProposalPorts = {
      ...first.ports,
      fs: {
        ...first.ports.fs,
        createNote: async (note) => {
          if (note.path === SECOND_TASK) throw new Error('The disk is full.');
          await gate;
          return first.ports.fs.createNote(note);
        },
      },
    };
    let open = 'vault A';
    const logged: { vault: string; message: string }[] = [];
    const activity = {
      inOpenVault: () => {
        const vaultOpen = open;
        return {
          record: (report: { message: string }) =>
            void logged.push({ vault: vaultOpen, message: report.message }),
        };
      },
    } as unknown as Parameters<typeof useProposals>[0]['activity'];
    const hook = renderHook(
      ({ ports }: { ports: ProposalPorts }) =>
        useProposals({
          ports,
          clock: { today: () => '2026-10-08' },
          indexKey: 'v1',
          onSettled: () => {},
          activity,
          closing: noClosing,
        }),
      { initialProps: { ports: firstPorts } },
    );
    await waitFor(() => expect(hook.result.current.count).toBe(2));

    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));
    act(() => hook.result.current.section.onAccept(path(SECOND)));
    open = 'vault B';
    hook.rerender({ ports: second.ports });
    release();

    await waitFor(() => expect(logged).toHaveLength(1));
    expect(logged[0]?.vault).toBe('vault A');
    expect(logged[0]?.message).toContain('The disk is full.');
  });
});

/** A vault whose note at `held` is not made until `release`; every other is made at once. */
function holdingOne(notes: Record<string, string>, held: string) {
  const setup = vault(notes);
  let release = () => {};
  const gate = new Promise<void>((open) => (release = open));
  const ports: ProposalPorts = {
    ...setup.ports,
    fs: {
      ...setup.ports.fs,
      createNote: async (note) => {
        if (note.path === held) await gate;
        return setup.ports.fs.createNote(note);
      },
    },
  };
  return { ...setup, ports, release };
}

/** The hook over one vault's ports and then another's, as opening another vault does. */
function switching(ports: ProposalPorts) {
  return renderHook(
    ({ ports: open }: { ports: ProposalPorts }) =>
      useProposals({
        ports: open,
        clock: { today: () => '2026-10-08' },
        indexKey: 'v1',
        onSettled: () => {},
        activity: recordingActivity(),
        closing: noClosing,
      }),
    { initialProps: { ports } },
  );
}

describe('useProposals — another vault opened while answers are written (review)', () => {
  it('lists the new vault at once, never the old one, while the old one’s answers are written', async () => {
    const first = holdingOne({ [PROPOSAL]: PROPOSAL_TEXT, [SECOND]: SECOND_TEXT }, TASK);
    const second = vault({ [THIRD]: SECOND_TEXT.replace('Call Tobias Fenn', 'Book the room') });
    const hook = switching(first.ports);
    await waitFor(() => expect(hook.result.current.count).toBe(2));
    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));

    hook.rerender({ ports: second.ports });
    expect(openTitles(hook)).toBeNull();
    expect(hook.result.current.section.error).toBeNull();
    await waitFor(() => expect(openTitles(hook)).toEqual([THIRD]));
    expect(first.files.has(TASK)).toBe(false);

    first.release();
    await waitFor(() => expect(first.files.has(TASK)).toBe(true));
  });

  it('writes an answer queued in the old vault to the old vault, and nothing to the new one', async () => {
    const first = holdingOne({ [PROPOSAL]: PROPOSAL_TEXT, [SECOND]: SECOND_TEXT }, TASK);
    const second = vault({ 'Elsewhere.md': 'Another vault.\n' });
    const hook = switching(first.ports);
    await waitFor(() => expect(hook.result.current.count).toBe(2));
    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));
    act(() => hook.result.current.section.onReject(path(SECOND)));

    hook.rerender({ ports: second.ports });
    first.release();
    await waitFor(() => expect(first.files.has(`Archive/${SECOND}`)).toBe(true));

    expect(first.files.has(TASK)).toBe(true);
    expect([...second.files.keys()]).toEqual(['Elsewhere.md']);
    expect(hook.result.current.section.notice).toBeNull();
  });
});

describe('useProposals — an Undo queued behind a later answer (review)', () => {
  it('leaves the later accept’s notice and its own Undo up when the earlier undo finishes', async () => {
    const setup = holdingOne({ [PROPOSAL]: PROPOSAL_TEXT, [SECOND]: SECOND_TEXT }, SECOND_TASK);
    const { hook } = drive(setup, setup.ports);
    await waitFor(() => expect(hook.result.current.count).toBe(2));
    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));
    await waitFor(() => expect(hook.result.current.section.notice?.undoable).toBe(true));

    act(() => hook.result.current.section.onAccept(path(SECOND)));
    act(() => hook.result.current.section.onUndo());
    setup.release();
    await waitFor(() => expect(setup.files.has(TASK)).toBe(false));
    await act(() => new Promise((settle) => setTimeout(settle, 20)));

    expect(hook.result.current.section.notice).toMatchObject({
      text: 'Accepted: Call Tobias Fenn.',
      undoable: true,
    });
    act(() => hook.result.current.section.onUndo());
    await waitFor(() => expect(setup.files.has(SECOND_TASK)).toBe(false));
    expect(setup.files.get(SECOND)?.text).toContain('state: open');
  });

  it('says an undo that failed, and keeps it up until dismissed', async () => {
    const setup = vault({ [PROPOSAL]: PROPOSAL_TEXT });
    const ports: ProposalPorts = {
      ...setup.ports,
      fs: {
        ...setup.ports.fs,
        trashEntry: async () => {
          throw new Error('The Trash is locked.');
        },
      },
    };
    const { hook } = drive(setup, ports);
    await waitFor(() => expect(hook.result.current.count).toBe(1));
    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));
    await waitFor(() => expect(hook.result.current.section.notice?.undoable).toBe(true));
    expect(hook.result.current.section.notice?.failed).toBe(false);

    act(() => hook.result.current.section.onUndo());
    await waitFor(() => expect(hook.result.current.section.notice?.undoable).toBe(false));
    expect(hook.result.current.section.notice?.failed).toBe(true);
  });
});

describe('useProposals — closing the window (review)', () => {
  it('holds the close until the answers queued are written', async () => {
    const setup = holdingOne({ [PROPOSAL]: PROPOSAL_TEXT }, TASK);
    const tasks: (() => Promise<void>)[] = [];
    const closing = {
      beforeClose: async (task: () => Promise<void>) => {
        tasks.push(task);
        return () => {};
      },
    };
    const hook = renderHook(() =>
      useProposals({
        ports: setup.ports,
        clock: { today: () => '2026-10-08' },
        indexKey: 'v1',
        onSettled: () => {},
        activity: recordingActivity(),
        closing,
      }),
    );
    await waitFor(() => expect(hook.result.current.count).toBe(1));
    await waitFor(() => expect(tasks).toHaveLength(1));
    act(() => hook.result.current.section.onAccept(path(PROPOSAL)));

    let closed = false;
    const close = tasks[0]?.().then(() => (closed = true));
    await new Promise((settle) => setTimeout(settle, 20));
    expect(closed).toBe(false);

    setup.release();
    await close;
    expect(setup.files.has(TASK)).toBe(true);
    expect(setup.files.get(`Archive/${PROPOSAL}`)?.text).toContain('state: accepted');
  });
});
