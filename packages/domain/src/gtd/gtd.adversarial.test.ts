/**
 * Adversarial pass on P30-02 (ADR-0029): the rewrites, rules and record the
 * GTD migration leans on, attacked where their own tests did not look. Each
 * test names one invariant.
 */
import { describe, expect, it } from 'vitest';
import { automationStatusRewrite, rewrittenQuery } from './status-references.ts';
import { statusMappingFor, taskStatusMove } from './status-mapping.ts';
import { taskRuleChanges } from './task-rules.ts';

const mapping = statusMappingFor({ found: ['backlog', 'next', 'doing', 'review', 'done'] });

describe('rewriting a query that lists tasks and another type', () => {
  it('leaves a query that also lists projects alone, as its contract says, rather than moving the projects’ `done` too', () => {
    // Projects keep `planned, active, paused, done` (P30-01). Rewriting
    // `status = done` here to `archive` silently drops every finished project.
    const result = rewrittenQuery({ text: 'FROM task, project WHERE status = done', mapping });
    expect(result === null || 'problem' in result).toBe(true);
  });

  it('never rewrites an automation to set `archive` on the projects its query also lists', () => {
    // `archive` is no project status: run, the rule would write a value the
    // Project type does not have onto every project it matches.
    const rewrite = automationStatusRewrite(
      {
        atlas: 'automation',
        name: 'Close out',
        which: 'FROM project, task WHERE status = active',
        set: { status: 'done' },
      },
      mapping,
    );
    expect(rewrite === null || 'problem' in rewrite).toBe(true);
  });
});

describe('finishing a task under the rules', () => {
  it('dates a task moved to Archive whose change carries an empty `completed`', () => {
    // "unless the change says a day itself" — an empty string says no day.
    const outcome = taskRuleChanges({
      before: { type: 'task', status: 'next-action' },
      changes: { status: 'archive', completed: '' },
      today: '2026-10-08',
    });
    expect(outcome).toEqual({ changes: { status: 'archive', completed: '2026-10-08' } });
  });

  it('refuses making a note a Waiting task with nobody to wait on, when the type is what changes', () => {
    // The status is not touched, so the rule never looks — yet the change
    // leaves a task Waiting with no `waiting_on`.
    const outcome = taskRuleChanges({
      before: { type: 'note', status: 'waiting' },
      changes: { type: 'task' },
      today: '2026-10-08',
    });
    expect(outcome).toHaveProperty('refused');
  });
});

describe('migrating a task whose status is a list', () => {
  it('moves `[next-action]` to the one status it names, rather than leaving a list no select can hold', () => {
    // Written as a list, it reads as `next-action` and is taken as already
    // moved — so the preview never shows it and the file keeps a list.
    const move = taskStatusMove({
      properties: { type: 'task', status: ['next-action'] },
      mapping,
      lastChanged: '2026-09-30',
    });
    expect(move).toMatchObject({ to: 'next-action' });
  });
});
