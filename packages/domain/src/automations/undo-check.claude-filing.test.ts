/**
 * #227: what undo believes of a Claude step's run (A25-01: a log is a note
 * anyone can write). The step only ever fills an empty `project` on a
 * meeting, so undo takes `project` off only a meeting, and only back to
 * nothing. Found by the adversarial review of PR #228. Fictional names only.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { parseAutomationRule } from './automation-rule.ts';
import { claudeFiledNoteProblem, loggedActionProblem } from './undo-check.ts';

const declared = (() => {
  const read = parseAutomationRule(createVaultPath('.atlas/automations/M.md'), {
    atlas: 'automation',
    name: 'M',
    when: 'manually',
    which: 'FROM meeting',
    do: 'claude',
    prompt: 'meeting-actions',
    output: 'proposals',
  });
  if ('broken' in read) throw new Error(read.broken.problem);
  return { ...read.rule.action, apply: 'mine' as const };
})();

const filed = (before: { absent: true } | { value: unknown }) => ({
  kind: 'set' as const,
  path: createVaultPath('Inbox/Meetings/2026-10-06 Standup.md'),
  key: 'project',
  before,
  after: { value: '[[Ledger]]' },
});

describe('undo of a Claude step’s filing', () => {
  it('does not take `project` off a note the step could never have filed: a task, not a meeting', () => {
    // A task really is filed under Ledger; a line written into the log claims the step set it.
    expect(claudeFiledNoteProblem({ type: 'task', project: '[[Ledger]]' })).not.toBeNull();
    expect(claudeFiledNoteProblem({ project: '[[Ledger]]' })).not.toBeNull();
    expect(claudeFiledNoteProblem({ type: 'meeting', project: '[[Ledger]]' })).toBeNull();
    expect(claudeFiledNoteProblem({ type: ['Meeting'] })).toBeNull();
  });

  it('does not write a non-link back into `project` (before must be what a filed-from-nothing meeting held)', () => {
    // The step only files a meeting whose project holds nothing, so `before` is absent, null, '' or [].
    // Before the fix, undo wrote the arbitrary text into the meeting's project.
    expect(
      loggedActionProblem(declared, filed({ value: 'rm -rf / ; anything at all' })),
    ).not.toBeNull();
    expect(loggedActionProblem(declared, filed({ value: '[[Payrun]]' }))).not.toBeNull();
    expect(loggedActionProblem(declared, filed({ value: ['[[Payrun]]'] }))).not.toBeNull();
  });

  it('puts back a `project` that held nothing, in each way it can hold nothing', () => {
    for (const before of [
      { absent: true as const },
      { value: null },
      { value: '' },
      { value: [] },
    ]) {
      expect(loggedActionProblem(declared, filed(before))).toBeNull();
    }
  });
});
