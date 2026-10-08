import { humanizeKey } from '../page/property-label.ts';
import { STATUS_TONES, type StatusTone } from '../page/status-tone.ts';
import type { SidebarIcon } from '../sidebar/sidebar-icon.ts';
import { TYPE_ICONS } from './type-icon.ts';
/**
 * What a property can be.
 *
 * Deliberately small: every kind here can be written into YAML frontmatter and
 * read back without ambiguity. Rollups and formulas are computed rather than
 * stored, so they arrive with the query layer rather than here.
 */
export type PropertyKind =
  | 'text'
  | 'number'
  | 'date'
  | 'checkbox'
  | 'select'
  | 'multiSelect'
  | 'url'
  | 'relation'
  | 'thumbnail';

export const PROPERTY_KINDS: readonly PropertyKind[] = [
  'text',
  'number',
  'date',
  'checkbox',
  'select',
  'multiSelect',
  'url',
  'relation',
  'thumbnail',
];

export interface PropertyDef {
  /** The frontmatter key this property is stored under. */
  readonly key: string;
  readonly kind: PropertyKind;
  readonly label: string;
  readonly required: boolean;
  /** For select and multiSelect. */
  readonly options: readonly string[];
  /**
   * For relation: the name of the type this property points at — the first,
   * when it may point at several. Read {@link relationTypes} for all of them.
   */
  readonly target: string | null;
  /**
   * For relation: every type it may point at, when that is more than one —
   * `target: [project, area]` in the type file. Absent for one, so the many
   * relations that point at a single type read exactly as they always have.
   */
  readonly targets?: readonly string[];
  /** For relation: whether it holds one note or several. */
  readonly many: boolean;
  /**
   * For select and multiSelect: the tone an option's pill is drawn in, where
   * the type chose one. An option without one is toned by its name.
   */
  readonly colors?: Readonly<Record<string, StatusTone>>;
  /**
   * For select: the option that means finished — what ticking a note's
   * checkbox sets. Written as `done: <option>` in the type file; see
   * `statusOf` for what a type without one falls back to.
   */
  readonly done?: string;
}

export interface ObjectType {
  /** Matches the `type:` value in a note's frontmatter. */
  readonly name: string;
  readonly label: string;
  readonly properties: readonly PropertyDef[];
  /** The glyph the type chose for itself; without one it is guessed from the name. */
  readonly icon?: SidebarIcon;
}

export class InvalidTypeError extends Error {
  constructor(reason: string) {
    super(`Invalid type definition: ${reason}`);
    this.name = 'InvalidTypeError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// A repeat is dropped: every consumer keys by option (board columns, a
// select's entries), and a hand-edited type file can list one twice.
const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.map((item) => String(item)))] : [];

/**
 * Reads a type definition out of the frontmatter of a file in `.atlas/types`.
 *
 * A malformed property is dropped rather than failing the whole type: one bad
 * line should cost you that property, not the ability to open your notes.
 */
export function parseObjectType(frontmatter: Record<string, unknown>): ObjectType {
  const name = String(frontmatter['name'] ?? '').trim();
  if (name === '') throw new InvalidTypeError('a type needs a name');

  const declared = frontmatter['properties'];
  const properties: PropertyDef[] = [];

  if (isRecord(declared)) {
    for (const [key, raw] of Object.entries(declared)) {
      const property = parseProperty(key, raw);
      if (property !== null) properties.push(property);
    }
  }

  const icon = TYPE_ICONS.find((candidate) => candidate === frontmatter['icon']);
  return {
    name,
    label: String(frontmatter['label'] ?? name),
    properties,
    ...(icon !== undefined && { icon }),
  };
}

function parseProperty(key: string, raw: unknown): PropertyDef | null {
  const trimmed = key.trim();
  if (trimmed === '') return null;

  // `status: select` is shorthand for `status: { kind: select }`.
  const spec = isRecord(raw) ? raw : { kind: raw };
  const kind = String(spec['kind'] ?? 'text') as PropertyKind;
  if (!PROPERTY_KINDS.includes(kind)) return null;

  const targets = parseTargets(spec['target']);
  const target = targets[0] ?? null;
  // A relation with nothing to point at cannot offer anything, so it is not one.
  if (kind === 'relation' && target === null) return null;

  const options = asStrings(spec['options']);
  const colors = parseColors(spec['colors'], options);
  const done = parseDone({ raw: spec['done'], kind, options });
  return {
    key: trimmed,
    kind,
    label: typeof spec['label'] === 'string' ? spec['label'] : humanizeKey(trimmed),
    required: spec['required'] === true,
    options,
    target,
    many: kind === 'multiSelect' || spec['many'] === true,
    ...(targets.length > 1 && { targets }),
    ...(colors !== null && { colors }),
    ...(done !== null && { done }),
  };
}

/**
 * The types a `target:` names: one written bare, or a list of them. A blank
 * entry, or one listed twice, is dropped, as a repeated option is.
 */
function parseTargets(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  const listed = Array.isArray(raw) ? raw : [raw];
  const names = listed.map((name) => String(name).trim()).filter((name) => name !== '');
  return [...new Set(names)];
}

/**
 * Every type a relation may point at, in the order the type file lists them;
 * empty for a property that is not a relation.
 */
export function relationTypes(def: Pick<PropertyDef, 'target' | 'targets'>): readonly string[] {
  if (def.targets !== undefined && def.targets.length > 0) return def.targets;
  return def.target === null ? [] : [def.target];
}

/**
 * What a relation points at, in words: `project`, `project or area`,
 * `person, company or project` — or `note` for one that names no type.
 */
export function relationTypesText(def: Pick<PropertyDef, 'target' | 'targets'>): string {
  const names = relationTypes(def);
  if (names.length === 0) return 'note';
  if (names.length === 1) return names[0] ?? 'note';
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1) ?? ''}`;
}

/**
 * The option a select names as finished. One it does not list is dropped, as
 * a colour for a missing option is: it could only ever mark nothing done.
 */
function parseDone({
  raw,
  kind,
  options,
}: {
  raw: unknown;
  kind: PropertyKind;
  options: readonly string[];
}): string | null {
  if (kind !== 'select' || raw === undefined || raw === null) return null;
  const done = String(raw);
  return options.includes(done) ? done : null;
}

/**
 * The tones chosen for a select's options. A tone that is not on the ramp, or
 * one for an option the property does not list, is dropped: it could only ever
 * colour something that is not there.
 */
function parseColors(
  raw: unknown,
  options: readonly string[],
): Readonly<Record<string, StatusTone>> | null {
  if (!isRecord(raw)) return null;
  const colors = Object.entries(raw).filter(
    (entry): entry is [string, StatusTone] =>
      options.includes(entry[0]) && STATUS_TONES.some((tone) => tone === entry[1]),
  );
  return colors.length === 0 ? null : Object.fromEntries(colors);
}
