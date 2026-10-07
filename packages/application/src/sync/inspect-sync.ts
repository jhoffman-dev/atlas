import {
  enclosingRepositoryRefusal,
  GITIGNORE_PATH,
  isOwnRepository,
  isSetUpByAtlas,
  parseGitStatus,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { readVaultSettings } from '../settings/index.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { repositoryPlace, withPrograms } from './git-steps.ts';
import type { GitFoldersPort, GitPort } from './ports.ts';

/** Whether the open vault syncs, and with what. */
export type SyncSetup =
  | { readonly kind: 'not-set-up' }
  | { readonly kind: 'refused'; readonly reason: string }
  | {
      readonly kind: 'set-up';
      readonly remote: string;
      /** Commits fetched last time and not merged yet; 0 when unknown. */
      readonly behind: number;
    };

/**
 * Reads how the open vault stands with sync (U-29), writing nothing: set up
 * when it is a repository of its own with an `origin` and Atlas's mark — its
 * `.gitignore` block and `sync: github` in the settings (A29-01); refused when
 * it sits in another repository's work tree; otherwise not set up. A code
 * project or a vault kept with obsidian-git has an origin but not the mark,
 * and is never committed or pushed until the person connects it.
 */
export async function inspectSync({
  git,
  folders,
  fs,
  markdown,
  vaultRoot,
}: {
  git: GitPort;
  folders: GitFoldersPort;
  fs: Pick<VaultFsPort, 'readNotes'>;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'frontmatterProblem'>;
  vaultRoot: string;
}): Promise<SyncSetup> {
  return withPrograms(async () => {
    const place = await repositoryPlace({ git, folders, vaultRoot });
    const refusal = enclosingRepositoryRefusal(place);
    if (refusal !== null) return { kind: 'refused', reason: refusal };
    if (!isOwnRepository(place)) return { kind: 'not-set-up' };
    const [ignore] = await fs.readNotes([GITIGNORE_PATH]);
    const settings = await readVaultSettings({ fs, markdown });
    if (!isSetUpByAtlas({ settings, gitignore: ignore?.text ?? null })) {
      return { kind: 'not-set-up' };
    }
    const remote = await git.remoteUrl();
    if (remote.code !== 0 || remote.stdout.trim() === '') return { kind: 'not-set-up' };
    const status = await git.status();
    const behind = status.code === 0 ? parseGitStatus(status.stdout).behind : 0;
    return { kind: 'set-up', remote: remote.stdout.trim(), behind };
  });
}
