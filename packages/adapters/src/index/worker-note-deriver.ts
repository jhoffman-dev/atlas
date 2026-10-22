import { createWikiLinkResolver, messageWithoutPaths, type VaultPath } from '@dfai/domain';
import { remarkMarkdown } from '../markdown/markdown-port.ts';
import {
  deriveNotes,
  inThreadNoteDeriver,
  type IndexedNote,
  type MarkdownPort,
  type NoteDerivation,
  type NoteDeriver,
  type NoteDeriving,
  type NoteFile,
  type UnreadNote,
} from '@dfai/application';

/** What the window's thread asks of the worker. Plain data: it is copied across. */
export type DerivationRequest =
  | { readonly kind: 'begin'; readonly build: number; readonly notePaths: readonly VaultPath[] }
  | {
      readonly kind: 'derive';
      readonly build: number;
      readonly batch: number;
      readonly files: readonly NoteFile[];
    }
  | { readonly kind: 'end'; readonly build: number };

/** What the worker answers with: that a build has begun, and each batch of it. */
export type DerivationAnswer =
  | { readonly kind: 'began'; readonly build: number }
  | ({ readonly kind: 'derived'; readonly batch: number } & NoteDerivation)
  | { readonly kind: 'refused'; readonly batch: number; readonly problem: string };

/** The little of a `Worker` this needs, so a test can stand one up in-process. */
export interface DerivationWorker {
  post(request: DerivationRequest): void;
  listen(heard: {
    /** Whatever the worker posted; checked here, since it crossed a thread to arrive. */
    onAnswer: (answer: unknown) => void;
    /** The worker died: its script failed to load, or threw outside a request. */
    onCrash: (problem: string) => void;
  }): void;
  /** Ends the worker, whatever it is doing. One that cannot be ended is only let go of. */
  stop?(): void;
}

/**
 * The worker's half: runs the same deriving the window's thread would have,
 * with the same rules (ADR-0005), and answers each batch. A build it was never
 * told of, or has been told to forget, is refused rather than resolved against
 * another build's notes.
 */
export function serveNoteDerivation({
  markdown,
  answer,
}: {
  markdown: MarkdownPort;
  answer: (answer: DerivationAnswer) => void;
}): (request: DerivationRequest) => void {
  const deriver = inThreadNoteDeriver(markdown);
  const builds = new Map<number, NoteDeriving>();

  return (request) => {
    switch (request.kind) {
      case 'begin':
        builds.set(request.build, deriver.begin(request.notePaths));
        // Said back, so the window knows this thread came up and is reading.
        answer({ kind: 'began', build: request.build });
        return;
      case 'end':
        builds.delete(request.build);
        return;
      case 'derive': {
        const { batch, files } = request;
        const refuse = (cause: unknown) =>
          answer({ kind: 'refused', batch, problem: messageWithoutPaths(cause) });
        const deriving = builds.get(request.build);
        if (deriving === undefined) return refuse(new Error('this build of the index has ended'));
        deriving
          .derive(files)
          .then((derived) => answer({ kind: 'derived', batch, ...derived }), refuse);
      }
    }
  };
}

/** Time, as this needs it: something to happen later unless it is called off. */
export interface DerivationTimer {
  /** Runs `then` after `milliseconds`; the function it returns calls that off. */
  after(milliseconds: number, then: () => void): () => void;
  /** Lets the window draw and take input before going on. */
  breathe(): Promise<void>;
}

/**
 * How long a worker has to say a build has begun. Its script is loaded and
 * the markdown reader started in that time; a worker that has said nothing
 * by then is taken as one that will not start.
 */
export const WORKER_START_DEADLINE_MS = 15_000;

/**
 * How long a worker has to read a batch before it is taken as stuck: this
 * long whatever the batch, and then some for every kilobyte in it. A 2.2 MB
 * note has been measured at about two seconds, a millisecond a kilobyte; ten
 * times that is allowed, so only a reader that is not coming back runs out.
 */
export const BATCH_DEADLINE_MS = 30_000;
export const BATCH_DEADLINE_MS_PER_KB = 10;

