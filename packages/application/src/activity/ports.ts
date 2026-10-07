import type { ActivityEvent, ActivityQuery, ActivityReport } from '@atlas/domain';

/**
 * Where the use-cases say what happened (U-28). Recording never waits and
 * never fails the work being recorded: a log that cannot be written is the
 * log's problem, not the save's or the run's.
 */
export interface ActivityRecorder {
  /** Dates the line by the log's clock and keeps it for this recorder's vault. */
  record(report: ActivityReport): void;
}

/** Lines just kept in a vault's log, oldest first. */
export interface ActivityNews {
  readonly vault: string;
  readonly events: readonly ActivityEvent[];
}

export interface ActivityLog extends ActivityRecorder {
  /** Dates the line by the log's clock and keeps it for the vault open now. */
  record(report: ActivityReport): void;
  /**
   * A recorder for the vault open now, for work that records after it waits:
   * what it records lands in this vault's log even if another has opened since.
   * It records nothing when no vault is open.
   */
  inOpenVault(): ActivityRecorder;
  /** A recorder for the vault with this root, for work that names its vault. */
  inVault(vault: string): ActivityRecorder;
  /** The open vault's lines the query asks for, newest first. */
  read(query?: ActivityQuery): Promise<readonly ActivityEvent[]>;
  /** Handed each vault's lines once they are kept; returns the way to stop. */
  subscribe(listener: (news: ActivityNews) => void): () => void;
}

/** Says when the window is about to close, so what waits to be written can be written first. */
export interface WindowClosingPort {
  /** Runs the task before the window closes, which waits for it; resolves to the way to stop. */
  beforeClose(task: () => Promise<void>): Promise<() => void>;
}

/**
 * The log's file for each vault, kept on this Mac outside the vault. It holds
 * and hands back text; what goes in it, and when it is cut back, is decided
 * by the domain (`boundActivity`).
 */
export interface ActivityStore {
  /** Adds the text to the end of the vault's file; resolves to the file's size in bytes after. */
  append(args: { vault: string; text: string }): Promise<number>;
  /** The vault's whole file; empty when there is none yet. */
  read(args: { vault: string }): Promise<string>;
  /** Replaces the vault's file with the text, whole. */
  replace(args: { vault: string; text: string }): Promise<void>;
}
