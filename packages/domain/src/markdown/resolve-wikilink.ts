import { createVaultPath, vaultPathName, type VaultPath } from '../vault/vault-path.ts';
import { isTemplateNote } from '../vault/vault-visibility.ts';

const MARKDOWN = /\.(md|markdown)$/i;

const withoutExtension = (name: string): string => name.replace(MARKDOWN, '');

/** Anything but printable ASCII, which composes to itself. */
const NOT_PLAIN_ASCII = /[^ -~\t\n\r]/;

/**
 * A name as links compare it: accents composed one way. macOS keyboards type
 * `ë` as one character, and files synced from elsewhere often spell it as `e`
 * and a combining mark; both are the same name to the person (A21-02).
 */
const composed = (name: string): string =>
  // Most names are plain ASCII, which composes to itself: skipping them keeps
  // resolving every link in a large vault as quick as it was.
  NOT_PLAIN_ASCII.test(name) ? name.normalize('NFC') : name;

/** A name as links compare it once exact spelling has failed: case folded too. */
const folded = (name: string): string => composed(name).toLowerCase();

/**
 * A link's target as links compare it loosely: extension dropped, accents
 * composed, case folded — what the index stores beside a relation, so SQL can
 * find the links a note could now answer without re-deciding how names fold.
 */
export function foldedLinkName(target: string): string {
  return folded(withoutExtension(target.trim()));
}

/** What a target is compared with in a note: its path when it has a slash, else its name. */
function comparedPart(note: VaultPath, byPath: boolean): string {
  return composed(withoutExtension(byPath ? note : vaultPathName(note)));
}

/**
 * Finds the note a wiki link points at, the way Obsidian does: a target with a
 * slash is a path, anything else is a filename that may live anywhere in the vault.
 *
 * When several notes share a name the shallowest wins, and ties are broken
 * alphabetically, so the same link always resolves to the same note. A name
 * spelled exactly wins over one matching only once case is folded.
 *
 * A template is never a link's target, by name or by path: it declares the
 * type it makes, and a link that opened it had the person rename and fill in
 * the template thinking it was the note (issue #15). The rest of `.atlas` — a
 * type definition, say — stays linkable, as any note is.
 */
export function resolveWikiLinkTarget(
  target: string,
  candidates: readonly VaultPath[],
): VaultPath | null {
  const wanted = target.trim();
  if (wanted === '') return null;
  const byPath = wanted.includes('/');
  const exact = composed(withoutExtension(wanted));
  const loose = exact.toLowerCase();
  const notes = candidates.filter((note) => !isTemplateNote(note));

  return (
    best(notes.filter((note) => comparedPart(note, byPath) === exact)) ??
    best(notes.filter((note) => comparedPart(note, byPath).toLowerCase() === loose))
  );
}

/**
 * `resolveWikiLinkTarget` over one fixed set of notes, answered from an index
 * built once — for drawing every link in a note, where searching the whole
 * vault per link, per keystroke, would be felt.
 */
export function createWikiLinkResolver(
  notes: readonly VaultPath[],
): (target: string) => VaultPath | null {
  const byName = groupBy(notes, (note) => folded(withoutExtension(vaultPathName(note))));
  const byPath = groupBy(notes, (note) => folded(withoutExtension(note)));
  return (target) => {
    const wanted = target.trim();
    if (wanted === '') return null;
    const index = wanted.includes('/') ? byPath : byName;
    const candidates = index.get(folded(withoutExtension(wanted))) ?? [];
    return resolveWikiLinkTarget(wanted, candidates);
  };
}

function groupBy(
  notes: readonly VaultPath[],
  keyOf: (note: VaultPath) => string,
): Map<string, VaultPath[]> {
  const groups = new Map<string, VaultPath[]>();
  for (const note of notes) {
    const key = keyOf(note);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [note]);
    else group.push(note);
  }
  return groups;
}

function best(candidates: readonly VaultPath[]): VaultPath | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((left, right) => {
    const depth = left.split('/').length - right.split('/').length;
    return depth !== 0 ? depth : left.localeCompare(right);
  })[0] as VaultPath;
}

/**
 * The note whose `[[Name]]` links a new note at `path` would open instead,
 * were it added among `notes` — or null when every link by name still opens
 * what it opened.
 *
 * Only the notes of the same name, as links compare names, can lose a link to
 * it, and checking a link spelled as each of them, and as the new note, is
 * enough: a link spelled some other way goes to the best of them all once
 * case is folded, and if the new note would be that, it would also win the
 * links spelled as itself.
 */
export function linkTakeover(path: VaultPath, notes: readonly VaultPath[]): VaultPath | null {
  const name = withoutExtension(vaultPathName(path));
  const namesakes = notes.filter(
    (note) => note !== path && folded(withoutExtension(vaultPathName(note))) === folded(name),
  );
  const spellings = new Set([
    name,
    ...namesakes.map((note) => withoutExtension(vaultPathName(note))),
  ]);
  const withNew = [...namesakes, path];
  for (const spelling of spellings) {
    const before = resolveWikiLinkTarget(spelling, namesakes);
    if (before !== null && resolveWikiLinkTarget(spelling, withNew) !== before) return before;
  }
  return null;
}

/**
 * What to write inside `[[…]]` so the link opens `path` among these notes:
 * its bare name when that resolves to it, and its path when the name alone
 * would open another note of the same name (or none at all).
 */
export function wikiLinkTargetFor(path: VaultPath, notes: readonly VaultPath[]): string {
  const name = withoutExtension(vaultPathName(path));
  return resolveWikiLinkTarget(name, notes) === path ? name : withoutExtension(path);
}

/** The path a new note would take if this link were followed and nothing matched. */
export function wikiLinkNewNotePath(target: string): VaultPath | null {
  const wanted = target.trim();
  if (wanted === '') return null;
  return createVaultPath(MARKDOWN.test(wanted) ? wanted : `${wanted}.md`);
}
