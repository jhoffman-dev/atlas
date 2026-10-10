import { MEETING_TYPE } from '../meetings/meeting-header.ts';
import { MEETING_IMPORT_PROPERTIES } from '../meetings/meeting-import-properties.ts';
import { PROPOSAL_TYPE_FILES } from '../proposals/proposal-types.ts';
import type { BuiltInTypeFile, TypeExtension } from './para.ts';
import type { ObjectType } from './property-def.ts';

/** What the Inbox needs of a vault's types beyond PARA: proposals, and meetings that arrive. */
export interface InboxTypePlan<Type extends ObjectType = ObjectType> {
  /** The Proposal and Decision types the vault has no file for. */
  readonly missing: readonly BuiltInTypeFile[];
  /** The vault's Meeting type, gaining the import's keys it does not declare. */
  readonly extensions: readonly TypeExtension<Type>[];
}

/** A vault's type name as the disk compares its file's: in any case. */
const folded = (name: string) => name.trim().toLowerCase();

/**
 * What a vault's types lack for the one Inbox (P29-02, P28-04): the Proposal
 * and Decision types, and the meeting import's keys on its Meeting type.
 * Additive only — a key the Meeting type already has is left as it is — and
 * never written without a yes: it is offered beside PARA's setup.
 */
export function inboxTypePlan<Type extends ObjectType>(
  existing: readonly Type[],
): InboxTypePlan<Type> {
  const byName = new Map(existing.map((type) => [folded(type.name), type]));
  const missing = PROPOSAL_TYPE_FILES.filter((file) => !byName.has(file.type.name));
  const meeting = byName.get(MEETING_TYPE);
  const extension = meeting === undefined ? null : withImportKeys(meeting);
  return { missing, extensions: extension === null ? [] : [extension] };
}

function withImportKeys<Type extends ObjectType>(type: Type): TypeExtension<Type> | null {
  const has = new Set(type.properties.map((property) => property.key));
  const added = MEETING_IMPORT_PROPERTIES.filter((property) => !has.has(property.key));
  if (added.length === 0) return null;
  return {
    before: type,
    after: { ...type, properties: [...type.properties, ...added] },
    added,
    widened: [],
  };
}

/**
 * Two plans' changes to the vault's types as one per type, so a type both
 * extend is written once: the first's change, then what the second adds.
 * The second only adds properties, as {@link inboxTypePlan} does.
 */
export function combinedExtensions<Type extends ObjectType>(
  first: readonly TypeExtension<Type>[],
  second: readonly TypeExtension<Type>[],
): TypeExtension<Type>[] {
  const combined = first.map((extension) => {
    const more = second.find((other) => other.before.name === extension.before.name);
    if (more === undefined) return extension;
    return {
      ...extension,
      after: { ...extension.after, properties: [...extension.after.properties, ...more.added] },
      added: [...extension.added, ...more.added],
    };
  });
  const extended = new Set(first.map((extension) => extension.before.name));
  return [...combined, ...second.filter((extension) => !extended.has(extension.before.name))];
}
