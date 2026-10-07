import {
  appendLogEntry,
  logPathFor,
  parentVaultPath,
  parseRunLog,
  type AutomationRule,
  type LogEntry,
} from '@atlas/domain';
import { ensureFolder } from '../vault/create-folder.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** A rule's log as it is on disk: its text, when it was read, and its entries. */
export interface RuleLog {
  readonly text: string | null;
  readonly modified: number | null;
  readonly entries: readonly LogEntry[];
}

/**
 * A log entry that could not be written. It carries the entry, so whoever
 * started the run still knows what the run did — and can stop the rule until
 * its log can say so, rather than change more notes nothing records.
 */
export class AutomationLogError extends Error {
  constructor(
    readonly entry: LogEntry,
    cause: unknown,
  ) {
    super(
      `Its log could not be written (${cause instanceof Error ? cause.message : String(cause)}).`,
      { cause },
    );
    this.name = 'AutomationLogError';
  }
}

/** Reads a rule's log; an empty one when the rule has never written one. */
export async function readRuleLog(
  fs: VaultFsPort,
  rule: Pick<AutomationRule, 'id'>,
): Promise<RuleLog> {
  const [file] = await fs.readNotes([logPathFor(rule.id)]);
  if (file === undefined) return { text: null, modified: null, entries: [] };
  return { text: file.text, modified: file.modified, entries: parseRunLog(file.text) };
}

/**
 * Adds an entry to a rule's log, making the log — and its folder — the first
 * time. The write is refused if the log changed since it was read, rather than
 * losing whatever was added in between. Rejects with {@link AutomationLogError}
 * when it cannot be written.
 */
export async function appendToRuleLog({
  fs,
  rule,
  entry,
}: {
  fs: VaultFsPort;
  rule: Pick<AutomationRule, 'id' | 'name'>;
  entry: LogEntry;
}): Promise<void> {
  try {
    const path = logPathFor(rule.id);
    const log = await readRuleLog(fs, rule);
    const contents = appendLogEntry({ text: log.text, ruleName: rule.name, entry });
    if (log.text === null) {
      await ensureFolder({ fs, folder: parentVaultPath(path) });
      await fs.createNote({ path, contents });
      return;
    }
    await fs.writeTextFile({ path, contents, expectedModified: log.modified });
  } catch (cause) {
    throw new AutomationLogError(entry, cause);
  }
}
