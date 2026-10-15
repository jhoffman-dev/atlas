import { TASK_TYPE } from '../gtd/gtd-status.ts';
import { DECISION_TYPE } from '../proposals/proposal.ts';
import type { PropertyDef } from '../types/property-def.ts';
import { MEETING_TYPE } from './meeting-header.ts';

/** The meeting relation a task taken from it joins once its proposal is accepted (P29-05). */
export const MEETING_TASKS_KEY = 'tasks';

/** The meeting relation a decision taken from it joins once its proposal is accepted (P29-05). */
export const MEETING_DECISIONS_KEY = 'decisions';

const relation = (key: string, label: string, target: string): PropertyDef => ({
  key,
  kind: 'relation',
  label,
  required: false,
  options: [],
  target,
  many: true,
});

/**
 * What meeting extraction links back into a meeting (P29-05, ADR-0028): the
 * tasks and the decisions taken from it. Accept adds a link only through a
 * relation the Meeting type declares, so a vault's Meeting type gains these
 * on opening, as it gains the import's keys (#162).
 */
export const MEETING_EXTRACTION_PROPERTIES: readonly PropertyDef[] = [
  relation(MEETING_TASKS_KEY, 'Tasks', TASK_TYPE),
  relation(MEETING_DECISIONS_KEY, 'Decisions', DECISION_TYPE),
];

/** A task's relation back to the meeting it was taken from (ADR-0036, "Linked both ways"). */
export const TASK_MEETING_KEY = 'meeting';

/**
 * A task's identity as one meeting's action item (ADR-0036): the primary
 * meeting, the cited transcript block and the owner, so a re-run finds the
 * task it made rather than making it again.
 */
export const MEETING_ITEM_KEY = 'atlas_item';

/**
 * What a task made from a meeting's action item carries besides the task's
 * own keys (#177), as the Task type written into a new vault declares it. A
 * vault's own Task type is never given them without a yes: they are offered
 * with the setup of meeting post-processing (#191, ADR-0036).
 */
export const MEETING_ITEM_TASK_PROPERTIES: readonly PropertyDef[] = [
  { ...relation(TASK_MEETING_KEY, 'Meeting', MEETING_TYPE), many: false },
  {
    key: MEETING_ITEM_KEY,
    kind: 'text',
    label: 'Meeting item',
    required: false,
    options: [],
    target: null,
    many: false,
  },
];
