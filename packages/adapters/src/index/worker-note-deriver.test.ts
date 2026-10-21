import { describe, expect, it, vi } from 'vitest';
import { createVaultPath } from '@dfai/domain';
import { inThreadNoteDeriver, type MarkdownPort, type NoteFile } from '@dfai/application';
import { remarkMarkdown } from '../markdown/markdown-port.ts';
import { ROUND_TRIP_CORPUS } from '../markdown/round-trip-corpus.ts';
import {
  BATCH_DEADLINE_MS,
  BATCH_DEADLINE_MS_PER_KB,
  serveNoteDerivation,
  WORKER_START_DEADLINE_MS,
  workerNoteDeriver,
  type DerivationTimer,
  type DerivationAnswer,
  type DerivationRequest,
  type DerivationWorker,
} from './worker-note-deriver.ts';

type Heard = Parameters<DerivationWorker['listen']>[0];

/**
 * The worker's side run in this process, with what a real one puts between the
 * two: every message is copied as `postMessage` copies it, and arrives in a
 * later task. `crash` is the worker dying, as its `error` event says it.
 */
function inProcessWorker(markdown: MarkdownPort = remarkMarkdown) {
  let heard: Heard | null = null;
  const requests: DerivationRequest[] = [];
  const serve = serveNoteDerivation({
    markdown,
    answer: (answer: DerivationAnswer) => {
      const copy = structuredClone(answer);
      setTimeout(() => heard?.onAnswer(copy));
    },
  });
  const worker: DerivationWorker = {
    post: (request) => {
      const copy = structuredClone(request);
      requests.push(copy);
      setTimeout(() => serve(copy));
    },
    listen: (listener) => {
      heard = listener;
    },
  };
  return { worker, requests, crash: (problem: string) => heard?.onCrash(problem) };
}

const FRONTMATTER = [
  '---',
  'type: task',
  'title: A title of its own',
  'status: next',
  'due: 2026-10-12',
  'project: "[[one paragraph]]"',
  'people: ["[[Mara Quill]]", "[[Tobias Fenn]]"]',
  'tags: [alpha, beta/gamma]',
  '---',
  '',
].join('\n');

/** Every entry of the round-trip corpus as a note, with and without frontmatter. */
function corpusFiles(): NoteFile[] {
  return ROUND_TRIP_CORPUS.flatMap(([label, markdown], position) => [
    { path: `${label}.md`, text: markdown, modified: position, size: markdown.length },
    {
      path: `Typed/${label}.md`,
      text: FRONTMATTER + markdown,
      modified: position,
      size: FRONTMATTER.length + markdown.length,
    },
  ]);
}

const pathsOf = (files: readonly NoteFile[]) => files.map((file) => createVaultPath(file.path));