const deadlineFor = (files: readonly NoteFile[]): number =>
  BATCH_DEADLINE_MS +
  BATCH_DEADLINE_MS_PER_KB * Math.ceil(files.reduce((sum, file) => sum + file.size, 0) / 1024);

/** Time by the platform's own timers: what a caller gets unless it brings its own. */
const TIMEOUTS: DerivationTimer = {
  after(milliseconds, then) {
    const pending = setTimeout(then, milliseconds);
    return () => clearTimeout(pending);
  },
  breathe: () => new Promise((resolve) => setTimeout(resolve, 0)),
};

/** A worker this has started, and what is known of it. */
interface Serving {
  readonly worker: DerivationWorker;
  /** False once it has died or been stopped: nothing more will come back from it. */
  alive: boolean;
  /** What it died of, once it has. */
  diedOf: string | null;
  /** Builds it has said it began. */
  readonly began: Set<number>;
  /** Builds it has been told to begin and has not yet said it has, each with its deadline's calling off. */
  readonly beginning: Map<number, () => void>;
  readonly waiting: Map<
    number,
    { build: number; settle: (answer: unknown) => void; fail: (cause: Error) => void }
  >;
}

const UNREAD = 'The notes could not be read for the index';
const MALFORMED = 'the index worker sent what was not asked for';
const STOPPED = 'the index worker stopped';

/** Why a worker could not be used, as the Activity line says it. */
class WorkerUnusable extends Error {}
/** A batch the worker did not answer in the time it had. */
class BatchOverdue extends Error {}

/**
 * The window's half (#135): reads no note itself. Each batch of files is
 * posted to a worker and the rows come back, so the thread the window draws
 * and listens on is held only for as long as it takes to pass them along.
 *
 * One worker serves every build, started when the first one begins: loading
 * the markdown reader into it is the slow part, and a refresh after a save is
 * a build of one note.
 *
 * A worker is another thread's word, so none of it is trusted to arrive:
 *
 * - one that cannot be started, dies before a build begins, or does not say a
 *   build has begun in time, is given up on for good. From then on notes are
 *   read in the window, one at a time with a breath between, and every answer
 *   says so (`inWindow`): a slow index, never none;
 * - one that dies with a build under way fails the batch waiting on it, and
 *   every later batch of that build at once; the next build starts another;
 * - one that does not answer a batch in time is stopped. The batch is asked
 *   again of a new worker a note at a time, and a note that runs out of time
 *   on its own is reported unread rather than read in the window, where it
 *   would stop the window as it stopped the worker;
 * - an answer that is not the answer to what was asked — the wrong shape,
 *   count or notes — is a dead worker's.
 */
