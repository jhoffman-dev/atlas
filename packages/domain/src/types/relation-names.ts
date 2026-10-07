import { resolveWikiLinkTarget, wikiLinkTargetFor } from '../markdown/resolve-wikilink.ts';
import { splitWikiLinks, type WikiLink } from '../markdown/wikilink.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { isWikiLink } from './property-value.ts';

/** A note as it is listed everywhere: where it is, and its title (`pageTitle`). */
export interface NamedNote {
  readonly path: VaultPath;
  readonly title: string;
}

/** A link in a relation's value, as it is shown. */
export interface LinkedName {
  /** The linked note's title, the link's alias, or — pointing nowhere — its bare name. */
  readonly text: string;
  /** The note the link opens; null when nothing in the vault answers to it. */
  readonly path: VaultPath | null;
  /** Whether the link points at no note, and is drawn as missing. */
  readonly missing: boolean;
}

/** The vault's notes by name, as a relation's links are read against them. */
export interface NoteNames {
  /** How one link reads. */
  name(link: WikiLink): LinkedName;
  /** The note a link written as `[[…]]` opens, or null. */
  opens(link: string): VaultPath | null;
  /** The `[[…]]` that links this note, the way a relation is written. */
  linkTo(path: VaultPath): string;
}

const MARKDOWN = /\.(md|markdown)$/i;

/** A link's target without its folders or extension: what it is called. */
const bareName = (target: string): string =>
  (target.split('/').at(-1) ?? '').trim().replace(MARKDOWN, '');

/**
 * The notes a relation's links are named by, resolved the way a wiki link in
 * the text is — so a relation opens the note its link would.
 *
 * Given null while the notes are not known yet, every link reads as its bare
 * name and none is called missing: not having looked is not having found
 * nothing.
 */
export function noteNames(notes: readonly NamedNote[] | null): NoteNames {
  const titles = new Map((notes ?? []).map((note) => [note.path, note.title]));
  const paths = [...titles.keys()];
  // A table resolves the same few links row after row.
  const resolved = new Map<string, VaultPath | null>();
  const resolve = (target: string): VaultPath | null => {
    if (!resolved.has(target)) resolved.set(target, resolveWikiLinkTarget(target, paths));
    return resolved.get(target) ?? null;
  };

  const name = (link: WikiLink): LinkedName => {
    const path = notes === null ? null : resolve(link.target);
    const title = path === null ? bareName(link.target) : (titles.get(path) ?? '');
    return {
      text: link.alias?.trim() || title || bareName(link.target),
      path,
      missing: notes !== null && path === null,
    };
  };

  return {
    name,
    opens: (link) => {
      const [piece] = splitWikiLinks(link.trim());
      return piece?.kind === 'wikiLink' ? name(piece).path : null;
    },
    linkTo: (path) => `[[${wikiLinkTargetFor(path, paths)}]]`,
  };
}

const itemsOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value])
    .filter((item) => item !== null && item !== undefined)
    .map((item) => String(item));

/**
 * Every link in a relation's value, in order, as it is shown — whether the
 * value is one link, a list of them, or the one cell a view joins a list into.
 */
export function linkedNames(value: unknown, names: NoteNames): LinkedName[] {
  return itemsOf(value).flatMap((item) =>
    splitWikiLinks(item).flatMap((piece) => (piece.kind === 'wikiLink' ? [names.name(piece)] : [])),
  );
}

/**
 * A value as text a person reads: each link in it written as the note it
 * names, the text around the links kept, a list's items joined with commas.
 */
export function withNoteNames(value: unknown, names: NoteNames): string {
  return itemsOf(value)
    .map((item) =>
      splitWikiLinks(item)
        .map((piece) => (piece.kind === 'wikiLink' ? names.name(piece).text : piece.value))
        .join(''),
    )
    .join(', ');
}

/**
 * Whether a value is a relation's, whatever its key is declared as: a link,
 * or a list of nothing but links. A key the type does not declare is read by
 * what it holds, and this holds notes.
 */
export function holdsLinks(value: unknown): boolean {
  const items = Array.isArray(value) ? value : [value];
  return items.length > 0 && items.every((item) => typeof item === 'string' && isWikiLink(item));
}
