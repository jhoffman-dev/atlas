import { isDateLike } from '../index/property-value.ts';
import type { PropertyKind } from '../types/property-def.ts';
import { holdsLinks } from '../types/relation-names.ts';
import { THUMBNAIL_AUTO, THUMBNAIL_KEY } from '../thumbnails/page-thumbnail.ts';

/**
 * Keys "Add a property" never writes: `type` says what the note is, and `atlas`
 * marks a view, a dashboard or a source. Adding either empty would unmake that.
 * The rest are columns every note already has in the index — `title` among
 * them, which the page's own heading sets.
 */
const RESERVED_KEYS: readonly string[] = ['type', 'atlas', 'title', 'path', 'summary', 'modified'];

/** What "Add a property" makes of what was typed: the key to write, or why not. */
export type NewPropertyKey =
  | { readonly key: string; readonly problem: null }
  | { readonly key: null; readonly problem: string | null };

/**
 * The frontmatter key "Add a property" writes for what was typed, or why there
 * is nothing to add: blank, already in the file, reserved, or not a key YAML
 * frontmatter holds plainly. Spaces become underscores and capitals go, so
 * "Due date" lands as `due_date` — the key a type would give it — and reads
 * back as "Due date".
 *
 * `existing` must be every key the file holds, not only the rows on screen: a
 * key that is not shown is still in the file, and adding it writes an empty
 * value over it. `problem` is a sentence to show, or null while there is
 * nothing to say (blank, or a name still being typed).
 */
export function newPropertyKey(typed: string, existing: readonly string[]): NewPropertyKey {
  const written = typed.trim().replace(/\s+/g, '_');
  if (!/^[A-Za-z][\w-]*$/.test(written)) return { key: null, problem: null };
  const key = written.toLowerCase();
  if (RESERVED_KEYS.includes(key)) {
    return { key: null, problem: `“${written}” is kept for Atlas and cannot be added here` };
  }
  if (existing.some((name) => name.toLowerCase() === key)) {
    return { key: null, problem: `This note already has “${written}”` };
  }
  return { key, problem: null };
}

/**
 * What a property added to one note alone starts as. A checkbox starts unticked
 * and a list empty, so the value says what kind it is when the note is read
 * again; a thumbnail starts as `auto`, a picture of the page. Nothing else
 * can say, so it starts empty.
 */
export function newPropertyValue(kind: PropertyKind): unknown {
  if (kind === 'checkbox') return false;
  if (kind === 'thumbnail') return THUMBNAIL_AUTO;
  if (kind === 'multiSelect') return [];
  return '';
}

const WEB_ADDRESS = /^https?:\/\/\S+$/;

/**
 * The kind of a property no type declares, read from its value: a note's own
 * `signed: false` is a checkbox, not the text "false". A `thumbnail` holding
 * text, `false` or nothing (`thumbnail:` left empty, which means `auto`) is a
 * thumbnail: its key is all a note alone can say it by.
 */
export function notePropertyKind(value: unknown, key?: string): PropertyKind {
  if (key === THUMBNAIL_KEY && (typeof value === 'string' || value === false || value === null)) {
    return 'thumbnail';
  }
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  // Links name notes, and are shown as the notes they name.
  if (holdsLinks(value)) return 'relation';
  if (Array.isArray(value)) {
    return value.every((item) => typeof item === 'string') ? 'multiSelect' : 'text';
  }
  if (typeof value !== 'string') return 'text';
  const text = value.trim();
  if (isDateLike(text)) return 'date';
  if (WEB_ADDRESS.test(text)) return 'url';
  return 'text';
}
