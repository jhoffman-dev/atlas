import { MEETING_TYPE } from '../meetings/meeting-header.ts';
import { MEETING_EXTRACTION_PROPERTIES } from '../meetings/meeting-extraction-properties.ts';
import { MEETING_IMPORT_PROPERTIES } from '../meetings/meeting-import-properties.ts';
import { PROPOSAL_TYPE_FILES } from '../proposals/proposal-types.ts';
import type { BuiltInTypeFile, TypeExtension } from './para.ts';
import type { ObjectType } from './property-def.ts';

/** What the Inbox needs of a vault's types beyond PARA: proposals, and meetings that arrive. */
export interface InboxTypePlan<Type extends ObjectType = ObjectType> {
  /** The Proposal and Decision types the vault has no file for. */
  readonly missing: readonly BuiltInTypeFile[];
  /** The vault's Meeting type, gaining the import's and the extraction's keys it does not declare. */
  readonly extensions: readonly TypeExtension<Type>[];
}

/** A vault's type name as the disk compares its file's: in any case. */
const folded = (name: string) => name.trim().toLowerCase();

/**
 * What a vault's types lack for the one Inbox (P29-02, P28-04): the Proposal
 * and Decision types, and on its Meeting type the meeting import's keys and
 * the relations a task or a decision taken from a meeting is linked back
 * through (`tasks`, `decisions`, P29-05).
 * Additive only — a key the Meeting type already has is left as it is — and
 * never written without a yes: it is offered beside PARA's setup. Opening a
 * vault gives its Meeting type these keys once (#162, `shippedPropertiesPlan`),
 * so what is offered here is a key the person took off since.
 *
 * Nothing is offered on a Meeting type two files claim: the offer would
 * extend one of them, and Accept and the Claude step read whichever comes
 * first, which need not be it. Opening the vault asks for them to be merged.
 */
export function inboxTypePlan<Type extends ObjectType>(
  existing: readonly Type[],
): InboxTypePlan<Type> {
  const byName = new Map(existing.map((type) => [folded(type.name), type]));
  const missing = PROPOSAL_TYPE_FILES.filter((file) => !byName.has(file.type.name));
  const meetings = existing.filter((type) => folded(type.name) === MEETING_TYPE);
  const [meeting] = meetings;
  const extension = meeting === undefined || meetings.length > 1 ? null : withImportKeys(meeting);
  return { missing, extensions: extension === null ? [] : [extension] };
}

function withImportKeys<Type extends ObjectType>(type: Type): TypeExtension<Type> | null {
  const has = new Set(type.properties.map((property) => property.key));
  const added = [...MEETING_IMPORT_PROPERTIES, ...MEETING_EXTRACTION_PROPERTIES].filter(
    (property) => !has.has(property.key),
  );
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
