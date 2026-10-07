import { isArchivedPath } from '../archive/archive.ts';
import { isAtlasNote } from '../vault/vault-visibility.ts';
import { createWikiLinkResolver, wikiLinkTargetFor } from '../markdown/resolve-wikilink.ts';
import { linkBreakingCharacter } from '../markdown/wikilink.ts';
import { cleanEntryName } from '../vault/new-note.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { personInitial, unlinkableNameReason } from './person.ts';

/** A person's note, and when it last changed — the more recent, the likelier to be meant. */
export interface KnownPerson {
  readonly path: VaultPath;
  /** Milliseconds since the epoch, as the index has it. */
  readonly modified: number;
}

/**
 * What typing `@` and a name offers: someone already in the vault, someone
 * who is but whose name no link could hold, or a new person.
 */
export type MentionSuggestion =
  | {
      readonly kind: 'person';
      readonly path: VaultPath;
      readonly name: string;
      /** What the link is written as: the name, or the path when the name is shared. */
      readonly target: string;
    }
  | {
      readonly kind: 'unlinkable';
      readonly path: VaultPath;
      readonly name: string;
      /** Why no link is written, shown in place of where they live. */
      readonly reason: string;
    }
  | { readonly kind: 'create'; readonly name: string };

/** How many people are offered at once. */
const SHOWN = 8;

/** Longer than this, what follows `@` is a sentence rather than a name. */
const MOST_WORDS = 4;

/** Longer than this, what follows `@` is not offered as a new person's name. */
const MOST_NEW_WORDS = 3;

/** Punctuation that ends a name: `@Julie, can you…` is done at the comma. */
const ENDS_A_NAME = /[,;:!?()[\]{}"]/;

/**
 * A dot that ends a name: `@Bob.` or `@example.com`. One after an initial —
 * `J.R. Hartley` — is part of the name.
 */
const ENDS_WITH_A_DOT = /\p{L}{2,}\.|[^\p{L}\s.]\./u;

/**
 * People to offer for what has been typed after `@`.
 *
 * Nothing when it starts with a space (`@ ` is an at sign) or another `@`,
 * runs past a few words or reaches punctuation — the popup follows the words
 * typed, and a sentence carrying on after an `@` is not a name. Archived
 * people are not offered; `linkable` still counts them, so the link written
 * opens the note picked. Those whose name is what was typed come first, then
 * those whose name starts with it, then those with a word that does, then any
 * that contain it; the most recently changed first among equals. Names are
 * compared with their accents composed one way and case folded.
 *
 * Someone whose name holds a character no link can hold is still listed, with
 * why they cannot be linked, rather than left out without a word.
 *
 * "Create person" comes last: only for a name of a few words, that a link
 * could hold, when nobody has exactly that name — and not once a space closes
 * it. Enter never picks it by itself (the editor's rule): `@Julie ` and Enter
 * is a new line, never a new person.
 */
export function rankMentionSuggestions(
  query: string,
  {
    people,
    linkable,
    limit = SHOWN,
  }: { people: readonly KnownPerson[]; linkable: readonly VaultPath[]; limit?: number },
): readonly MentionSuggestion[] {
  if (!isNameSoFar(query)) return [];
  const wanted = comparable(query.trim());
  // The Person template declares `type: person` without being anyone (issue #15).
  const active = people.filter(
    (person) => !isArchivedPath(person.path) && !isAtlasNote(person.path),
  );
  const found = active
    .map((person) => ({ person, name: noteTitle(person.path) }))
    .map((known) => ({ ...known, score: scoreOf(comparable(known.name), wanted) }))
    .filter((known) => known.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.person.modified - left.person.modified ||
        left.name.localeCompare(right.name) ||
        left.person.path.localeCompare(right.person.path),
    )
    .slice(0, limit)
    .map(({ person, name }) => offered(person.path, name, linkable));

  const name = cleanEntryName(query);
  const taken = active.some((person) => comparable(noteTitle(person.path)) === comparable(name));
  return offersNewPerson(query, name) && !taken ? [...found, { kind: 'create', name }] : found;
}

/** A person as the list offers them: with the link to write, or why there is none. */
function offered(path: VaultPath, name: string, linkable: readonly VaultPath[]): MentionSuggestion {
  const reason = unlinkableNameReason(name);
  return reason === null
    ? { kind: 'person', path, name, target: wikiLinkTargetFor(path, linkable) }
    : { kind: 'unlinkable', path, name, reason };
}

/** Whether a new person may be made of what was typed, cleaned to `name`. */
function offersNewPerson(query: string, name: string): boolean {
  return (
    name !== '' &&
    !/\s$/.test(query) &&
    name.split(' ').length <= MOST_NEW_WORDS &&
    linkBreakingCharacter(query) === null
  );
}

/** Whether what follows `@` can still be the start of someone's name. */
function isNameSoFar(query: string): boolean {
  if (/^[\s@]/.test(query) || ENDS_A_NAME.test(query) || ENDS_WITH_A_DOT.test(query)) {
    return false;
  }
  return query.trim().split(/\s+/).length <= MOST_WORDS;
}

/** A name as `@` compares it: accents composed one way, case folded. */
function comparable(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

function scoreOf(name: string, query: string): number {
  if (query === '') return 1;
  if (name === query) return 4;
  if (name.startsWith(query)) return 3;
  if (name.split(/[\s-]+/).some((word) => word.startsWith(query))) return 2;
  return name.includes(query) ? 1 : 0;
}

/** How a link to a person is drawn: a chip with their initial beside their name. */
export interface PersonChip {
  readonly name: string;
  readonly initial: string;
}

/**
 * The chip for a `[[link]]`, when it opens a person's note — or null when it
 * opens someone else's note or nothing. The link is resolved as following it
 * would, so the chip never claims a note the link does not open.
 */
export function personChipFor(
  target: string,
  known: { people: ReadonlySet<string>; notes: readonly VaultPath[] },
): PersonChip | null {
  return personChipLookup(known)(target);
}

/**
 * `personChipFor` for one vault as it stands: the notes indexed once, and
 * each target's chip remembered — a note is drawn again as it is typed in,
 * and its links are the same few names over and over.
 */
export function personChipLookup({
  people,
  notes,
}: {
  people: ReadonlySet<string>;
  notes: readonly VaultPath[];
}): (target: string) => PersonChip | null {
  const resolve = createWikiLinkResolver(notes);
  const chips = new Map<string, PersonChip | null>();
  return (target) => {
    const remembered = chips.get(target);
    if (remembered !== undefined) return remembered;
    const path = resolve(target);
    const chip =
      path === null || !people.has(path)
        ? null
        : { name: noteTitle(path), initial: personInitial(noteTitle(path)) };
    chips.set(target, chip);
    return chip;
  };
}
