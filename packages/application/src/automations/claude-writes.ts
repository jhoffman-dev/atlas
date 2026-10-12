import {
  claudeProposalId,
  CLAUDE_PROPOSAL_ID_KEY,
  cleanEntryName,
  compileClaudeProposalIdsQuery,
  createVaultPath,
  fitFileNameStem,
  isMarkdownFile,
  joinFrontmatter,
  nextAvailableNotePath,
  PROPOSALS_FOLDER,
  proposalNoteProperties,
  splitFrontmatter,
  type CheckedProposal,
  type DoneAction,
  type NoteAnswer,
  type VaultPath,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { ensureFolder } from '../vault/create-folder.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** What a Claude step writes with: the rule's guarded vault, and the index to ask what was already proposed. */
export interface ClaudeWritePorts {
  readonly fs: VaultFsPort;
  readonly index: Pick<IndexPort, 'query'>;
  readonly markdown: Pick<MarkdownPort, 'updateFrontmatter' | 'frontmatterProperties'>;
}

/** A note ready to be written: where, what it holds, and what the log says of it. */
export interface PlannedNote {
  readonly path: VaultPath;
  readonly contents: string;
  readonly made: DoneAction;
}

/**
 * The room a numbered name needs after a title: ` 99.md`. A title is cut by
 * whole characters until its file name, numbered past a name taken, fits what
 * a disk takes.
 */
const NUMBERED_ENDING = ' 9999.md';

/**
 * Every proposal as a note in `Inbox/Proposals/`, decided before the first is
 * written: its name (cut to what a disk takes, numbered past every name
 * taken), its contents, and whether it is a proposal already made — by an
 * earlier run, open or answered, or earlier in this answer. Those are left
 * out, so a step that runs again proposes nothing twice.
 */
export async function planProposals({
  ports,
  notePaths,
  proposals,
  rule,
  madeBy,
}: {
  ports: ClaudeWritePorts;
  notePaths: readonly VaultPath[];
  proposals: readonly CheckedProposal[];
  /** The rule's id: what its proposals are for. */
  rule: string;
  madeBy: string;
}): Promise<PlannedNote[]> {
  if (proposals.length === 0) return [];
  const ids = proposals.map((proposal) => claudeProposalId({ rule, proposal }));
  const folder = await ensureFolder({ fs: ports.fs, folder: createVaultPath(PROPOSALS_FOLDER) });
  const held = await heldIds({ ports, ids, folder });
  const taken = new Set<string>(notePaths);
  const planned: PlannedNote[] = [];
  for (const [at, proposal] of proposals.entries()) {
    const id = ids[at]!;
    if (held.has(id)) continue;
    held.add(id);
    const name = fitFileNameStem(cleanEntryName(proposal.payload.title), NUMBERED_ENDING);
    const path = nextAvailableNotePath({ folder, name, taken });
    taken.add(path);
    const frontmatter = ports.markdown.updateFrontmatter(
      null,
      proposalNoteProperties({ proposal, madeBy, id }),
    );
    const body = proposal.why === '' ? '' : `${proposal.why}\n`;
    planned.push({
      path,
      contents: joinFrontmatter(frontmatter, body),
      made: { kind: 'proposed', path },
    });
  }
  return planned;
}

/** The one new note, in the rule's folder; a name already taken is numbered past, never written over. */
export async function planNote({
  ports,
  notePaths,
  folder,
  note,
}: {
  ports: ClaudeWritePorts;
  notePaths: readonly VaultPath[];
  folder: VaultPath;
  note: NoteAnswer;
}): Promise<PlannedNote> {
  const at = await ensureFolder({ fs: ports.fs, folder });
  const name = fitFileNameStem(cleanEntryName(note.title), NUMBERED_ENDING);
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

/** The ids already on a proposal in the vault: the index for every one, answered and archived too, and the folder's files for any it has not caught up with. */
async function heldIds({
  ports,
  ids,
  folder,
}: {
  ports: ClaudeWritePorts;
  ids: readonly string[];
  folder: VaultPath;
}): Promise<Set<string>> {
  const { sql, parameters } = compileClaudeProposalIdsQuery(ids);
  const result = await ports.index.query(sql, parameters);
  const at = result.columns.indexOf('id');
  const held = new Set(result.rows.map((row) => String(row[at])));
  // The index lags a write made a moment ago: the proposals waiting now are read from their files.
  for (const id of await waitingIds({ ports, folder })) held.add(id);
  return held;
}

async function waitingIds({
  ports,
  folder,
}: {
  ports: Pick<ClaudeWritePorts, 'fs' | 'markdown'>;
  folder: VaultPath;
}): Promise<string[]> {
  const notes = (await ports.fs.listDirectory(folder)).filter(isMarkdownFile);
  const read = await ports.fs.readNotes(notes.map((entry) => entry.path));
  return read.flatMap(({ text }) => {
    const id = ports.markdown.frontmatterProperties(splitFrontmatter(text).frontmatter)[
      CLAUDE_PROPOSAL_ID_KEY
    ];
    return typeof id === 'string' ? [id] : [];
  });
}
