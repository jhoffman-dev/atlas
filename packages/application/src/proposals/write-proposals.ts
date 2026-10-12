import {
  compileProposalIdsQuery,
  createVaultPath,
  isMarkdownFile,
  joinFrontmatter,
  messageWithoutPaths,
  nextAvailableNotePath,
  noteTitle,
  parentVaultPath,
  proposalFileFor,
  PROPOSAL_ID_KEY,
  PROPOSALS_FOLDER,
  splitFrontmatter,
  type NewProposal,
  type VaultPath,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { ensureFolder } from '../vault/create-folder.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** What writing proposals did: each one written, and each one that could not be, and why. */
export interface ProposalsWritten {
  readonly written: readonly VaultPath[];
  readonly left: readonly { readonly path: VaultPath; readonly reason: string }[];
}

/**
 * Writes each proposal into `Inbox/Proposals/` as an open proposal note
 * (ADR-0028) — unless one for the same thing is already in the vault, open
 * or answered: a rejection is an answer, and a step that runs again proposes
 * nothing twice. The index is asked where they are, and the path each would
 * take is read too, since the index lags a write made a moment ago. A name
 * another note holds is numbered. One that cannot be written is said, and the
 * rest are written.
 */
export async function writeProposals({
  fs,
  index,
  markdown,
  proposals,
}: {
  fs: VaultFsPort;
  index: Pick<IndexPort, 'query'>;
  markdown: Pick<MarkdownPort, 'updateFrontmatter' | 'frontmatterProperties'>;
  proposals: readonly NewProposal[];
}): Promise<ProposalsWritten> {
  if (proposals.length === 0) return { written: [], left: [] };
  const held = await heldIds(index, proposals);
  // The index lags a write made a moment ago: the proposals waiting now are read too.
  for (const id of await waitingIds({ fs, markdown })) held.add(id);
  const written: VaultPath[] = [];
  const left: { path: VaultPath; reason: string }[] = [];
  const taken = new Set<string>();
  for (const proposal of proposals) {
    if (held.has(proposal.id)) continue;
    const file = proposalFileFor(proposal);
    try {
      const path = await freePath(fs, file.path, taken);
      const contents = joinFrontmatter(
        markdown.updateFrontmatter(null, file.properties),
        file.body,
      );
      await fs.createNote({ path, contents });
      taken.add(path);
      held.add(proposal.id);
      written.push(path);
    } catch (cause) {
      left.push({ path: file.path, reason: messageWithoutPaths(cause) });
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

/** The ids of the proposals waiting in the folder these would be written to, read from the files. */
async function waitingIds(ports: {
  fs: VaultFsPort;
  markdown: Pick<MarkdownPort, 'frontmatterProperties'>;
}): Promise<string[]> {
  // Made if missing, as it is for the first proposal written into it: then it is empty.
  const folder = await ensureFolder({ fs: ports.fs, folder: createVaultPath(PROPOSALS_FOLDER) });
  const entries = await ports.fs.listDirectory(folder);
  const notes = entries.filter(isMarkdownFile);
  const read = await ports.fs.readNotes(notes.map((entry) => entry.path));
  return read.flatMap((note) => {
    const id = ports.markdown.frontmatterProperties(splitFrontmatter(note.text).frontmatter)[
      PROPOSAL_ID_KEY
    ];
    return typeof id === 'string' ? [id] : [];
  });
}

/** The proposal's path, in a folder made if it is missing — numbered when another note has it. */
async function freePath(
  fs: VaultFsPort,
  wanted: VaultPath,
  taken: Set<string>,
): Promise<VaultPath> {
  const folder = await ensureFolder({ fs, folder: parentVaultPath(wanted) });
  const there = await fs.listDirectory(folder);
  for (const entry of there) taken.add(entry.path);
  return nextAvailableNotePath({ folder, name: noteTitle(wanted), taken });
}
