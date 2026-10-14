import { DAILY_TYPE_FILE } from '../daily/daily-note.ts';
import { MEETING_TYPE } from '../meetings/meeting-header.ts';
import { MEETING_EXTRACTION_PROPERTIES } from '../meetings/meeting-extraction-properties.ts';
import { MEETING_IMPORT_PROPERTIES } from '../meetings/meeting-import-properties.ts';
import { PROPOSAL_TYPE_FILES } from '../proposals/proposal-types.ts';
import { BLOCK_TYPE_FILE } from '../timeblocks/block-type.ts';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { ATLAS_DIRECTORY } from '../vault/vault-visibility.ts';
import { listed } from './para.ts';
import type { ObjectType, PropertyDef } from './property-def.ts';

/**
 * The properties Atlas ships on its own built-in types, by the type's name
 * (#162, ADR-0016's amendment of 2026-10-14). A file written before Atlas
 * shipped one of them lacks it, and a feature built on it fails — Accept on a
 * meeting's action item, for one, links through the Meeting type's `tasks`.
 *
 * Only Atlas's own types are here: Meeting, Proposal, Decision, Daily and
 * Block. Project, Area and Resource are PARA's, and Task's keys come with the
 * move to GTD (ADR-0029): a vault may have shaped them its own way, so what
 * they would gain stays an offer, never done without a yes.
 *
 * Meeting is here though Atlas writes no Meeting file: the import writes its
 * keys (ADR-0027) and meeting extraction links through its relations (P29-05).
 */
const SHIPPED: ReadonlyMap<string, readonly PropertyDef[]> = new Map([
  ...[...PROPOSAL_TYPE_FILES, DAILY_TYPE_FILE, BLOCK_TYPE_FILE].map(
    (file) => [file.type.name, file.type.properties] as const,
  ),
  [MEETING_TYPE, [...MEETING_IMPORT_PROPERTIES, ...MEETING_EXTRACTION_PROPERTIES]],
]);

/**
 * What adding the shipped properties has done in a vault, kept in the vault so
 * it is done once — on whichever Mac opens it first — and a key the person
 * takes off afterwards stays off. Keyed by type name.
 */
export interface ShippedPropertiesRecord {
  /** The shipped keys each type has been given or was found to have. */
  readonly settled: Readonly<Record<string, readonly string[]>>;
  /** The keys Atlas wrote into each type's file. */
  readonly added: Readonly<Record<string, readonly string[]>>;
}

export const NO_SHIPPED_PROPERTIES_RECORD: ShippedPropertiesRecord = { settled: {}, added: {} };

/** Where the record is kept, beside the other migrations' (ADR-0029). */
export const SHIPPED_PROPERTIES_RECORD_PATH: VaultPath = createVaultPath(
  `${ATLAS_DIRECTORY}/migrations/type-properties.md`,
);

/**
 * A built-in type of the vault's whose shipped keys are not all settled yet.
 * `added` is what its file lacks and gains; empty when the file has them all,
 * and the type is only to be recorded as settled.
 */
export interface ShippedPropertiesChange<Type extends ObjectType = ObjectType> {
  readonly before: Type;
  readonly after: ObjectType;
  readonly added: readonly PropertyDef[];
}

/** A vault's type name as the disk compares its file's: in any case. */
const folded = (name: string) => name.trim().toLowerCase();

/** The keys a record holds for a type: its own entry, never one the object inherits. */
export function keysRecorded(
  byType: Readonly<Record<string, readonly string[]>>,
  name: string,
): readonly string[] {
  return Object.hasOwn(byType, name) ? (byType[name] ?? []) : [];
}

/** The keys a type file's `properties` declares, as the file writes them — whether or not Atlas can read each. */
export function declaredPropertyKeys(frontmatter: Readonly<Record<string, unknown>>): Set<string> {
  const declared = frontmatter['properties'];
  if (!isObject(declared)) return new Set();
  return new Set(
    Object.keys(declared)
      .map((key) => key.trim())
      .filter((key) => key !== ''),
  );
}

/**
 * The vault's own built-in types whose shipped keys are not all settled, each
 * with the keys its file lacks, after its own. Additive only: a key the file
 * declares is left as it is, whatever its shape — or even if Atlas cannot read
 * it — and a settled key is never added again, the person took it off. A type
 * with every shipped key settled is not listed, so a vault already migrated is
 * left alone.
 *
 * `declaredKeys` says which keys a type's file declares, taken from the file
 * rather than from the properties Atlas could parse out of it.
 */
