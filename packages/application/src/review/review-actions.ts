import { FINISHED_TASK_STATUS, REOPENED_TASK_STATUS, TASK_KEYS } from '@atlas/domain';
import { propertyChange, type PropertyChanges } from '../query/set-property.ts';

/**
 * What the review's Archive writes into a task: finished, as ticking it done
 * does — so a repeating task rolls on to its next date and back to Next
 * Action rather than its series ending, and one that does not repeat is
 * finished, dated by the task rules. Worked out against the task as the
 * write reads it.
 */
export function archiveTaskChange(): PropertyChanges {
  return propertyChange({
    key: TASK_KEYS.status,
    value: FINISHED_TASK_STATUS,
    completion: {
      statusKey: TASK_KEYS.status,
      doneValue: FINISHED_TASK_STATUS,
      resetStatus: REOPENED_TASK_STATUS,
    },
  });
}
