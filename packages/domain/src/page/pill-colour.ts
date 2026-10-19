import type { PropertyDef } from '../types/property-def.ts';
import { isKnownStatus, statusTone, STATUS_TONES, type StatusTone } from './status-tone.ts';

/**
 * The muted pastels a pill is drawn in where the colour only helps the eye
 * find a value again — a meeting's kind, a company, a tag — as against a
 * status, whose tone means something (#413). Notion's nine, in its order.
 */
export type PillHue =
  'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red';

export const PILL_HUES: readonly PillHue[] = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
];

/**
 * The hues a value's name can hash to. Gray is left out: a hashed pill in
 * gray reads as "not coloured", which is the look #413 exists to undo. It
 * can still be chosen in a type file.
 */
export const HASHED_HUES: readonly PillHue[] = PILL_HUES.filter((hue) => hue !== 'gray');

/** What a select's option can be drawn in: a status tone, or a palette hue. */
export type OptionColor = StatusTone | PillHue;

/** The colours a type chose for one property's options, by option. */
export type OptionColors = Readonly<Record<string, OptionColor>>;

/** Every colour an option can be given, tones first: what a type file's `colors:` accepts. */
export const OPTION_COLORS: readonly OptionColor[] = [...STATUS_TONES, ...PILL_HUES];

export function isPillHue(value: unknown): value is PillHue {
  return PILL_HUES.some((hue) => hue === value);
}

export function isOptionColor(value: unknown): value is OptionColor {
  return OPTION_COLORS.some((color) => color === value);
}

/** How a name is read for its hue: as a person reads it, so "Mara Quill" and "mara quill " agree. */
const folded = (name: string): string => name.trim().toLowerCase();

// A table asks for the same few names row after row, so each is hashed once.
// Bounded so a vault of many distinct values cannot grow it without end.
const HASH_CACHE_LIMIT = 4096;
const hashed = new Map<string, PillHue>();

/**
 * A stable hue for a name: FNV-1a over its folded text, so the same value is
 * the same colour in every table, board, panel and session. Changing the hash
 * recolours every vault; the tests pin it.
 */
export function hueOf(name: string): PillHue {
  const key = folded(name);
  const known = hashed.get(key);
  if (known !== undefined) return known;
  if (hashed.size >= HASH_CACHE_LIMIT) hashed.clear();
  const hue = HASHED_HUES[nameHash(key) % HASHED_HUES.length] ?? 'gray';
  hashed.set(key, hue);
  return hue;
}

/**
 * 32-bit FNV-1a, finished with murmur3's mix: FNV alone leaves its low bits
 * — the ones a modulus reads — ruled by the last character, so names sharing
 * an ending crowd one hue.
 */
function nameHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/**
 * The colour an option's pill is drawn in, wherever it is drawn: the one the
 * type file chose; else, for a status the ramp knows, its tone; else a stable
 * hue from its value. No value at all is the quiet backlog grey.
 */
export function optionColor(
  property: { readonly colors?: OptionColors | undefined } | null,
  option: string,
): OptionColor {
  const chosen = property?.colors?.[option];
  if (chosen !== undefined) return chosen;
  if (option.trim() === '' || isKnownStatus(option)) return statusTone(option);
  return hueOf(option);
}

/**
 * A relation's chip colour: the linked note's own `color` property when it
 * names a hue, else a stable hue from the note's name.
 */
export function relationHue({ name, color }: { name: string; color?: unknown }): PillHue {
  const own = typeof color === 'string' ? color.trim().toLowerCase() : null;
  return isPillHue(own) ? own : hueOf(name);
}

/** A tag's colour, the same with or without its `#`. */
export function tagHue(tag: string): PillHue {
  return hueOf(tag.trim().replace(/^#/, ''));
}

/**
 * The options a multi-select holds, each its own pill: a list as the file
 * writes it, or the one cell a view joins a list into ("a, b").
 */
export function heldOptions(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const items = Array.isArray(value) ? value.map(String) : String(value).split(',');
  return items.map((item) => item.trim()).filter((item) => item !== '');
}

/**
 * Each property's chosen option colours, by key, for a view that draws many
 * properties' pills. A property that chose none is left out. Each map is the
 * property's own object, so a view handed this anew can tell it has not changed.
 */
export function optionColorsByKey(
  properties: Iterable<Pick<PropertyDef, 'key' | 'colors'>>,
): Readonly<Record<string, OptionColors>> {
  const byKey: Record<string, OptionColors> = {};
  for (const { key, colors } of properties) if (colors !== undefined) byKey[key] = colors;
  return byKey;
}
