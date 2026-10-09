import { TASK_TYPE } from '../gtd/gtd-status.ts';
import type { BuiltInTypeFile } from '../types/para.ts';
import type { ObjectType, PropertyDef } from '../types/property-def.ts';

/**
 * A timeblock is a note (ADR-0030): a stretch of the calendar that one big
 * task is placed on, or several small ones are pushed into.
 */
export const BLOCK_TYPE = 'block';

/** The keys a block is read by, as they are written in its frontmatter. */
export const BLOCK_KEYS = {
  start: 'start',
  end: 'end',
  tasks: 'tasks',
  gcalEventId: 'gcal_event_id',
  gcalEtag: 'gcal_etag',
} as const;

const plain = (key: string, kind: PropertyDef['kind'], label: string): PropertyDef => ({
  key,
  kind,
  label,
  required: false,
  options: [],
  target: null,
  many: false,
});

/** The Block type, as written into a vault that has tasks and no blocks yet. */
export const BLOCK_TYPE_FILE: BuiltInTypeFile = {
  type: {
    name: BLOCK_TYPE,
    label: 'Block',
    icon: 'calendar',
    properties: [
      { ...plain(BLOCK_KEYS.start, 'date', 'Start'), required: true },
      { ...plain(BLOCK_KEYS.end, 'date', 'End'), required: true },
      { ...plain(BLOCK_KEYS.tasks, 'relation', 'Tasks'), target: TASK_TYPE, many: true },
      plain(BLOCK_KEYS.gcalEventId, 'text', 'Google event'),
      plain(BLOCK_KEYS.gcalEtag, 'text', 'Google version'),
    ],
  },
  body: [
    '# Block',
    '',
    'Time set aside on the calendar, from its start to its end, for the tasks it links.',
    'A block holding one task gives that task all of its time; a block holding several',
    'shares its time among them by what each has left of its estimate.',
    '',
  ].join('\n'),
};

/** A type's name as the disk compares its file's: in any case. */
const folded = (name: string) => name.trim().toLowerCase();

/**
 * The Block type to write into a vault, or null when there is none to write:
 * the vault has a Block type already, or has no Task type — blocks schedule
 * tasks, so a vault without them has nothing to put in one.
 */
export function blockTypeToWrite(existing: readonly ObjectType[]): BuiltInTypeFile | null {
  const names = new Set(existing.map((type) => folded(type.name)));
  return names.has(TASK_TYPE) && !names.has(BLOCK_TYPE) ? BLOCK_TYPE_FILE : null;
}
