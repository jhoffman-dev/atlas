import { workerNoteDeriver, type DerivationWorker } from './worker-note-deriver.ts';

/** Starts the worker in `note-derivation.worker.ts`, which the bundler builds as its own script. */
function spawnDerivationWorker(): DerivationWorker {
  const worker = new Worker(new URL('./note-derivation.worker.ts', import.meta.url), {
    type: 'module',
    name: 'atlas-index',
  });
  return {
    post: (request) => worker.postMessage(request),
    listen: ({ onAnswer, onCrash }) => {
      worker.onmessage = (event) => onAnswer(event.data);
      // Either is the end of this worker: the build waiting on it fails, which
      // the window says, and the next build starts another.
      const crashed = (problem: string) => {
        worker.terminate();
        onCrash(problem);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        crashed(event.message || 'the index worker stopped');
      };
      worker.onmessageerror = () => crashed('a message from the index worker could not be read');
    },
  };
}

/** Reads notes for the index in a web worker, off the window's thread (#135). */
export const webWorkerNoteDeriver = workerNoteDeriver(spawnDerivationWorker);
