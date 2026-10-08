import {
  createVaultPath,
  foldedVaultPath,
  isMarkdownFile,
  isProposalNote,
  PROPOSALS_FOLDER,
  readProposal,
  splitFrontmatter,
  vaultPathSegments,
  VAULT_ROOT,
  type ProposalNote,
  type VaultPath,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { listVaultDirectory } from '../vault/read-vault.ts';

/** An open proposal, and when its file last changed. */
export interface ListedProposal {
  readonly proposal: ProposalNote;
  readonly modified: number;
}

/** A proposal note that could not be read, and why — shown, never dropped. */
export interface UnreadableProposal {
  readonly path: VaultPath;
  readonly problem: string;
}

export interface ProposalListing {
  /** Newest first. */
  readonly open: readonly ListedProposal[];
  readonly unreadable: readonly UnreadableProposal[];
}

/**
 * The proposals waiting in `Inbox/Proposals/`: every note there of the
 * proposal type that is still open, newest first, and the ones that say they
 * are proposals but cannot be read. A note there of another type is not a
 * proposal and is left to the Inbox.
 */
export async function listProposals({
  fs,
  markdown,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
}): Promise<ProposalListing> {
  const folder = await proposalsFolderOf(fs);
  const paths =
    folder === null
      ? []
      : (await listVaultDirectory({ fs, path: folder }))
          .filter(isMarkdownFile)
          .map((entry) => entry.path);
  if (paths.length === 0) return { open: [], unreadable: [] };

  const open: ListedProposal[] = [];
  const unreadable: UnreadableProposal[] = [];
  for (const file of await fs.readNotes(paths)) {
    const { frontmatter } = splitFrontmatter(file.text);
    const problem = markdown.frontmatterProblem(frontmatter);
    const path = file.path as VaultPath;
    if (problem !== null) {
      unreadable.push({ path, problem: `Its frontmatter cannot be read: ${problem}` });
      continue;
    }
    const properties = markdown.frontmatterProperties(frontmatter);
    if (!isProposalNote(properties)) continue;
    const reading = readProposal({ path, properties });
    if (!reading.ok) unreadable.push({ path, problem: reading.problem });
    else if (reading.proposal.state === 'open') {
      open.push({ proposal: reading.proposal, modified: file.modified });
    }
  }
  return { open: open.sort(newestFirst), unreadable };
}

/**
 * `Inbox/Proposals` as the disk spells it, found a folder at a time — or null
 * while there is none, which is a vault with nothing proposed yet. Only the
 * one folder is read, not the whole vault: the sidebar counts it on every
 * change.
 */
async function proposalsFolderOf(fs: VaultFsPort): Promise<VaultPath | null> {
  let folder: VaultPath = VAULT_ROOT;
  for (const name of vaultPathSegments(createVaultPath(PROPOSALS_FOLDER))) {
    const wanted = foldedVaultPath(name);
    const entries = await fs.listDirectory(folder);
    const found = entries.find(
      (entry) => entry.kind === 'directory' && foldedVaultPath(entry.name) === wanted,
    );
    if (found === undefined) return null;
    folder = found.path;
  }
  return folder;
}

function newestFirst(left: ListedProposal, right: ListedProposal): number {
  return right.modified - left.modified || left.proposal.path.localeCompare(right.proposal.path);
}
