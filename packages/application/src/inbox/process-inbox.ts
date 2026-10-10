import {
  filedUnderStamp,
  filingRefusal,
  processDestination,
  processRefusal,
  splitFrontmatter,
  vaultSpellingOf,
  type VaultPath,
} from '@atlas/domain';
import {
  moveAndStampNotes,
  type ArchiveOutcome,
  type ArchivePorts,
  type NoteBatch,
} from '../archive/archive-notes.ts';
import { noteTypeName } from '../types/load-types.ts';

/** The note asked to file the Inbox under cannot have notes filed under it. */
export class FilingRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'FilingRefusedError';
  }
}

/**
 * Processes notes out of the Inbox: each is filed under `project` — moved
 * into the project's folder and given `project: [[…]]` linking it — as the
 * Inbox's Process does (P30-01).
 *
 * `project` has to be a project or an area still in use; anything else
 * refuses the whole batch before a note moves. A note that is not in the
 * Inbox is reported and the rest carry on. The move and the write are the
 * Archive's: a note that moves and cannot then be written is still filed,
 * and says so.
 */
export async function processInboxItems(
  batch: NoteBatch & { project: VaultPath },
): Promise<ArchiveOutcome> {
  const project = await filingTarget(batch);
  const link = filedUnderStamp({ project, notePaths: batch.notePaths });
  const types = await typesOf(batch.ports, batch.paths);
  return moveAndStampNotes(batch, {
    refusal: (path) => processRefusal({ path, type: types.get(path) ?? null }),
    destination: async ({ path, taken }) => processDestination({ path, project, taken }),
    stamp: () => () => ({ changes: link, keepsBlock: true }),
  });
}

/**
 * Each note's `type:`, read before anything moves so a proposal is refused
 * whatever folder it is in. A note that cannot be read has none here; the
 * move says why it cannot go.
 */
async function typesOf(
  { fs, markdown }: Pick<ArchivePorts, 'fs' | 'markdown'>,
  paths: readonly VaultPath[],
): Promise<ReadonlyMap<VaultPath, string | null>> {
  const typeOf = (text: string): string | null => {
    const { frontmatter } = splitFrontmatter(text);
    if (markdown.frontmatterProblem(frontmatter) !== null) return null;
    return noteTypeName(markdown.frontmatterProperties(frontmatter));
  };
  const read = async (path: VaultPath) =>
    // A note that cannot be read has no type to judge; its move reports why it did not go.
    [
      path,
      await fs.readTextFile(path).then(
        ({ text }) => typeOf(text),
        () => null,
      ),
    ] as const;
  return new Map(await Promise.all(paths.map(read)));
}

/** The project or area the batch files under, as the vault spells it, or a refusal. */
async function filingTarget({
  ports,
  notePaths,
  project,
}: {
  ports: ArchivePorts;
  notePaths: readonly VaultPath[];
  project: VaultPath;
}): Promise<VaultPath> {
  const found = vaultSpellingOf(project, notePaths);
  if (found === null) throw new FilingRefusedError('There is no note to file under at that path.');
  const { text } = await ports.fs.readTextFile(found);
  const properties = ports.markdown.frontmatterProperties(splitFrontmatter(text).frontmatter);
  const refusal = filingRefusal({ path: found, type: noteTypeName(properties) });
  if (refusal !== null) throw new FilingRefusedError(refusal);
  return found;
}
