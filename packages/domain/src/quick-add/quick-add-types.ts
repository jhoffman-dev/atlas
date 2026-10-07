import type { ObjectType } from '../types/property-def.ts';
import { ATLAS_DIRECTORY } from '../vault/vault-visibility.ts';

/** The note a vault keeps its own settings in, as frontmatter. */
export const VAULT_SETTINGS_PATH = `${ATLAS_DIRECTORY}/settings.md`;

/** The settings key that lists the types the add button offers, in order. */
export const QUICK_ADD_KEY = 'quickAdd';

/** How many types the add button offers at most: more is a menu, not a shortcut. */
export const QUICK_ADD_LIMIT = 5;

/** The type offered when a vault has said nothing: the thing most often added. */
export const QUICK_ADD_DEFAULT = 'task';

/**
 * The types a vault's settings list for the add button, or null when the key
 * is not there at all — which is different from an empty list, the person
 * having taken every type away.
 *
 * A hand-edited file can hold anything: a lone name is read as a list of one,
 * blanks and repeats are dropped, and only the first five count.
 */
export function parseQuickAdd(value: unknown): readonly string[] | null {
  if (value === undefined || value === null) return null;
  const listed = Array.isArray(value) ? value : [value];
  const names = listed
    .filter((item) => typeof item === 'string' || typeof item === 'number')
    .map((item) => String(item).trim())
    .filter((name) => name !== '');
  return [...new Set(names)].slice(0, QUICK_ADD_LIMIT);
}

/** What the add button offers, and what the settings name that the vault no longer has. */
export interface QuickAddChoice {
  /** The types to offer, in the settings' order. */
  readonly types: readonly ObjectType[];
  /** Names the settings list that match no type — skipped, and flagged in Settings. */
  readonly missing: readonly string[];
}

/**
 * The types the add button offers, given what the settings say and the types
 * the vault defines.
 *
 * Unset means Task, when the vault has a task type, and nothing otherwise. A
 * name that matches no type any more is skipped rather than offered: picking
 * it could only make a note of a type that does not exist.
 */
export function quickAddChoice({
  configured,
  types,
}: {
  configured: readonly string[] | null;
  types: readonly ObjectType[];
}): QuickAddChoice {
  const names = configured ?? [QUICK_ADD_DEFAULT];
  const found: ObjectType[] = [];
  const missing: string[] = [];
  for (const name of names.slice(0, QUICK_ADD_LIMIT)) {
    const type = types.find((candidate) => candidate.name === name);
    if (type !== undefined) found.push(type);
    else if (configured !== null) missing.push(name);
  }
  return { types: found, missing };
}

/** The list the settings start from when the person first changes it: what is offered now. */
export function quickAddStart({
  configured,
  types,
}: {
  configured: readonly string[] | null;
  types: readonly ObjectType[];
}): readonly string[] {
  if (configured !== null) return configured;
  return quickAddChoice({ configured, types }).types.map((type) => type.name);
}

/** Adds a type to the end of the list; refused (the list unchanged) when it is full or already there. */
export function withQuickAddType(list: readonly string[], name: string): readonly string[] {
  if (list.length >= QUICK_ADD_LIMIT || list.includes(name)) return list;
  return [...list, name];
}

/** Takes a type out of the list. */
export function withoutQuickAddType(list: readonly string[], name: string): readonly string[] {
  return list.filter((listed) => listed !== name);
}

/** Moves a type to another place in the list; a place past either end is clamped to it. */
export function movedQuickAddType({
  list,
  name,
  to,
}: {
  list: readonly string[];
  name: string;
  to: number;
}): readonly string[] {
  const from = list.indexOf(name);
  if (from === -1) return list;
  const rest = list.filter((listed) => listed !== name);
  const at = Math.max(0, Math.min(to, rest.length));
  return [...rest.slice(0, at), name, ...rest.slice(at)];
}
