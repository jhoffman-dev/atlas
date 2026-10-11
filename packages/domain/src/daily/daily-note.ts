import type { BuiltInTypeFile } from '../types/para.ts';
import type { ObjectType } from '../types/property-def.ts';

/**
 * Today's note is a note of this type: one a day, named by its date at the
 * root of the vault. Daily notes imported from Notion carry it already.
 */
export const DAILY_TYPE = 'daily';

/** The Daily type, as written into a vault that lacks it once the person says yes. */
export const DAILY_TYPE_FILE: BuiltInTypeFile = {
  type: { name: DAILY_TYPE, label: 'Daily', icon: 'calendar', properties: [] },
  body: [
    '# Daily',
    '',
    "One note a day, named by its date: `2026-10-12.md`. Today's note (⇧⌘D) opens it,",
    "and makes it from the vault's Daily template when it is not there yet.",
    '',
  ].join('\n'),
};

/**
 * What today's note starts as in a vault with no Daily template: a note of the
 * Daily type with a heading for the day and one for what comes next. A Daily
 * template of the vault's own always wins over this.
 */
export const DAILY_NOTE_CONTENTS = [
  '---',
  `type: ${DAILY_TYPE}`,
  '---',
  '',
  '## What happened',
  '',
  '## What is next',
  '',
].join('\n');

/** A vault's type name as the disk compares its file's: in any case. */
const folded = (name: string) => name.trim().toLowerCase();

/**
 * The Daily type to offer a vault, or null when it has one already. It is
 * only ever offered, as the Inbox's own types are: a note of an undefined
 * type works, so nothing breaks while the offer waits.
 */
export function dailyTypeToOffer(existing: readonly ObjectType[]): BuiltInTypeFile | null {
  return existing.some((type) => folded(type.name) === DAILY_TYPE) ? null : DAILY_TYPE_FILE;
}
