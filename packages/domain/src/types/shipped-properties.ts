import { DAILY_TYPE_FILE } from '../daily/daily-note.ts';
import { MEETING_TYPE } from '../meetings/meeting-header.ts';
import { MEETING_EXTRACTION_PROPERTIES } from '../meetings/meeting-extraction-properties.ts';
import { MEETING_IMPORT_PROPERTIES } from '../meetings/meeting-import-properties.ts';
import { PROPOSAL_TYPE_FILES } from '../proposals/proposal-types.ts';
import { BLOCK_TYPE_FILE } from '../timeblocks/block-type.ts';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { ATLAS_DIRECTORY } from '../vault/vault-visibility.ts';
import { listed, PARA_TYPE_FILES } from './para.ts';
import type { ObjectType, PropertyDef } from './property-def.ts';

/**
 * The properties Atlas ships on each built-in type a vault may already have a
 * file for, by the type's name (#162). A file written before Atlas shipped one
 * of them lacks it, and a feature built on it fails — Accept on a meeting's
 * action item, for one, links through the Meeting type's `tasks`.
 *
 * Meeting is here though Atlas writes no Meeting file: the import writes its
 * keys (ADR-0027) and meeting extraction links through its relations (P29-05).
 * Task is not: its keys come with the move to GTD (ADR-0029), which changes
 * its status too and is the person's to start.
 */
const SHIPPED: ReadonlyMap<string, readonly PropertyDef[]> = new Map([
  ...[...PARA_TYPE_FILES, ...PROPOSAL_TYPE_FILES, DAILY_TYPE_FILE, BLOCK_TYPE_FILE].map(
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

/** A built-in type of the vault's that lacks shipped keys not yet settled, and what it gains. */
export interface ShippedPropertiesChange<Type extends ObjectType = ObjectType> {
  readonly before: Type;
  readonly after: ObjectType;
  /** The shipped properties its file lacks. */
  readonly added: readonly PropertyDef[];
}

/** A vault's type name as the disk compares its file's: in any case. */
const folded = (name: string) => name.trim().toLowerCase();

/**
 * The vault's built-in types whose files lack shipped keys not yet settled,
 * each gaining them after its own. Additive only: a key the file has is left
 * as it is, whatever its shape, and a settled key is never added again — the
 * person took it off. A type that lacks nothing is left, and so is the record:
 * opening a vault whose types are whole writes nothing.
 */
export function shippedPropertiesPlan<Type extends ObjectType>(
  types: readonly Type[],
  record: ShippedPropertiesRecord,
): ShippedPropertiesChange<Type>[] {
  const byName = new Map(types.map((type) => [folded(type.name), type]));
  return [...byName].flatMap(([name, type]) => {
    const settled = new Set(record.settled[name] ?? []);
    const has = new Set(type.properties.map((property) => property.key));
    const added = (SHIPPED.get(name) ?? []).filter(
      (property) => !has.has(property.key) && !settled.has(property.key),
    );
    if (added.length === 0) return [];
    return [
      { before: type, after: { ...type, properties: [...type.properties, ...added] }, added },
    ];
  });
}

/**
 * The record once `changes` are written: each changed type's shipped keys
 * settled — the ones it had as well as the ones it gained — and what was
 * added kept.
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
    settled[name] = union(settled[name], shipped);
    added[name] = union(
      added[name],
      change.added.map((property) => property.key),
    );
  }
  return { settled, added };
}

const union = (first: readonly string[] = [], second: readonly string[]): string[] => [
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
