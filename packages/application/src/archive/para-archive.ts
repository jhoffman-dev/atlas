import {
  isArchivedPath,
  isAtlasNote,
  isParaArchived,
  paraArchiveChanges,
  paraUnarchiveChanges,
  splitFrontmatter,
  vaultProjectTypeName,
  type VaultPath,
} from '@dfai/domain';
import { UnsavedTypingError } from '../vault/update-links.ts';
import { loadObjectTypes } from '../types/load-types.ts';
import {
  archiveNotes,
  moveAndStampNotes,
  panesFor,
  rewriteFrontmatter,
  unarchiveRule,
  UNSAVED_REASON,
  type ArchiveFailure,
  type ArchiveOutcome,
  type MoveRule,
  type NoteBatch,
} from './archive-notes.ts';

/** What a batch did, with the PARA notes it archived or unarchived by their value, where they stand. */
export interface ParaArchiveOutcome extends ArchiveOutcome {
  readonly valued: readonly VaultPath[];
}

type Properties = Readonly<Record<string, unknown>>;

const ALREADY_ARCHIVED = 'It is already archived.';

/**
 * The person's Archive (#213, ADR-0037): a PARA note — a Project, or a note
 * of the Area or Resource type from before — is archived by its value where
 * it stands, its `para` set to archive and what it was kept for Unarchive;
 * every other note is moved to the Archive as it always was. A note whose
 * `para` is the person's own is never written over, and is moved instead.
 */
export async function archiveNotesWithPara(
  batch: NoteBatch & { today: string },
): Promise<ParaArchiveOutcome> {
  const projectType = once(async () => vaultProjectTypeName(await loadObjectTypes(batch.ports)));
  const valued: VaultPath[] = [];
  const failed: ArchiveFailure[] = [];
  const moving: VaultPath[] = [];
  for (const path of batch.paths) {
    const properties = await paraCandidate(batch, path);
    const changes =
      properties === null
        ? null
        : paraArchiveChanges({ properties, projectType: await projectType() });
    if (changes === null) moving.push(path);
    else if (Object.keys(changes).length === 0) failed.push({ path, reason: ALREADY_ARCHIVED });
    else await writeInPlace(batch, path, changes, { valued, failed });
  }
  const moved = await archiveNotes({ ...batch, paths: moving });
  return { ...moved, failed: [...failed, ...moved.failed], valued };
}

/**
 * The person's Unarchive (#213, ADR-0037), in one step whatever archived the
 * note: one in the Archive folder comes back out to where it was, and a
 * Project archived by its value — where it stands, or in the Archive folder
 * as well — has its `para` given back to what it was before, Project when
 * nothing readable was kept.
 */
export async function unarchiveNotesWithPara(batch: NoteBatch): Promise<ParaArchiveOutcome> {
  const valued: VaultPath[] = [];
  const failed: ArchiveFailure[] = [];
  const moving: VaultPath[] = [];
  for (const path of batch.paths) {
    const properties = isArchivedPath(path) ? null : await paraCandidate(batch, path);
    const changes =
      properties !== null && isParaArchived(properties) ? paraUnarchiveChanges(properties) : null;
    if (changes === null) moving.push(path);
    else await writeInPlace(batch, path, changes, { valued, failed });
  }
  const moved = await moveAndStampNotes(
    { ...batch, paths: moving },
    withParaRestored(unarchiveRule(batch)),
  );
  return { ...moved, failed: [...failed, ...moved.failed], valued };
}

/** `rule`, giving a Project its `para` back too, in the same write that takes the stamp off. */
function withParaRestored(rule: MoveRule): MoveRule {
  return {
    ...rule,
    stamp: (from) => (own) => {
      const unstamp = rule.stamp(from)(own);
      const para = own === null ? null : paraUnarchiveChanges(own.properties);
      return para === null ? unstamp : { ...unstamp, changes: { ...unstamp.changes, ...para } };
    },
  };
}

/**
 * A note's frontmatter, read to tell whether it is archived by its value:
 * from what is on screen, its pane's typing saved first when the batch saves
 * it. Null for a note that cannot be — one of DFAI's own, one in the Archive
 * folder, one that cannot be read — which the move then answers for.
 */
async function paraCandidate(batch: NoteBatch, path: VaultPath): Promise<Properties | null> {
  if (isAtlasNote(path) || isArchivedPath(path)) return null;
  const { fs, markdown } = batch.ports;
  try {
    const editors = panesFor(batch);
    if (editors.state(path) === 'dirty') await editors.flush([path]);
    const { frontmatter } = splitFrontmatter((await fs.readTextFile(path)).text);
    if (markdown.frontmatterProblem(frontmatter) !== null) return null;
    return markdown.frontmatterProperties(frontmatter);
  } catch {
    // Unread, it is moved as any note is, and the move says why it could not be.
    return null;
  }
}

/** Writes a PARA note's archiving or unarchiving where it stands, and says how it went. */
async function writeInPlace(
  batch: NoteBatch,
  path: VaultPath,
  changes: Readonly<Record<string, unknown>>,
  outcome: { valued: VaultPath[]; failed: ArchiveFailure[] },
): Promise<void> {
  try {
    await rewriteFrontmatter({
      ports: { ...batch.ports, editors: panesFor(batch) },
      path,
      stamp: () => ({ changes, keepsBlock: true }),
      unsavedTyping: batch.unsavedTyping ?? 'save',
    });
    outcome.valued.push(path);
  } catch (cause) {
    outcome.failed.push(
      cause instanceof UnsavedTypingError
        ? { path, reason: UNSAVED_REASON, unsavedInApp: true }
        : { path, reason: cause instanceof Error ? cause.message : String(cause) },
    );
  }
}

/** `load`, run the first time it is asked for and remembered after. */
function once<Value>(load: () => Promise<Value>): () => Promise<Value> {
  let loaded: Promise<Value> | undefined;
  return () => (loaded ??= load());
}
