import {
  cleanEntryName,
  fitFileNameStem,
  joinFrontmatter,
  nextAvailableNotePath,
  NUMBERED_NOTE_ENDING,
  type DoneAction,
  type NoteAnswer,
  type VaultPath,
} from '@dfai/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { ensureFolder } from '../vault/create-folder.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** A note ready to be written: where, what it holds, and what the log says of it. */
export interface PlannedNote {
  readonly path: VaultPath;
  readonly contents: string;
  readonly made: DoneAction;
  /** For the declared step's proposal: the meeting it was read from, which its tally counts it under. */
  readonly meeting?: VaultPath;
  /** For a proposal, its id: a note found at its path holding it was made by a run alongside. */
  readonly id?: string;
}

/**
 * The one new note of a Claude step whose output is a note, in the rule's
 * folder; a name already taken is numbered past, never written over. Its
 * proposals are planned by the proposals' own writer (`planProposals`).
 */
export async function planNote({
  ports,
  notePaths,
  folder,
  note,
}: {
  ports: { fs: VaultFsPort; markdown: Pick<MarkdownPort, 'updateFrontmatter'> };
  notePaths: readonly VaultPath[];
  folder: VaultPath;
  note: NoteAnswer;
}): Promise<PlannedNote> {
  const at = await ensureFolder({ fs: ports.fs, folder });
  const name = fitFileNameStem(cleanEntryName(note.title), NUMBERED_NOTE_ENDING);
  const path = nextAvailableNotePath({ folder: at, name, taken: new Set(notePaths) });
  const frontmatter =
    Object.keys(note.properties).length === 0
      ? null
      : ports.markdown.updateFrontmatter(null, note.properties);
  return {
    path,
    contents: joinFrontmatter(frontmatter, note.body),
    made: { kind: 'created', path },
  };
}
