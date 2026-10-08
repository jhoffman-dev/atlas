/**
 * Adversarial pass, round 2, on P30-02 (ADR-0029): the task rules read a
 * status exactly as written, while the index — and so the Waiting view, a
 * board's columns and the Inbox's quick look — reads each item of a list as
 * a row of its own. And the merged record across runs where a file the first
 * run changed is one the second run makes afresh. Each test names one
 * invariant.
 */
import { describe, expect, it } from 'vitest';
import { indexablePropertiesOf } from '../index/property-value.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { mergedRecord, type MigrationRecord } from './migration-record.ts';
import { taskRuleChanges } from './task-rules.ts';

const TODAY = '2026-10-08';

describe('a status written as a one-item list', () => {
  it('is indexed as `waiting`, so the Waiting view lists it', () => {
    // The premise of the next test: `status = waiting` matches this note.
    const rows = indexablePropertiesOf({ status: ['waiting'] }).filter(
      (row) => row.key === 'status',
    );
    expect(rows.map((row) => row.text)).toEqual(['waiting']);
  });

  it('is refused as Waiting with nobody to wait on, as `waiting` is', () => {
    // The YAML adapter writes `["waiting"]` as a list, the index reads it as
    // Waiting, and the Inbox's quick look never offers to migrate it: a task
    // waiting on nobody that nothing ever catches.
    const outcome = taskRuleChanges({
      before: { type: 'task', status: 'next-action' },
      changes: { status: ['waiting'] },
      today: TODAY,
    });
    expect(outcome).toHaveProperty('refused');
  });
});

describe('who a waiting task waits on', () => {
  it('counts a list holding only an empty name as nobody', () => {
    const outcome = taskRuleChanges({
      before: { type: 'task', status: 'next-action' },
      changes: { status: 'waiting', waiting_on: [''] },
      today: TODAY,
    });
    expect(outcome).toHaveProperty('refused');
  });
});

describe('mergedRecord when the second run makes a file the first run changed', () => {
  it('records the second run’s file as made, so undo takes away what it made', () => {
    // Run one rewrote James's own `Waiting` view; he deleted it; run two made
    // the GTD Waiting view at that path. Undo must take the made view away —
    // keeping run one's line instead, undo finds the made view, which is not
    // what run one wrote, and leaves it as "changed since".
    const path = createVaultPath('.atlas/views/Waiting.md');
    const earlier: MigrationRecord = {
      at: '2026-10-08T09:30:00',
      files: [
        {
          kind: 'changed',
          path,
          before: '---\natlas: view\nquery: FROM task WHERE status = blocked\n---\n',
          after: '---\natlas: view\nquery: FROM task WHERE status = waiting\n---\n',
        },
      ],
    };
    const made = {
      kind: 'created' as const,
      path,
      contents: '---\natlas: view\n---\n\n# Waiting\n',
    };
    const merged = mergedRecord(earlier, { at: '2026-10-08T10:00:00', files: [made] });
    expect(merged.files).toEqual([made]);
  });
});
