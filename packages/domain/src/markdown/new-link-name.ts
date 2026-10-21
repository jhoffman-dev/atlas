import { cleanEntryName, noteFileName } from '../vault/new-note.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { linkBreakingCharacter } from './wikilink.ts';

/** A note that may be made of what was typed, and linked — or why not. */
export type NewLinkName = { readonly name: string } | { readonly refused: string };

/**
 * Whether a note may be made of a name typed where a link is set (#465) —
 * the one rule for every "Create" that makes a note to link: `[[` in the
 * editor, a link field's picker, and `@`.
 *
 * Refused when nothing is typed; when the name holds a character a link
 * reads as its own (`# ^ [ ] |`) or `/`, a folder — the link written to it
 * would not read back as one; when nothing is left of it once a file name is
 * made of it; and when a note already answers to it — by the name typed, or
 * by the name its file would be given (`Q3: plan` is `Q3 plan`, `Garden.`
 * is `Garden`) — so the note there is linked, not a second one made beside
 * it. What answers is the caller's to say (`answers`): any note, archived
 * ones too, and any being made.
 */
export function newLinkName(typed: string, answers: (name: string) => boolean): NewLinkName {
  const name = typed.trim();
  if (name === '') return { refused: 'Type a name to make a note of it.' };
  const breaking = name.includes('/') ? '/' : linkBreakingCharacter(name);
  if (breaking !== null) {
    return { refused: `“${name}” cannot be linked: a link stops at ${breaking}` };
  }
  if (cleanEntryName(name) === '') return { refused: 'Give the new note a name.' };
  const fileName = noteTitle(createVaultPath(noteFileName(name)));
  if (answers(name) || answers(fileName)) {
    return { refused: `A note is already called “${fileName}”.` };
  }
  return { name };
}
