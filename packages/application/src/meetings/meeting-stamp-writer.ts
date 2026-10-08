import { splitFrontmatter, withLinesAfterContract, type VaultPath } from '@atlas/domain';
import type { ArchivePorts } from '../archive/archive-notes.ts';
import { NoteChangedError } from '../notes/note-changed-error.ts';
import type { MarkdownPort } from '../notes/ports.ts';

export const UNSAVED = 'It is open in Atlas with unsaved typing, so the import left it as it is.';

/**
 * Writes the import's keys into a note as it was read — refused if it changed
 * since — and has any pane showing it read it again. A note being typed in is
 * never written: why is said instead (null when it was written).
 */
export async function writeStamp(
  ports: Pick<ArchivePorts, 'fs' | 'markdown' | 'editors'>,
  {
    path,
    modified,
    values,
  }: { path: VaultPath; modified: number; values: Readonly<Record<string, unknown>> },
): Promise<string | null> {
  if (ports.editors.state(path) === 'dirty') return UNSAVED;
  const { text, modified: now } = await ports.fs.readTextFile(path);
  if (now !== modified) throw new NoteChangedError(path);
  const document = splitFrontmatter(text);
  await ports.fs.writeTextFile({
    path,
    contents: stampedFrontmatter(ports.markdown, document.frontmatter, values) + document.body,
    expectedModified: modified,
  });
  if (ports.editors.state(path) === 'clean') ports.editors.reload(path);
  return null;
}

/**
 * The frontmatter with the import's keys written, byte for byte otherwise
 * (ADR-0003). A key the note has is changed — or, given null, taken out —
 * where it is. A key it lacks goes right after the `atlas_import:` line, not
 * at the end where a property added on another Mac lands, so the two edits
 * merge; a note with no such line gets it as any property is added.
 */
function stampedFrontmatter(
  markdown: MarkdownPort,
  frontmatter: string | null,
  values: Readonly<Record<string, unknown>>,
): string {
  const own = markdown.frontmatterProperties(frontmatter);
  const entries = Object.entries(values);
  const inPlace = entries.filter(([key, value]) => value === null || Object.hasOwn(own, key));
  const added = entries.filter(([key, value]) => value !== null && !Object.hasOwn(own, key));
  const changed =
    inPlace.length === 0 && frontmatter !== null
      ? frontmatter
      : markdown.updateFrontmatter(frontmatter, Object.fromEntries(inPlace));
  if (added.length === 0) return changed;
  const lines = linesOf(markdown.updateFrontmatter(null, Object.fromEntries(added)));
  return (
    withLinesAfterContract(changed, lines) ??
    markdown.updateFrontmatter(changed, Object.fromEntries(added))
  );
}

/** A block's lines between its fences, as the app's own writer writes them. */
const linesOf = (block: string) => block.replace(/^---\r?\n/, '').replace(/^---\r?\n?$/m, '');
