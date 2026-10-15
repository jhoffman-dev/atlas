import { TASK_TYPE } from '../gtd/gtd-status.ts';
import { DECISION_TYPE } from '../proposals/proposal.ts';
import type { PropertyDef } from '../types/property-def.ts';

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