export function workerNoteDeriver(
  spawn: () => DerivationWorker,
  {
    markdown = remarkMarkdown,
    timer = TIMEOUTS,
  }: {
    /** The reader used in the window, when the worker cannot be. */
    markdown?: MarkdownPort;
    timer?: DerivationTimer;
  } = {},
): NoteDeriver {
  let serving: Serving | null = null;
  let builds = 0;
  let batches = 0;
  /** Why notes are read in the window; null while the worker is in use. */
  let inWindow: string | null = null;

  const died = (worker: Serving, problem: string) => {
    if (!worker.alive) return;
    worker.alive = false;
    worker.diedOf = problem;
    if (serving === worker) serving = null;
    for (const callOff of worker.beginning.values()) callOff();
    worker.beginning.clear();
    for (const asked of worker.waiting.values()) {
      // Dead before the build began is a worker that never came up; after, one that failed.
      asked.fail(
        worker.began.has(asked.build)
          ? new Error(`${UNREAD}: ${problem}`)
          : new WorkerUnusable(problem),
      );
    }
    worker.waiting.clear();
  };

  const stop = (worker: Serving, problem: string) => {
    worker.worker.stop?.();
    died(worker, problem);
  };

  const heard = (worker: Serving, answer: unknown) => {
    if (!worker.alive) return;
    if (typeof answer !== 'object' || answer === null) return stop(worker, MALFORMED);
    const { kind, build, batch } = answer as { kind?: unknown; build?: unknown; batch?: unknown };
    if (kind === 'began' && typeof build === 'number') {
      worker.began.add(build);
      worker.beginning.get(build)?.();
      worker.beginning.delete(build);
      return;
    }
    if (typeof batch !== 'number') return stop(worker, MALFORMED);
    const asked = worker.waiting.get(batch);
    worker.waiting.delete(batch);
    asked?.settle(answer);
  };

  /** The worker in use, started if there is none. */
  const running = (): Serving => {
    if (serving !== null) return serving;
    const started: Serving = {
      worker: spawn(),
      alive: true,
      diedOf: null,
      began: new Set(),
      beginning: new Map(),
      waiting: new Map(),
    };
    started.worker.listen({
      onAnswer: (answer) => heard(started, answer),
      onCrash: (problem) => died(started, problem),
    });
    serving = started;
    return started;
  };

  /** Tells the worker of a build, and gives it until the deadline to say it has begun. */
  const begin = (worker: Serving, build: number, notePaths: readonly VaultPath[]) => {
    worker.beginning.set(
      build,
      timer.after(WORKER_START_DEADLINE_MS, () => stop(worker, 'the index worker did not start')),
    );
    worker.worker.post({ kind: 'begin', build, notePaths });
  };

  /** One batch asked of a worker; fails if it dies, answers something else, or runs out of time. */
  const ask = (
    worker: Serving,
    build: number,
    files: readonly NoteFile[],
  ): Promise<NoteDerivation> =>
    new Promise<NoteDerivation>((resolve, reject) => {
      const batch = ++batches;
      let overdue = false;
      const callOff = timer.after(deadlineFor(files), () => {
        overdue = true;
        stop(worker, 'the index worker stopped answering');
      });
      worker.waiting.set(batch, {
        build,
        settle: (answer) => {
          callOff();
          const checked = checkedAnswer(answer, files);
          if ('derived' in checked) return resolve(checked.derived);
          if ('refused' in checked) return reject(new Error(checked.refused));
          stop(worker, MALFORMED);
          reject(new Error(`${UNREAD}: ${MALFORMED}`));
        },
        fail: (cause) => {
          callOff();
          reject(overdue ? new BatchOverdue(cause.message) : cause);
        },
      });
      worker.worker.post({ kind: 'derive', build, batch, files });
    });

  /** Reads notes on the window's thread, one at a time, letting the window breathe between. */
  const deriveInWindow = async (
    files: readonly NoteFile[],
    notePaths: readonly VaultPath[],
    resolveLink: (target: string) => VaultPath | null,
    reason: string,
  ): Promise<NoteDerivation> => {
    const notes: IndexedNote[] = [];
    const failed: UnreadNote[] = [];
    for (const file of files) {
      const one = deriveNotes({ files: [file], notePaths, markdown, resolveLink });
      notes.push(...one.notes);
      failed.push(...one.failed);
      await timer.breathe();
    }
    return { notes, failed, inWindow: reason };
  };

  return {
    begin(notePaths) {
      const build = ++builds;
      // Made only if the window has to read: the worker makes its own.
      let resolver: ((target: string) => VaultPath | null) | null = null;
      const resolveLink = (target: string) =>
        (resolver ??= createWikiLinkResolver(notePaths))(target);
      /** The worker this build was begun on. */
      let on: Serving | null = null;
      let ended = false;
      /** Whether a batch of this build has run out of time, so some note in it does not come back. */
      let stuck = false;
      /** Set once a worker has died under this build: its later batches fail at once. */
      let lost: Error | null = null;

      /** Begins this build on the worker in use, starting one if there is none. */
      const beginOnAWorker = (): Serving => {
        let worker: Serving;
        try {
          worker = running();
        } catch (cause) {
          throw new WorkerUnusable(messageWithoutPaths(cause));
        }
        on = worker;
        begin(worker, build, notePaths);
        return worker;
      };

      /**
       * A batch that ran out of time, asked again a note at a time of a new
       * worker: the note that is stuck is the one that runs out again, and
       * is reported rather than read here, where it would stop the window.
       */
      const oneAtATime = async (files: readonly NoteFile[]): Promise<NoteDerivation> => {
        const notes: IndexedNote[] = [];
        const failed: UnreadNote[] = [];
        for (const file of files) {
          try {
            const worker = on !== null && on.alive ? on : beginOnAWorker();
            const derived = await ask(worker, build, [file]);
            notes.push(...derived.notes);
            failed.push(...derived.failed);
          } catch (cause) {
            if (!(cause instanceof BatchOverdue)) throw cause;
            failed.push({ path: file.path, problem: 'it took too long to read' });
          }
        }
        return { notes, failed };
      };

      // Begun at once rather than at the first batch, so the worker is up by
      // the time there are notes to read: the first refresh after a launch
      // would otherwise wait on its script loading. One that cannot be
      // started is answered for when a batch is asked of it.
      let unstartable: unknown = null;
      if (inWindow === null) {
        try {
          beginOnAWorker();
        } catch (cause) {
          unstartable = cause;
        }
      }

      const viaWorker = async (files: readonly NoteFile[]): Promise<NoteDerivation> => {
        if (unstartable !== null) throw unstartable;
        if (on !== null && !on.alive) {
          // Gone before it ever said this build began: it never came up.
          if (!on.began.has(build)) throw new WorkerUnusable(on.diedOf ?? STOPPED);
          // Gone since the last batch: not started again mid-build, which says the build failed.
          throw new Error(`${UNREAD}: ${STOPPED}`);
        }
        const worker = on ?? beginOnAWorker();
        return ask(worker, build, files).catch((cause: unknown) => {
          if (!(cause instanceof BatchOverdue)) throw cause;
          stuck = true;
          return oneAtATime(files);
        });
      };

      const derive = async (files: readonly NoteFile[]): Promise<NoteDerivation> => {
        if (ended) throw new Error('this build of the index has ended');
        if (lost !== null) throw lost;
        if (inWindow !== null) return deriveInWindow(files, notePaths, resolveLink, inWindow);
        try {
          return await viaWorker(files);
        } catch (cause) {
          // Not once a note has stuck a worker: read here, it would stick the window.
          if (cause instanceof WorkerUnusable && !ended && !stuck) {
            // It never came up: the window does the reading from here on.
            inWindow = sentence(cause.message);
            return deriveInWindow(files, notePaths, resolveLink, inWindow);
          }
          lost = cause instanceof Error ? cause : new Error(String(cause));
          throw lost;
        }
      };

      return {
        derive,
        end() {
          if (ended) return;
          ended = true;
          if (on === null || !on.alive) return;
          // A build ended while the worker still owes it a batch was abandoned
          // mid-read. The worker may never come back from that, and the next
          // build must not wait behind it: it gets a new one.
          if (on.waiting.size > 0) return stop(on, 'the build it was reading for was abandoned');
          on.beginning.get(build)?.();
          on.beginning.delete(build);
          on.worker.post({ kind: 'end', build });
        },
      };
    },
  };
}

