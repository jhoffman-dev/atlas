import { createVaultPath, repeatingTaskUpdate, splitFrontmatter } from '@atlas/domain';
import type { VaultFsPort } from '../vault/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { NoteChangedError } from '../notes/note-changed-error.ts';
import { withTaskRules } from '../gtd/task-rules.ts';

/** What counts as finishing a task, for the views that can tick one off. */
export interface CompletionRule {
  /** The property that says whether a task is finished. */
  readonly statusKey: string;
  /** The value that means finished. */
  readonly doneValue: string;
  /** What a repeating task goes back to once it rolls over. */
  readonly resetStatus: string;
}

/**
 * Changes one property of a note that is not open in the editor — a cell in a
 * table, for instance.
 *
 * The note is read, its frontmatter changed and the file written back, so the
 * file remains what everything else is derived from.
 */
export async function setNoteProperty({
  fs,
  markdown,
  path,
  key,
  value,
  completion,
  today,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  path: string;
  key: string;
  value: unknown;
  /** `YYYY-MM-DD`: the day a task this finishes is dated (ADR-0029). */
  today: string;
  /**
   * When given, finishing a repeating task rolls it forward instead: its due
   * date moves on and it goes back into play, rather than the series ending.
   */
  completion?: CompletionRule;
}): Promise<void> {
  await setNoteProperties({
    fs,
    markdown,
    path,
    values: propertyChange({ key, value, ...(completion ? { completion } : {}) }),
    today,
  });
}

/**
 * What changing one property means, as something a write can carry out.
 *
 * Rolling a series forward needs the frontmatter the file already has, and
 * reading it separately would open a window in which the file could change. So
 * the rule travels as a function of the properties, to be run by whichever
 * write ends up doing the read — the file itself, or the editor holding it.
 */
export function propertyChange({
  key,
  value,
  completion,
}: {
  key: string;
  value: unknown;
  completion?: CompletionRule;
}): PropertyChanges {
  const rule = completion ?? null;
  const finishing = rule !== null && key === rule.statusKey && String(value) === rule.doneValue;
  const change = { [key]: value };
  if (!finishing || rule === null) return change;
  return (properties) =>
    repeatingTaskUpdate({
      properties,
      statusKey: rule.statusKey,
      resetStatus: rule.resetStatus,
    }) ?? change;
}

/**
 * What to write into a note's frontmatter: the changes themselves, or a rule
 * that works them out from the properties the note currently has.
 */
export type PropertyChanges =
  | Readonly<Record<string, unknown>>
  | ((properties: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>);

/**
 * Changes some properties of a note, leaving the rest of the file as it was.
 *
 * This is the one place a note that is not open in the editor is written, so
 * the byte-preserving read-change-write happens once — and so the task rules
 * (ADR-0029) are held here, against the frontmatter the write reads, for
 * every caller: a refused change throws `TaskRuleRefusedError` and writes
 * nothing. Moving a bar on a timeline changes when work starts *and* when it
 * ends, and those are one edit rather than two: written separately, the file
 * would be briefly inconsistent and the watcher would see two changes.
 *
 * The index is not touched here: it follows the file, never the other way round.
 */
export async function setNoteProperties({
  today,
  values,
  ...write
}: FrontmatterWrite & {
  /** `YYYY-MM-DD`: the day a task this finishes is dated. */
  today: string;
}): Promise<void> {
  await writeFrontmatterChanges({ ...write, values: withTaskRules({ values, today }) });
}

interface FrontmatterWrite {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  path: string;
  values: PropertyChanges;
  /**
   * The modification time the caller read the note at. When given, a note that
   * has moved on since is refused with `NoteChangedError` rather than written.
   */
  ifModified?: number;
}

/**
 * The byte-preserving read-change-write of a file's frontmatter, with no
 * rules about what a note may hold: for Atlas's own files — a type's
 * definition, the vault's settings — which are not notes. A note is written
 * with {@link setNoteProperties}.
 */
export async function writeFrontmatterChanges({
  fs,
  markdown,
  path,
  values,
  ifModified,
}: FrontmatterWrite): Promise<void> {
  const target = createVaultPath(path);
  const { text, modified } = await fs.readTextFile(target);
  if (ifModified !== undefined && ifModified !== modified) throw new NoteChangedError(target);
  const document = splitFrontmatter(text);

  const changes =
    typeof values === 'function'
      ? values(markdown.frontmatterProperties(document.frontmatter))
      : values;
  // Nothing to change writes nothing, rather than re-writing the note as it was.
  if (Object.keys(changes).length === 0) return;

  await fs.writeTextFile({
    path: target,
    contents: markdown.updateFrontmatter(document.frontmatter, changes) + document.body,
    expectedModified: modified,
  });
}
