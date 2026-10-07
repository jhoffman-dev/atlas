import { linkBreakingCharacter } from '../markdown/wikilink.ts';
import { cleanEntryName } from '../vault/new-note.ts';

/** The `type:` a person's note declares. */
export const PERSON_TYPE = 'person';

/**
 * Whether a note of this type is a person, whose page lists where they are
 * mentioned. Matched exactly, as the index matches `type:` for `@` — so a page
 * says "Mentioned in" for just the people `@` offers.
 */
export function isPersonType(typeName: string | null): boolean {
  return typeName === PERSON_TYPE;
}

/**
 * Why a person of this name could not be linked to, in the words a list or a
 * refusal shows — or null when they can be.
 */
export function unlinkableNameReason(name: string): string | null {
  const character = linkBreakingCharacter(name);
  return character === null ? null : `“${name}” cannot be linked: a link stops at ${character}`;
}

/**
 * Why a new person cannot be made of what was typed, or null — judged by the
 * name their note will be given, which is what a link to them has to hold.
 */
export function newPersonRefusal(typed: string): string | null {
  return unlinkableNameReason(cleanEntryName(typed));
}

/**
 * The letter a person's chip shows in place of a picture: the first letter or
 * digit of their name, capitalised — or `?` for a name with neither.
 */
export function personInitial(name: string): string {
  const letter = /[\p{L}\p{N}]/u.exec(name)?.[0];
  return letter === undefined ? '?' : letter.toLocaleUpperCase();
}
