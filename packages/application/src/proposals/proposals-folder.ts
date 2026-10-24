import {
  isMarkdownFile,
  isProposalNote,
  pendingTermOf,
  readProposal,
  splitFrontmatter,
  type PendingTerm,
  type VaultEntry,
  type VaultPath,
} from '@dfai/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import type { NoteFile, VaultFsPort } from '../vault/ports.ts';
import { proposalsFolderOf } from './list-proposals.ts';

/**
 * `Inbox/Proposals` as one read: its entries and the notes among them. A
 * Claude step reads it once a run and shares it between what it is told of
 * the terms waiting there (#19) and what it plans not to propose twice.
 */
export interface ProposalsFolder {
  /** As the disk spells it; null while the vault has none. */
  readonly folder: VaultPath | null;
  readonly entries: readonly VaultEntry[];
  readonly notes: readonly NoteFile[];
}

/** Reads the proposals folder once, making nothing: a vault with none reads as empty. */
export async function readProposalsFolder({ fs }: { fs: VaultFsPort }): Promise<ProposalsFolder> {
  const folder = await proposalsFolderOf(fs);
  if (folder === null) return { folder, entries: [], notes: [] };
  const entries = await fs.listDirectory(folder);
  const notes = await fs.readNotes(entries.filter(isMarkdownFile).map((entry) => entry.path));
  return { folder, entries, notes };
}

/** The open term proposals in a read of the folder, as a run is told of them. */
export function pendingTermsIn(
  { notes }: Pick<ProposalsFolder, 'notes'>,
  markdown: Pick<MarkdownPort, 'frontmatterProperties'>,
): PendingTerm[] {
  return notes.flatMap((note) => {
    const properties = markdown.frontmatterProperties(splitFrontmatter(note.text).frontmatter);
    if (!isProposalNote(properties)) return [];
    const reading = readProposal({ path: note.path as VaultPath, properties });
    const pending = reading.ok ? pendingTermOf(reading.proposal) : null;
    return pending === null ? [] : [pending];
  });
}
