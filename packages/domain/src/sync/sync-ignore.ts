/**
 * What a synced vault leaves out of git (U-29): the managed part of its
 * `.gitignore`.
 *
 * Everything else in the vault syncs — notes, attachments, `.atlas` and
 * `Chats/`. Secrets are in the Keychain and the Activity log and window state
 * are kept on each Mac outside the vault, so none of those are here to leave
 * out; what is here is what the vault folder itself holds for one Mac only.
 */

import { ATLAS_DIRECTORY } from '../vault/vault-visibility.ts';

export const GITIGNORE_PATH = '.gitignore';

const BEGIN = '# >>> Atlas sync (managed: edits between these lines are replaced)';
const END = '# <<< Atlas sync';

/** The lines Atlas keeps in the block, in order, each with why. */
export const MANAGED_IGNORES: readonly { readonly pattern: string; readonly why: string }[] = [
  { pattern: '.atlas-cache/', why: 'the index, which rebuilds itself on each Mac' },
  { pattern: '.DS_Store', why: "Finder's folder state" },
  { pattern: '.obsidian/workspace*.json', why: "Obsidian's per-Mac window state" },
  { pattern: '.trash/', why: "Obsidian's own trash" },
];

function managedBlock(): string {
  const lines = MANAGED_IGNORES.flatMap(({ pattern, why }) => [`# ${why}`, pattern]);
  return [BEGIN, ...lines, END].join('\n');
}

/** Whether a `.gitignore` holds Atlas's block, whole. */
export function hasManagedIgnores(text: string): boolean {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));
  const begin = lines.indexOf(BEGIN);
  return begin !== -1 && lines.indexOf(END, begin) !== -1;
}

/**
 * The person's own lines, with every Atlas block taken out. A block is only
 * the lines from its opening line to its closing one; an opening line with no
 * closing line before the next opening (or the end) is dropped alone, so a
 * line the person wrote after a damaged block is never taken with it.
 */
function withoutManagedBlocks(text: string): string[] {
  const lines = text.split('\n');
  const isLine = (line: string | undefined, marker: string) => line?.replace(/\r$/, '') === marker;
  const kept: string[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    if (!isLine(lines[at], BEGIN)) {
      kept.push(lines[at] ?? '');
      continue;
    }
    let end = at + 1;
    while (end < lines.length && !isLine(lines[end], END) && !isLine(lines[end], BEGIN)) end += 1;
    if (isLine(lines[end], END)) at = end;
  }
  return kept;
}

/**
 * The `.gitignore` with Atlas's block at its end, after the person's own
 * lines, which are never touched. The result is the same file a second time round.
 */
export function withManagedIgnores(existing: string | null): string {
  const block = managedBlock();
  const own = withoutManagedBlocks(existing ?? '')
    .join('\n')
    .replace(/[\r\n]+$/, '');
  return own.trim() === '' ? `${block}\n` : `${own}\n\n${block}\n`;
}

/** A gitignore glob as a pattern over one name or path: `*` stays within a folder. */
function globOf(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

/** Whether one of Atlas's own lines leaves the path out: that is Atlas's choice, not the person's. */
function ignoredByManagedBlock(path: string): boolean {
  const segments = path.split('/');
  return MANAGED_IGNORES.some(({ pattern }) => {
    if (pattern.endsWith('/')) return segments.slice(0, -1).includes(pattern.slice(0, -1));
    const glob = globOf(pattern);
    // A pattern with a slash is anchored at the vault's top; one without matches a name anywhere.
    return pattern.includes('/') ? glob.test(path) : glob.test(segments.at(-1) ?? '');
  });
}

/**
 * Atlas's own files that the vault's `.gitignore` keeps out of git (issue
 * #8): every file in `.atlas` on disk that git neither tracks nor lists as
 * untracked, past what Atlas's own block leaves out. Named as a file directly
 * in `.atlas`, otherwise as its folder there (`.atlas/types/`), once each.
 * Reported, never acted on: the person's lines are theirs.
 */
export function atlasPathsIgnored({
  onDisk,
  inGit,
}: {
  onDisk: readonly string[];
  /** What git sees: tracked, or untracked and not ignored. */
  inGit: ReadonlySet<string>;
}): readonly string[] {
  const named = new Set<string>();
  for (const path of onDisk) {
    if (inGit.has(path) || ignoredByManagedBlock(path)) continue;
    const [top, second, ...deeper] = path.split('/');
    if (top !== ATLAS_DIRECTORY || second === undefined) continue;
    named.add(deeper.length === 0 ? `${top}/${second}` : `${top}/${second}/`);
  }
  return [...named].sort();
}

/** The Activity log's warning for something of Atlas's own a `.gitignore` line keeps out. */
export function ignoredByGitignoreWarning(path: string): string {
  return `${path} is left out by a line in this vault’s .gitignore, so it isn’t synced and other Macs won’t get it. Atlas leaves your .gitignore as you wrote it; to sync it, remove that line.`;
}