describe('workerNoteDeriver', () => {
  it('derives the same rows as this thread does, for the whole round-trip corpus', async () => {
    const files = corpusFiles();
    // With the notes the corpus links to, so some links and relations resolve and some do not.
    const paths = [
      ...pathsOf(files),
      ...['People/Mara Quill.md', 'Another Note.md', 'Plans.md'].map(createVaultPath),
    ];
    const { worker } = inProcessWorker();

    const here = await inThreadNoteDeriver(remarkMarkdown).begin(paths).derive(files);
    const there = await workerNoteDeriver(() => worker)
      .begin(paths)
      .derive(files);

    expect(there).toEqual(here);
    expect(there.failed).toEqual([]);
    expect(there.notes).toHaveLength(ROUND_TRIP_CORPUS.length * 2);
    // Not a comparison of two empty answers: every kind of row is among them.
    const rows = there.notes;
    expect(rows.some((note) => note.links.some((link) => link.path !== null))).toBe(true);
    expect(rows.some((note) => note.relations.some((held) => held.path !== null))).toBe(true);
    expect(rows.some((note) => note.tags.length > 0)).toBe(true);
    expect(rows.some((note) => note.blocks.length > 0)).toBe(true);
    expect(rows.some((note) => note.checks.length > 0)).toBe(true);
    expect(rows.some((note) => note.properties.length > 0)).toBe(true);
    expect(rows.every((note) => note.digest !== '')).toBe(true);
  });

  it('resolves every batch of a build against the notes the build began with', async () => {
    const paths = [createVaultPath('Plans/Camping.md'), createVaultPath('Idea.md')];
    const { worker } = inProcessWorker();
    const deriving = workerNoteDeriver(() => worker).begin(paths);
    const idea = { path: 'Idea.md', text: 'See [[Camping]].\n', modified: 1, size: 17 };

    await deriving.derive([]);
    const second = await deriving.derive([idea]);

    expect(second.notes[0]?.links).toEqual([
      { target: 'Camping', leaf: 'camping', path: 'Plans/Camping.md', kind: 'wikilink' },
    ]);
  });

  it('keeps one worker for every build', async () => {
    const { worker } = inProcessWorker();
    const spawn = vi.fn(() => worker);
    const deriver = workerNoteDeriver(spawn);

    const first = deriver.begin([]);
    await first.derive([]);
    first.end();
    await deriver.begin([]).derive([]);

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('starts the worker as a build begins, so it is up before there is a note to read', () => {
    const { worker, requests } = inProcessWorker();
    const spawn = vi.fn(() => worker);

    workerNoteDeriver(spawn).begin([createVaultPath('Idea.md')]);

    // The first refresh after a launch must not wait on the worker's script loading.
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(requests.map((request) => request.kind)).toEqual(['begin']);
  });

  it('spawns no worker until a build begins', () => {
    const spawn = vi.fn(() => inProcessWorker().worker);
    workerNoteDeriver(spawn);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('says which note could not be read, and still answers with the others', async () => {
    const torn: MarkdownPort = {
      ...remarkMarkdown,
      plainText: (body) => {
        if (body.includes('torn')) throw new Error('unexpected end of note');
        return remarkMarkdown.plainText(body);
      },
    };
    const { worker } = inProcessWorker(torn);
    const files = [
      { path: 'Idea.md', text: 'a spark\n', modified: 1, size: 8 },
      { path: 'Torn.md', text: 'torn\n', modified: 1, size: 5 },
    ];

    const derived = await workerNoteDeriver(() => worker)
      .begin(pathsOf(files))
      .derive(files);

    expect(derived.notes.map((note) => note.path)).toEqual(['Idea.md']);
    expect(derived.failed).toEqual([{ path: 'Torn.md', problem: 'unexpected end of note' }]);
  });

  it('fails the batch it was waiting for when the worker dies, and starts another for the next build', async () => {
    const first = inProcessWorker();
    const second = inProcessWorker();
    const spawn = vi.fn<() => DerivationWorker>();
    spawn.mockReturnValueOnce(first.worker).mockReturnValueOnce(second.worker);
    const deriver = workerNoteDeriver(spawn);
    const deriving = deriver.begin([]);
    // The build is under way: the worker came up and has answered a batch.
    await deriving.derive([]);

    const waiting = deriving.derive([]);
    first.crash('out of memory');
    await expect(waiting).rejects.toThrow(
      'The notes could not be read for the index: out of memory',
    );

    const again = await deriver.begin([]).derive([]);
    expect(again).toEqual({ notes: [], failed: [] });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('fails the next batch at once when the worker died between two batches', async () => {
    const { worker, requests, crash } = inProcessWorker();
    const deriving = workerNoteDeriver(() => worker).begin([]);
    await deriving.derive([]);

    crash('out of memory');
    const next = deriving.derive([]);

    // Nothing is posted to a worker that is gone, and nothing waits on it.
    await expect(next).rejects.toThrow(
      'The notes could not be read for the index: the index worker stopped',
    );
    expect(requests.filter((request) => request.kind === 'derive')).toHaveLength(1);
    await expect(deriving.derive([])).rejects.toThrow('the index worker stopped');
  });

  describe('when the worker cannot be used', () => {
    const idea = { path: 'Idea.md', text: 'See [[Camping]].\n', modified: 1, size: 17 };
    const paths = [createVaultPath('Plans/Camping.md'), createVaultPath('Idea.md')];
    const breaths = () => {
      let taken = 0;
      const timer: DerivationTimer = {
        after: () => () => {},
        breathe: async () => void (taken += 1),
      };
      return { timer, taken: () => taken };
    };
    const notAllowed = () => {
      throw new Error('workers are not allowed here');
    };

    // Was "fails a build whose worker cannot be started": a worker that cannot
    // be started now costs the index its speed, not its existence (#138).
    it('reads the notes in the window instead, the same rows, and says why', async () => {
      const deriver = workerNoteDeriver(notAllowed, { timer: breaths().timer });

      const derived = await deriver.begin(paths).derive([idea]);

      const here = await inThreadNoteDeriver(remarkMarkdown).begin(paths).derive([idea]);
      expect(derived).toEqual({ ...here, inWindow: 'Workers are not allowed here.' });
      expect(derived.notes[0]?.links[0]?.path).toBe('Plans/Camping.md');
    });

    it('lets the window breathe after every note it reads there', async () => {
      const { timer, taken } = breaths();
      const deriver = workerNoteDeriver(notAllowed, { timer });
      const files = corpusFiles().slice(0, 7);

      await deriver.begin(pathsOf(files)).derive(files);

      expect(taken()).toBe(7);
    });

    it('stays in the window for later builds, and does not try the worker again', async () => {
      const spawn = vi.fn<() => DerivationWorker>(notAllowed);
      const deriver = workerNoteDeriver(spawn, { timer: breaths().timer });

      await deriver.begin(paths).derive([idea]);
      const later = await deriver.begin(paths).derive([idea]);

      expect(later.inWindow).toBe('Workers are not allowed here.');
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    it('does so for a worker that dies as it loads', async () => {
      const { worker, crash } = inProcessWorker();
      const deriver = workerNoteDeriver(() => worker, { timer: breaths().timer });

      const waiting = deriver.begin(paths).derive([idea]);
      // Before it has said the build began: its script never ran.
      crash('the script could not be loaded');

      const derived = await waiting;
      expect(derived.inWindow).toBe('The script could not be loaded.');
      expect(derived.notes.map((note) => note.path)).toEqual(['Idea.md']);
    });

    it('does so for a worker that died before the first batch was asked of it', async () => {
      const { worker, crash } = inProcessWorker();
      const deriver = workerNoteDeriver(() => worker, { timer: breaths().timer });
      const deriving = deriver.begin(paths);

      crash('the script could not be loaded');

      expect((await deriving.derive([idea])).inWindow).toBe('The script could not be loaded.');
    });

    it('reports a note it cannot read in the window as it would from the worker', async () => {
      const torn: MarkdownPort = {
        ...remarkMarkdown,
        plainText: () => {
          throw new Error('unexpected end of note');
        },
      };
      const deriver = workerNoteDeriver(notAllowed, { markdown: torn, timer: breaths().timer });

      const derived = await deriver.begin(paths).derive([idea]);

      expect(derived.failed).toEqual([{ path: 'Idea.md', problem: 'unexpected end of note' }]);
    });
  });

  describe('against the clock', () => {
    /** Time a test moves by hand: what is waiting, and the firing of whatever is due. */
    function handTimer() {
      const pending = new Set<{ at: number; then: () => void }>();
      let now = 0;
      const timer: DerivationTimer = {
        after(milliseconds, then) {
          const due = { at: now + milliseconds, then };
          pending.add(due);
          return () => void pending.delete(due);
        },
        breathe: async () => {},
      };
      const advance = (milliseconds: number) => {
        now += milliseconds;
        for (const due of [...pending]) {
          if (due.at <= now && pending.delete(due)) due.then();
        }
      };
      return { timer, advance, pending: () => pending.size };
    }

    /**
     * A worker that says a build began and answers only the batches `answers`
     * lets it, counting the batches asked of it and the answers it gave, which
     * a test waits on.
     */
    function selectiveWorker(answers: (files: readonly NoteFile[]) => boolean) {
      const inner = inProcessWorker();
      let stopped = 0;
      let answered = 0;
      let asked = 0;
      const worker: DerivationWorker = {
        post: (request) => {
          if (request.kind === 'derive') asked += 1;
          if (request.kind !== 'derive' || answers(request.files)) inner.worker.post(request);
        },
        listen: (heard) =>
          inner.worker.listen({
            ...heard,
            onAnswer: (answer) => {
              answered += 1;
              heard.onAnswer(answer);
            },
          }),
        stop: () => void (stopped += 1),
      };
      return { worker, stopped: () => stopped, answered: () => answered, asked: () => asked };
    }

    const note = (name: string) => ({
      path: `${name}.md`,
      text: `${name}\n`,
      modified: 1,
      size: 9,
    });
    /**
     * Waits until `worker` has said the build began and answered `batches`.
     * Its messages go by real timers, so a fixed wait is not enough under
     * load: a hand-moved clock past WORKER_START_DEADLINE_MS before "began"
     * arrives would rightly give the worker up as never started.
     */
    const answeredBy = (worker: { answered: () => number }, batches: number) =>
      vi.waitFor(() => expect(worker.answered()).toBe(1 + batches));

    it('gives up on a worker that never says it has started, and reads in the window', async () => {
      const { timer, advance } = handTimer();
      let stopped = 0;
      const silent: DerivationWorker = {
        post: () => {},
        listen: () => {},
        stop: () => void (stopped += 1),
      };
      const deriver = workerNoteDeriver(() => silent, { timer });

      const waiting = deriver.begin([]).derive([note('Idea')]);
      advance(WORKER_START_DEADLINE_MS);

      expect((await waiting).inWindow).toBe('The index worker did not start.');
      expect(stopped).toBe(1);
    });

    it('stops a worker stuck on a batch, and reports the one note that sticks it', async () => {
      const { timer, advance } = handTimer();
      // Anything with Torn.md in it never comes back, alone or in company.
      const unlessTorn = (files: readonly NoteFile[]) =>
        !files.some((file) => file.path === 'Torn.md');
      const [first, second, third] = [
        selectiveWorker(unlessTorn),
        selectiveWorker(unlessTorn),
        selectiveWorker(unlessTorn),
      ];
      const workers = [first, second, third];
      const spawn = vi.fn<() => DerivationWorker>();
      for (const each of workers) spawn.mockReturnValueOnce(each.worker);
      const deriving = workerNoteDeriver(spawn, { timer }).begin([]);

      const waiting = deriving.derive([note('Idea'), note('Torn'), note('Plan')]);
      await answeredBy(first, 0);
      // The batch runs out of time: the worker is stopped, and each note asked on its own.
      advance(BATCH_DEADLINE_MS + BATCH_DEADLINE_MS_PER_KB);
      await answeredBy(second, 1);
      await vi.waitFor(() => expect(second.asked()).toBe(2));
      // Idea came back from the second worker; Torn, alone, runs out again.
      advance(BATCH_DEADLINE_MS + BATCH_DEADLINE_MS_PER_KB);

      const derived = await waiting;
      expect(derived.notes.map((each) => each.path)).toEqual(['Idea.md', 'Plan.md']);
      expect(derived.failed).toEqual([{ path: 'Torn.md', problem: 'it took too long to read' }]);
      // Never read in the window, where it would have stuck that too.
      expect(derived.inWindow).toBeUndefined();
      expect(workers.map((each) => each.stopped())).toEqual([1, 1, 0]);
    });

    it('allows a batch longer the more there is in it', async () => {
      const { timer, advance } = handTimer();
      const selective = selectiveWorker(() => false);
      const { worker, stopped } = selective;
      const deriving = workerNoteDeriver(() => worker, { timer }).begin([]);
      const long = { path: 'Long.md', text: 'long', modified: 1, size: 2_200_000 };
      void deriving.derive([long]).catch(() => {});
      await answeredBy(selective, 0);

      advance(BATCH_DEADLINE_MS + 1_000);
      expect(stopped()).toBe(0);
      advance(BATCH_DEADLINE_MS_PER_KB * 2_200);
      expect(stopped()).toBe(1);
    });

    it('leaves no deadline running once a batch has come back', async () => {
      const { timer, pending } = handTimer();
      const { worker } = inProcessWorker();
      const deriving = workerNoteDeriver(() => worker, { timer }).begin([]);

      await deriving.derive([note('Idea')]);

      expect(pending()).toBe(0);
    });

    it('stops a worker whose build is ended while it still owes a batch', async () => {
      const { timer } = handTimer();
      const stuck = selectiveWorker(() => false);
      const next = inProcessWorker();
      const spawn = vi.fn<() => DerivationWorker>();
      spawn.mockReturnValueOnce(stuck.worker).mockReturnValueOnce(next.worker);
      const deriver = workerNoteDeriver(spawn, { timer });
      const abandoned = deriver.begin([]);
      const waiting = abandoned.derive([note('Idea')]);
      await answeredBy(stuck, 0);

      abandoned.end();

      await expect(waiting).rejects.toThrow('the build it was reading for was abandoned');
      expect(stuck.stopped()).toBe(1);
      // The next build is not behind the one that was stuck.
      const derived = await deriver.begin([]).derive([note('Plan')]);
      expect(derived.notes.map((each) => each.path)).toEqual(['Plan.md']);
      expect(derived.inWindow).toBeUndefined();
    });
  });

  describe('given an answer that is not one', () => {
    /** A worker that answers every batch with whatever `reply` makes of the real answer. */
    function lyingWorker(reply: (answer: DerivationAnswer & { kind: 'derived' }) => unknown) {
      let heard: Heard | null = null;
      let stopped = 0;
      const serve = serveNoteDerivation({
        markdown: remarkMarkdown,
        answer: (answer) => {
          const sent = answer.kind === 'derived' ? reply(answer) : answer;
          setTimeout(() => heard?.onAnswer(sent));
        },
      });
      const worker: DerivationWorker = {
        post: (request) => void setTimeout(() => serve(structuredClone(request))),
        listen: (listener) => {
          heard = listener;
        },
        stop: () => void (stopped += 1),
      };
      return { worker, stopped: () => stopped };
    }
    const idea = { path: 'Idea.md', text: 'a spark\n', modified: 1, size: 8 };
    const plan = { path: 'Plan.md', text: 'first\n', modified: 1, size: 6 };

    it.each<[string, Parameters<typeof lyingWorker>[0]]>([
      ['fewer notes than were asked for', (answer) => ({ ...answer, notes: [] })],
      [
        'a note that was not asked for',
        (answer) => ({
          ...answer,
          notes: answer.notes.map((each) => ({ ...each, path: 'Other.md' })),
        }),
      ],
      ['one note twice', (answer) => ({ ...answer, notes: [answer.notes[0], answer.notes[0]] })],
      ['no notes at all', (answer) => ({ kind: 'derived', batch: answer.batch })],
      ['something that is not an answer', () => 'done'],
    ])('fails the build and stops the worker, given %s', async (_what, reply) => {
      const { worker, stopped } = lyingWorker(reply);
      const deriving = workerNoteDeriver(() => worker).begin([]);

      await expect(deriving.derive([idea, plan])).rejects.toThrow(
        'the index worker sent what was not asked for',
      );
      expect(stopped()).toBe(1);
    });
  });

  it('refuses a batch for a build it has let go of, rather than answering from another', async () => {
    const { worker } = inProcessWorker();
    const deriving = workerNoteDeriver(() => worker).begin([]);

    deriving.end();

    await expect(deriving.derive([])).rejects.toThrow('this build of the index has ended');
  });

  it('tells the worker to forget a build that has ended', async () => {
    const { worker, requests } = inProcessWorker();
    const deriving = workerNoteDeriver(() => worker).begin([createVaultPath('Idea.md')]);
    await deriving.derive([]);

    deriving.end();

    expect(requests.map((request) => request.kind)).toEqual(['begin', 'derive', 'end']);
  });
});
