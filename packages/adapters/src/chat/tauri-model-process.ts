import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ProgramNotFound, type ModelProcessHost, type ProcessExit } from './model-process.ts';

/** The event the host emits a running program's output on. */
export const MODEL_PROCESS_EVENT = 'model-process';

/** What the host says of a run: a line it printed, or that it ended. */
export type ModelProcessPayload =
  | { readonly run: string; readonly kind: 'line'; readonly text: string }
  | {
      readonly run: string;
      readonly kind: 'exit';
      readonly code: number | null;
      readonly stderr: string;
    };

/** How the host words a refusal to start because no `claude` was found. */
const NOT_FOUND = 'not_found:';

/**
 * Claude Code, run by the host (`model_process.rs`): it starts `claude` from
 * the first of its own install locations that has one, pipes the prompt in, and
 * emits each line of output as an event tagged with this run's id. Nothing
 * here decides anything; the host checks the arguments against its fixed
 * shape before it runs anything (ADR-0021).
 */
export function tauriModelProcess(newRunId: () => string): ModelProcessHost {
  return {
    async run({ args, stdin, onLine, signal }) {
      const run = newRunId();
      let settle: (exit: ProcessExit) => void = () => {};
      const exited = new Promise<ProcessExit>((resolve) => (settle = resolve));
      const unlisten = await listen<ModelProcessPayload>(MODEL_PROCESS_EVENT, ({ payload }) => {
        if (payload.run !== run) return;
        if (payload.kind === 'line') onLine(payload.text);
        else settle({ code: payload.code, stderr: payload.stderr });
      });
      const cancel = () => {
        invoke('model_process_cancel', { run }).catch(() => {
          // The program has already ended, and its exit is on the way.
        });
      };
      try {
        await started(invoke('model_process_start', { run, args, stdin }));
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
        return await exited;
      } finally {
        signal.removeEventListener('abort', cancel);
        unlisten();
      }
    },
  };
}

async function started(call: Promise<unknown>): Promise<void> {
  try {
    await call;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw message.startsWith(NOT_FOUND)
      ? new ProgramNotFound(message.slice(NOT_FOUND.length).trim())
      : new Error(message);
  }
}
