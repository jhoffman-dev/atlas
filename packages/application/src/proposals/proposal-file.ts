import {
  isProposalNote,
  isProposalPath,
  noteTitle,
  readProposal,
  splitFrontmatter,
  type MarkdownDocument,
  type ProposalNote,
  type VaultPath,
} from '@atlas/domain';
import { archiveNotes, type ArchivePorts } from '../archive/index.ts';
import { ProposalRefused } from '../chat/proposals.ts';
import { NoteChangedError } from '../notes/note-changed-error.ts';
import { noteModified } from '../notes/note-modified.ts';
import { listVaultNotes } from '../vault/read-vault.ts';

/**
 * What a proposal's accept, reject and undo reach: the vault, the markdown
 * port and the panes, as archiving does — a proposal is archived once it is
 * decided (ADR-0028).
 */
export type ProposalPorts = ArchivePorts;

/** A proposal note as read: what it proposes, and the file it was read from. */
export interface ProposalFile {
  readonly proposal: ProposalNote;
  readonly document: MarkdownDocument;
  readonly modified: number;
}

/** Where a decided proposal went: the Archive, or — when it could not move — where it was, and why. */
export interface ProposalArchived {
  readonly archivedAt: VaultPath | null;
  readonly archiveProblem: string | null;
}

/**
 * Reads the proposal at `path`, refusing what is not an open proposal in
 * `Inbox/Proposals/`: only those are waiting for an answer.
 */
export async function readOpenProposal(
  ports: Pick<ProposalPorts, 'fs' | 'markdown'>,
  path: VaultPath,
): Promise<ProposalFile> {
  if (!isProposalPath(path)) throw new ProposalRefused(`${path} is not in Inbox/Proposals.`);
  const { text, modified } = await ports.fs.readTextFile(path).catch(() => {
    // Gone or unreadable: either way there is no proposal there to answer.
    throw new ProposalRefused(`There is no proposal at ${path}.`);
  });
  const document = splitFrontmatter(text);
  const properties = ports.markdown.frontmatterProperties(document.frontmatter);
  if (!isProposalNote(properties)) throw new ProposalRefused(`${path} is not a proposal.`);
  const reading = readProposal({ path, properties });
  if (!reading.ok) throw new ProposalRefused(reading.problem);
  if (reading.proposal.state !== 'open') {
    throw new ProposalRefused(`It was already ${reading.proposal.state}.`);
  }
  return { proposal: reading.proposal, document, modified };
}

/** Refuses a note a pane holds unsaved typing for: typing is never written over or moved. */
export function refuseUnsaved(editors: ProposalPorts['editors'], path: VaultPath): void {
  if (editors.state(path) === 'dirty') {
    throw new ProposalRefused(
      `${noteTitle(path)} has unsaved typing; save it first, so nothing you typed is written over.`,
    );
  }
}

/**
 * Writes `changes` into the proposal's frontmatter, keeping every other byte,
 * against the version that was read: a proposal changed since is refused.
 */
export async function stampProposal(
  ports: Pick<ProposalPorts, 'fs' | 'markdown' | 'editors'>,
  file: Pick<ProposalFile, 'document' | 'modified'> & { readonly path: VaultPath },
  changes: Readonly<Record<string, unknown>>,
): Promise<void> {
  const { document, path } = file;
  try {
    await ports.fs.writeTextFile({
      path,
      contents: ports.markdown.updateFrontmatter(document.frontmatter, changes) + document.body,
      expectedModified: file.modified,
    });
  } catch (error) {
    // However the host worded it, a proposal that moved on since it was read is the reason.
    const changed =
      error instanceof NoteChangedError ||
      (await noteModified({ fs: ports.fs, path })) !== file.modified;
    if (changed) throw new ProposalRefused('The proposal changed since it was read.');
    throw error;
  }
  ports.editors.reload(path);
}

/**
 * Files a decided proposal in the Archive. A proposal that cannot move is
 * still decided — its `state` says so, and the Inbox lists only open ones —
 * so the reason is handed back rather than thrown.
 */
export async function archiveProposal({
  ports,
  path,
  today,
}: {
  ports: ProposalPorts;
  path: VaultPath;
  today: string;
}): Promise<ProposalArchived> {
  const notePaths = await listVaultNotes({ fs: ports.fs });
  const outcome = await archiveNotes({
    ports,
    paths: [path],
    notePaths,
    today,
    unsavedTyping: 'leave',
  });
  const moved = outcome.moves[0]?.move.to ?? null;
  return { archivedAt: moved, archiveProblem: outcome.failed[0]?.reason ?? null };
}
