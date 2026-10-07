/**
 * Running a model's program on this machine and reading what it prints, line
 * by line. The Claude Code provider is written against this; the host's
 * commands are one implementation of it (`tauri-model-process.ts`), and a
 * test's fake child process is another.
 */
export interface ModelProcessHost {
  run(args: {
    /** The program's arguments, as the host's fixed shape allows them (ADR-0021). */
    readonly args: readonly string[];
    /** Written to the program's standard input, which is then closed. */
    readonly stdin: string;
    /** Each line of standard output, as it arrives. */
    readonly onLine: (line: string) => void;
    /** Aborting kills the program. */
    readonly signal: AbortSignal;
  }): Promise<ProcessExit>;
}

export interface ProcessExit {
  /** Null when the program was killed rather than exiting. */
  readonly code: number | null;
  /** The end of what it wrote to standard error, for saying why it failed. */
  readonly stderr: string;
}

/** The host could not find `claude` in any of the places it was told to look. */
export class ProgramNotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProgramNotFound';
  }
}
