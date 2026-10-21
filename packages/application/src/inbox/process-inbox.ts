import {
  expandHomeFolder,
  filedUnderStamp,
  filingRefusal,
  homeFolderOf,
  isInInbox,
  noteDay,
  PARA_KEY,
  PLAIN_NOTE_HOME,
  processDestination,
  processRefusal,
  splitFrontmatter,
  vaultSpellingOf,
  type ObjectType,
  type VaultPath,
} from '@dfai/domain';
import {
  moveAndStampNotes,
  stampNotes,
  type ArchiveOutcome,
  type ArchivePorts,
  type NoteBatch,
} from '../archive/archive-notes.ts';
import { loadObjectTypes, noteTypeName } from '../types/load-types.ts';

/** The note asked to file the Inbox under cannot have notes filed under it. */
export class FilingRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'FilingRefusedError';
  }
}

/** What processing did: the notes that moved out of the `Inbox` folder, and the ones filed where they are. */
export interface ProcessOutcome extends ArchiveOutcome {
  /** Notes filed by their link alone, where they live: a meeting in its month's folder (#214). */
  readonly linked: readonly VaultPath[];
}

/**
 * Processes notes out of the Inbox: each is filed under `project` — given
 * `project: [[…]]` linking it — as the Inbox's Process does (P30-01). Filing
 * is the link (#214): a note that waits where it lives, a meeting in its
 * month's folder, stays there; one in the `Inbox` folder leaves it for its
 * type's home folder for its day — a plain note, or one whose type has no
 * home, for `Notes/<year>` — never for the project's folder.
 *
 * `project` has to be a project or an area still in use; anything else
 * refuses the whole batch before a note moves. A note that is not in the
 * Inbox is reported and the rest carry on. The move and the write are the
 * Archive's: a note that moves and cannot then be written is still filed,
 * and says so.
 */
export async function processInboxItems(
  batch: NoteBatch & {
    project: VaultPath;
    /** `YYYY-MM-DD`, from the injected clock: the day of a note that names none. */
    today: string;
  },
): Promise<ProcessOutcome> {
  const project = await filingTarget(batch);
  const link = filedUnderStamp({ project, notePaths: batch.notePaths });
  const notes = await propertiesOf(batch.ports, batch.paths);
  const types = await loadObjectTypes(batch.ports);
  const refusal = (path: VaultPath) =>
    processRefusal({ path, type: noteTypeName(notes.get(path) ?? {}) });
  const stamp = () => ({ changes: link, keepsBlock: true });
  const moved = await moveAndStampNotes(
    { ...batch, paths: batch.paths.filter(isInInbox) },
    {
      refusal,
      destination: async ({ path, taken }) => {
        const properties = notes.get(path) ?? {};
        const folder = filedFolderOf({ properties, path, types, today: batch.today });
        return processDestination({ path, folder, taken });
      },
      stamp: () => stamp,
    },
  );
  const inPlace = await stampNotes(
    { ...batch, paths: batch.paths.filter((path) => !isInInbox(path)) },
    { refusal, stamp },
  );
  return { ...moved, failed: [...moved.failed, ...inPlace.failed], linked: inPlace.stamped };
}

/** Where a note leaving the `Inbox` folder goes: its type's home, or the plain notes' home. */
function filedFolderOf(args: {
  properties: Readonly<Record<string, unknown>>;
  path: VaultPath;
  types: readonly ObjectType[];
  today: string;
}): VaultPath {
  const home = homeFolderOf(args) ?? expandHomeFolder(PLAIN_NOTE_HOME, noteDay(args));
  if (home === null) throw new Error(`${PLAIN_NOTE_HOME} cannot be a folder`);
  return home;
}

/**
 * Each note's frontmatter, read before anything moves so a proposal is
 * refused whatever folder it is in. A note that cannot be read has none
 * here; the move says why it cannot go.
 */
async function propertiesOf(
  { fs, markdown }: Pick<ArchivePorts, 'fs' | 'markdown'>,
  paths: readonly VaultPath[],
): Promise<ReadonlyMap<VaultPath, Readonly<Record<string, unknown>>>> {
  const read = (text: string): Readonly<Record<string, unknown>> => {
    const { frontmatter } = splitFrontmatter(text);
    if (markdown.frontmatterProblem(frontmatter) !== null) return {};
    return markdown.frontmatterProperties(frontmatter);
  };
  const each = async (path: VaultPath) =>
    // A note that cannot be read has no properties to judge; its move reports why it did not go.
    [
      path,
      await fs.readTextFile(path).then(
        ({ text }) => read(text),
        () => ({}),
      ),
    ] as const;
  return new Map(await Promise.all(paths.map(each)));
}

/** The project or area the batch files under, as the vault spells it, or a refusal. */
export async function filingTarget({
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
  const refusal = filingRefusal({
    path: found,
    type: noteTypeName(properties),
    para: properties[PARA_KEY],
  });
  if (refusal !== null) throw new FilingRefusedError(refusal);
  return found;
}
