import { splitFrontmatter, taskRuleChanges } from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
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

/** What a new note's text needs from the markdown port to be judged and dated. */
type FrontmatterPort = Pick<MarkdownPort, 'frontmatterProperties' | 'updateFrontmatter'>;

/**
 * A new note's text held to the task rules (ADR-0029): what it starts with
 * is judged as a change from nothing, so a new task that is Waiting with
 * nobody to wait on is refused with {@link TaskRuleRefusedError}, and one
 * made already in Archive is given today as `completed`. Text with no
 * frontmatter, or not a task, is returned as it is.
 */
export function newNoteTaskRules({
  markdown,
  contents,
  today,
}: {
  markdown: FrontmatterPort;
  contents: string;
  /** `YYYY-MM-DD`, from the injected clock. */
  today: string;
}): string {
  const { frontmatter, body } = splitFrontmatter(contents);
  if (frontmatter === null) return contents;
  const properties = markdown.frontmatterProperties(frontmatter);
  const outcome = taskRuleChanges({ before: {}, changes: properties, today });
  if ('refused' in outcome) throw new TaskRuleRefusedError(outcome.refused);
  const added = Object.fromEntries(
    Object.entries(outcome.changes).filter(([key, value]) => properties[key] !== value),
  );
  if (Object.keys(added).length === 0) return contents;
  return markdown.updateFrontmatter(frontmatter, added) + body;
}
