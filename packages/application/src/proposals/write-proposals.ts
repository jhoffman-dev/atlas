import {
  compileProposalIdsQuery,
  createVaultPath,
  isMarkdownFile,
  joinFrontmatter,
  messageWithoutPaths,
  nextAvailableNotePath,
  noteTitle,
  proposalFileFor,
  PROPOSAL_ID_KEY,
  PROPOSALS_FOLDER,
  splitFrontmatter,
  type NewProposal,
  type VaultEntry,
  type VaultPath,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { ensureFolder } from '../vault/create-folder.ts';
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

/** A proposal ready to be written: where, and what its note holds. */
export interface PlannedProposal {
  readonly path: VaultPath;
  readonly contents: string;
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
}: ProposalWritePorts & { proposals: readonly NewProposal[] }): Promise<ProposalsPlanned> {
  if (proposals.length === 0) return { planned: [], left: [] };
  const held = await heldIds(index, proposals);
  // Made if missing, as it is for the first proposal written into it: then it is empty.
  const folder = await ensureFolder({ fs, folder: createVaultPath(PROPOSALS_FOLDER) });
  const waiting = await fs.listDirectory(folder);
  for (const id of await waitingIds({ fs, markdown, waiting })) held.add(id);
  const taken = new Set<string>(waiting.map((entry) => entry.path));
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
      planned.push({ path, contents: joinFrontmatter(frontmatter, file.body) });
    } catch (cause) {
      left.push({ path: file.path, reason: messageWithoutPaths(cause) });
    }
  }
  return { planned, left };
}

/**
 * Writes each proposal into `Inbox/Proposals/` as an open proposal note,
 * planned as {@link planProposals} says — so nothing is proposed twice. One
 * that cannot be written is said, and the rest are written.
 */
export async function writeProposals(
  args: ProposalWritePorts & { proposals: readonly NewProposal[] },
): Promise<ProposalsWritten> {
  const { planned, left: unplanned } = await planProposals(args);
  const made = await writePlannedProposals(args.fs, planned);
  return { written: made.written, left: [...unplanned, ...made.left] };
}

/**
 * Writes proposals already planned, each as its note. One that cannot be
 * written is said, and the rest are written: for a step that must know where
 * its proposals will be before it writes them (linking records them on the
 * meeting in the write that adds its links).
 */
export async function writePlannedProposals(
  fs: Pick<VaultFsPort, 'createNote'>,
  planned: readonly PlannedProposal[],
): Promise<ProposalsWritten> {
  const written: VaultPath[] = [];
  const left: ProposalLeft[] = [];
  for (const note of planned) {
    try {
      await fs.createNote(note);
      written.push(note.path);
    } catch (cause) {
      left.push({ path: note.path, reason: messageWithoutPaths(cause) });
    }
  }
  return { written, left };
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
async function waitingIds({
  fs,
  markdown,
  waiting,
}: Pick<ProposalWritePorts, 'fs' | 'markdown'> & {
  waiting: readonly VaultEntry[];
}): Promise<string[]> {
  const read = await fs.readNotes(waiting.filter(isMarkdownFile).map((entry) => entry.path));
  return read.flatMap((note) => {
    const id = markdown.frontmatterProperties(splitFrontmatter(note.text).frontmatter)[
      PROPOSAL_ID_KEY
    ];
    return typeof id === 'string' ? [id] : [];
  });
}
