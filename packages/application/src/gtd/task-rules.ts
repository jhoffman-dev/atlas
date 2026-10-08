import { taskRuleChanges } from '@atlas/domain';
import type { PropertyChanges } from '../query/set-property.ts';

/** A change to a task its rules refuse, with the reason the person is shown. */
export class TaskRuleRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'TaskRuleRefusedError';
  }
}

/**
 * A property change held to the GTD task rules (ADR-0029): worked out, like
 * any change given as a rule, against the properties the write starts from,
 * so what the note already says decides — who it waits on, whether it was
 * finished. A refused change throws {@link TaskRuleRefusedError} from inside
 * the write, so nothing is written and the reason reaches whoever asked.
 */
export function withTaskRules({
  values,
  today,
}: {
  values: PropertyChanges;
  /** `YYYY-MM-DD`, from the injected clock: what a finished task's `completed` says. */
  today: string;
}): (properties: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>> {
  return (properties) => {
    const changes = typeof values === 'function' ? values(properties) : values;
    const outcome = taskRuleChanges({ before: properties, changes, today });
    if ('refused' in outcome) throw new TaskRuleRefusedError(outcome.refused);
    return outcome.changes;
  };
}