export function shippedPropertiesPlan<Type extends ObjectType>(
  types: readonly Type[],
  record: ShippedPropertiesRecord,
  declaredKeys: (type: Type) => ReadonlySet<string>,
): ShippedPropertiesChange<Type>[] {
  const byName = new Map(types.map((type) => [folded(type.name), type]));
  return [...byName].flatMap(([name, type]) => {
    const shipped = SHIPPED.get(name) ?? [];
    const settled = new Set(keysRecorded(record.settled, name));
    if (shipped.every((property) => settled.has(property.key))) return [];
    const has = declaredKeys(type);
    const added = shipped.filter(
      (property) => !has.has(property.key) && !settled.has(property.key),
    );
    return [
      { before: type, after: { ...type, properties: [...type.properties, ...added] }, added },
    ];
  });
}

/**
 * The record once `changes` are done: each type's shipped keys settled — the
 * ones it had as well as the ones it gained — and what was added kept.
 */
export function recordSettling(
  record: ShippedPropertiesRecord,
  changes: readonly ShippedPropertiesChange[],
): ShippedPropertiesRecord {
  const settled = { ...record.settled };
  const added = { ...record.added };
  for (const change of changes) {
    const name = folded(change.before.name);
    const shipped = (SHIPPED.get(name) ?? []).map((property) => property.key);
    settled[name] = union(keysRecorded(settled, name), shipped);
    if (change.added.length > 0) {
      added[name] = union(
        keysRecorded(added, name),
        change.added.map((property) => property.key),
      );
    }
  }
  return { settled, added };
}

const union = (first: readonly string[], second: readonly string[]): string[] => [
  ...new Set([...first, ...second]),
];

/**
 * What Activity says of a type that gained shipped properties on opening:
 * "Added Tasks and Decisions to the Meeting type, which was written before Atlas shipped them."
 */
export function shippedPropertiesLine({
  label,
  added,
}: {
  label: string;
  added: readonly string[];
}): string {
  const them = added.length === 1 ? 'it' : 'them';
  return `Added ${listed(added)} to the ${label} type, which was written before Atlas shipped ${them}.`;
}

/** A record that cannot be trusted: its file is not one Atlas wrote. */
export class ShippedPropertiesRecordError extends Error {
  constructor(reason: string) {
    super(
      `The record of the properties Atlas added to built-in types (${SHIPPED_PROPERTIES_RECORD_PATH}) cannot be read, so none were added: ${reason}`,
    );
    this.name = 'ShippedPropertiesRecordError';
  }
}

const FENCE = '```';
const OPENING = `\n${FENCE}json\n`;

/** The record as its file is written: a heading a person can read, then the record as JSON. */
export function shippedPropertiesRecordText(record: ShippedPropertiesRecord): string {
  return [
    '---',
    'atlas: migration',
    '---',
    '',
    '# Properties added to built-in types',
    '',
    'Atlas adds a property it ships on a built-in type once, to a type file written before it',
    'shipped, and never changes one the file has. A settled key is not added again: one taken',
    'off since stays off.',
    '',
    `${FENCE}json`,
    JSON.stringify(record),
    FENCE,
    '',
  ].join('\n');
}

/** Reads a record back; a file any tool could have written is trusted only as keys by type. */
export function parseShippedPropertiesRecord(text: string): ShippedPropertiesRecord {
  const opening = text.indexOf(OPENING);
  const start = opening + OPENING.length;
  const end = opening === -1 ? -1 : text.indexOf(`\n${FENCE}`, start);
  if (end === -1) throw new ShippedPropertiesRecordError('it has no list of keys.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end));
  } catch {
    throw new ShippedPropertiesRecordError('its list of keys is not JSON.');
  }
  if (!isObject(parsed) || !isKeysByType(parsed['settled'])) {
    throw new ShippedPropertiesRecordError('it does not say which keys are settled.');
  }
  const added = parsed['added'] ?? {};
  if (!isKeysByType(added)) {
    throw new ShippedPropertiesRecordError('it does not say which keys were added.');
  }
  return { settled: parsed['settled'], added };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isKeysByType = (value: unknown): value is Record<string, string[]> =>
  isObject(value) &&
  Object.values(value).every(
    (keys) => Array.isArray(keys) && keys.every((key) => typeof key === 'string'),
  );
