import {
  compileProposalIdsQuery,
  createVaultPath,
  joinFrontmatter,
  messageWithoutPaths,
  nextAvailableNotePath,
  noteTitle,
  proposalFileFor,
  PROPOSAL_ID_KEY,
  PROPOSALS_FOLDER,
  splitFrontmatter,
  type NewProposal,
  type VaultPath,
} from '@dfai/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { ensureFolder } from '../vault/create-folder.ts';
import { readProposalsFolder, type ProposalsFolder } from './proposals-folder.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** What proposals are written with: the vault, and the index to ask what was already proposed. */
export interface ProposalWritePorts {
  readonly fs: VaultFsPort;
  readonly index: Pick<IndexPort, 'query'>;
  readonly markdown: Pick<MarkdownPort, 'updateFrontmatter' | 'frontmatterProperties'>;
}

/** A proposal that could not be written, and why. */
export interface ProposalLeft {
  readonly path: VaultPath;
  readonly reason: string;
}

/** A proposal ready to be written: where, what its note holds, and the id it is known by. */
export interface PlannedProposal {
  readonly path: VaultPath;
  readonly contents: string;
  readonly id: string;
}

/** Every proposal decided, before any is written. */
export interface ProposalsPlanned {
  readonly planned: readonly PlannedProposal[];
  /** Those that cannot be made a note of. */
  readonly left: readonly ProposalLeft[];
}

/** What writing proposals did: each one written, and each one that could not be, and why. */
export interface ProposalsWritten {
  readonly written: readonly VaultPath[];
  readonly left: readonly ProposalLeft[];
}

/**
 * Every proposal as a note in `Inbox/Proposals/` (ADR-0028), decided before
 * the first is written: its name (numbered past every name taken, in the
 * folder or earlier in this batch) and its contents — unless one for the
 * same thing is already in the vault, open or answered, or earlier in the
 * batch: a rejection is an answer, and a step that runs again proposes
 * nothing twice. Those are left out.
 *
 * The index is asked where proposals for these ids are, and the folder's own
 * files are read too, since the index lags a write made a moment ago. Only
 * the folder is made; no proposal is written here.
 */
export async function planProposals({
  fs,
  index,
  markdown,
  proposals,
  read,
}: ProposalWritePorts & {
  proposals: readonly NewProposal[];
  /** The folder as this run read it already (a Claude step reads it once); read here when not given. */
  read?: ProposalsFolder;
}): Promise<ProposalsPlanned> {
  if (proposals.length === 0) return { planned: [], left: [] };
  const held = await heldIds(index, proposals);
  const { folder, entries, notes } = await folderToWrite(fs, read);
  for (const id of waitingIds(markdown, notes)) held.add(id);
  const taken = new Set<string>(entries.map((entry) => entry.path));
  const planned: PlannedProposal[] = [];
  const left: ProposalLeft[] = [];
  for (const proposal of proposals) {
    if (held.has(proposal.id)) continue;
    held.add(proposal.id);
    const file = proposalFileFor(proposal);
    try {
      const frontmatter = markdown.updateFrontmatter(null, file.properties);
      const path = nextAvailableNotePath({ folder, name: noteTitle(file.path), taken });
      taken.add(path);
      planned.push({ path, contents: joinFrontmatter(frontmatter, file.body), id: proposal.id });
    } catch (cause) {
      left.push({ path: file.path, reason: messageWithoutPaths(cause) });
    }
  }
  return { planned, left };
}

/**
 * The proposals folder as this batch writes into it: the read given, or one
 * made now. A folder that is missing is made, as it is for the first proposal
 * written into it, and read again — what is there to number past is read
 * from the disk, and a folder that cannot be read stops the batch.
 */
async function folderToWrite(
  fs: VaultFsPort,
  read: ProposalsFolder | undefined,
): Promise<ProposalsFolder & { readonly folder: VaultPath }> {
  const before = read ?? (await readProposalsFolder({ fs }));
  if (before.folder !== null) return { ...before, folder: before.folder };
  const folder = await ensureFolder({ fs, folder: createVaultPath(PROPOSALS_FOLDER) });
  const entries = await fs.listDirectory(folder);
  return { folder, entries, notes: [] };
}

/**
 * Writes each proposal into `Inbox/Proposals/` as an open proposal note,
 * planned as {@link planProposals} says — so nothing is proposed twice. One
 * that cannot be written is said, and the rest are written.
 *
 * Each note is made only where nothing is (`createNote` never writes over a
 * file), so two runs that planned the same proposal at once — two rules on
 * one meeting — plan it at the same path, and the second finds it there: a
 * note at its path holding its id is the same proposal, made already, and is
 * neither written again nor said to have failed.
 */
export async function writeProposals(
  args: ProposalWritePorts & { proposals: readonly NewProposal[] },
): Promise<ProposalsWritten> {
  const { planned, left: unplanned } = await planProposals(args);
  const written: VaultPath[] = [];
  const left: ProposalLeft[] = [...unplanned];
  for (const note of planned) {
    try {
      await args.fs.createNote(note);
      written.push(note.path);
    } catch (cause) {
      // Unconfirmed when it cannot be read back: then the create's own error is what is said.
      if (await proposalMadeAlready(args, note).catch(() => false)) continue;
      left.push({ path: note.path, reason: messageWithoutPaths(cause) });
    }
  }
  return { written, left };
}

/** Whether the note at a planned proposal's path is that proposal: its id, written by a run alongside. */
export async function proposalMadeAlready(
  { fs, markdown }: Pick<ProposalWritePorts, 'fs' | 'markdown'>,
  note: Pick<PlannedProposal, 'path' | 'id'>,
): Promise<boolean> {
  const [there] = await fs.readNotes([note.path]);
  if (there === undefined) return false;
  const properties = markdown.frontmatterProperties(splitFrontmatter(there.text).frontmatter);
  return properties[PROPOSAL_ID_KEY] === note.id;
}

async function heldIds(
  index: Pick<IndexPort, 'query'>,
  proposals: readonly NewProposal[],
): Promise<Set<string>> {
  const { sql, parameters } = compileProposalIdsQuery(proposals.map(({ id }) => id));
  const result = await index.query(sql, parameters);
  const at = result.columns.indexOf('id');
  return new Set(result.rows.map((row) => String(row[at])));
}

/** The ids of the proposals waiting in the folder, read from the files. */
function waitingIds(
  markdown: ProposalWritePorts['markdown'],
  notes: ProposalsFolder['notes'],
): string[] {
  return notes.flatMap((note) => {
    const id = markdown.frontmatterProperties(splitFrontmatter(note.text).frontmatter)[
      PROPOSAL_ID_KEY
    ];
    return typeof id === 'string' ? [id] : [];
  });
}
