import { messageWithoutPaths, type VaultPath } from '@atlas/domain';
import {
  inThreadNoteDeriver,
  type MarkdownPort,
  type NoteDerivation,
  type NoteDeriver,
  type NoteDeriving,
  type NoteFile,
} from '@atlas/application';

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

/** What the worker answers a `derive` with. */
export type DerivationAnswer =
  | ({ readonly kind: 'derived'; readonly batch: number } & NoteDerivation)
  | { readonly kind: 'refused'; readonly batch: number; readonly problem: string };

/** The little of a `Worker` this needs, so a test can stand one up in-process. */
export interface DerivationWorker {
  post(request: DerivationRequest): void;
  listen(heard: {
    onAnswer: (answer: DerivationAnswer) => void;
    /** The worker died: its script failed to load, or threw outside a request. */
    onCrash: (problem: string) => void;
  }): void;
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

/**
 * The window's half (#135): reads no note itself. Each batch of files is
 * posted to a worker and the rows come back, so the thread the window draws
 * and listens on is held only for as long as it takes to pass them along.
 *
 * One worker serves every build, started when the first one begins: loading
 * the markdown reader into it is the slow part, and a refresh after a save is
 * a build of one note. A worker that dies fails the batches waiting on it,
 * and the next build starts another.
 */
export function workerNoteDeriver(spawn: () => DerivationWorker): NoteDeriver {
  let worker: DerivationWorker | null = null;
  let builds = 0;
  let batches = 0;
  const waiting = new Map<
    number,
    { settle: (derived: NoteDerivation) => void; fail: (cause: Error) => void }
  >();
  const failed = (problem: string) =>
    new Error(`The notes could not be read for the index: ${problem}`);

  const running = (): DerivationWorker => {
    if (worker !== null) return worker;
    const spawned = spawn();
    spawned.listen({
      onAnswer: (answer) => {
        const asked = waiting.get(answer.batch);
        waiting.delete(answer.batch);
        if (answer.kind === 'derived') {
          asked?.settle({ notes: answer.notes, failed: answer.failed });
        } else asked?.fail(failed(answer.problem));
      },
      onCrash: (problem) => {
        if (worker === spawned) worker = null;
        for (const asked of waiting.values()) asked.fail(failed(problem));
        waiting.clear();
      },
    });
    worker = spawned;
    return spawned;
  };

  return {
    begin(notePaths) {
      const build = ++builds;
      const serving = running();
      serving.post({ kind: 'begin', build, notePaths });
      return {
        derive: (files) =>
          new Promise<NoteDerivation>((settle, fail) => {
            const batch = ++batches;
            waiting.set(batch, { settle, fail });
            serving.post({ kind: 'derive', build, batch, files });
          }),
        end: () => serving.post({ kind: 'end', build }),
      };
    },
  };
}
