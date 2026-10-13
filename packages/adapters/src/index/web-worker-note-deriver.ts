import {
  workerNoteDeriver,
  type DerivationTimer,
  type DerivationWorker,
} from './worker-note-deriver.ts';

/** Starts the worker in `note-derivation.worker.ts`, which the bundler builds as its own script. */
function spawnDerivationWorker(): DerivationWorker {
  const worker = new Worker(new URL('./note-derivation.worker.ts', import.meta.url), {
    type: 'module',
    name: 'atlas-index',
  });
  return {
    post: (request) => worker.postMessage(request),
    stop: () => worker.terminate(),
    listen: ({ onAnswer, onCrash }) => {
      worker.onmessage = (event) => onAnswer(event.data);
      // Either is the end of this worker, as far as the index goes.
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

/** Real time, and a breath that is a task of its own: the window draws and takes input in between. */
const windowTimer: DerivationTimer = {
  after(milliseconds, then) {
    const pending = setTimeout(then, milliseconds);
    return () => clearTimeout(pending);
  },
  breathe: () =>
    new Promise((resolve) => {
      // A message rather than a timeout, which browsers hold back to 4 ms each when they nest.
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = () => {
        port1.close();
        resolve();
      };
      port2.postMessage(null);
    }),
};

/** Reads notes for the index in a web worker, off the window's thread (#135). */
export const webWorkerNoteDeriver = workerNoteDeriver(spawnDerivationWorker, {
  timer: windowTimer,
});