/** A reason, as a sentence: capital first, one full stop. */
const sentence = (reason: string): string => {
  const trimmed = reason.trim().replace(/\.+$/, '');
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
};

/**
 * A worker's answer to a batch, told apart: the notes asked for, each read or
 * reported, once; a refusal, in its own words; or nothing this asked for.
 */
function checkedAnswer(
  answer: unknown,
  files: readonly NoteFile[],
): { derived: NoteDerivation } | { refused: string } | { malformed: true } {
  const { kind, problem, notes, failed } = answer as {
    kind?: unknown;
    problem?: unknown;
    notes?: unknown;
    failed?: unknown;
  };
  if (kind === 'refused' && typeof problem === 'string') return { refused: problem };
  if (kind !== 'derived' || !Array.isArray(notes) || !Array.isArray(failed)) {
    return { malformed: true };
  }
  const answeredFor = [...notes, ...failed]
    .map((each: unknown) =>
      typeof each === 'object' && each !== null ? (each as { path?: unknown }).path : undefined,
    )
    .filter((path) => typeof path === 'string')
    .sort();
  const asked = files.map((file) => file.path).sort();
  const same =
    notes.length + failed.length === asked.length &&
    answeredFor.length === asked.length &&
    answeredFor.every((path, position) => path === asked[position]);
  if (!same) return { malformed: true };
  return { derived: { notes: notes as IndexedNote[], failed: failed as UnreadNote[] } };
}
