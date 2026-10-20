import { describe, expect, it } from 'vitest';
import { LINK_HINTS_QUERY_COLUMNS } from '@atlas/domain';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { readLinkHints } from './link-hints.ts';

/**
 * Attack on PR #469 (#465). The desktop host answers at most 5,000 rows
 * (`MAX_QUERY_ROWS` in `src-tauri/src/index.rs`) and says so with
 * `truncated: true`. The hints statement returns one row per note, then one
 * per alias, then one per used note — so a vault past 5,000 notes loses its
 * later notes, every alias and every use. Fictional names only.
 */

const HOST_ROW_CAP = 5_000;

/** An index that answers as the host does: the first 5,000 rows, flagged when there were more. */
function cappedIndex(rows: unknown[][]) {
  return fakeIndexPort({
    query: async () => ({
      columns: [...LINK_HINTS_QUERY_COLUMNS],
      rows: rows.slice(0, HOST_ROW_CAP),
      truncated: rows.length > HOST_ROW_CAP,
    }),
  });
}

describe('readLinkHints on a vault past the host row cap (attack #469)', () => {
  it('never passes a truncated answer off as every note, alias and use', async () => {
    const notes = Array.from({ length: 6_000 }, (_, at) => [
      'note',
      `Notes/Field note ${String(at).padStart(4, '0')}.md`,
      `Field note ${String(at).padStart(4, '0')}`,
      null,
      null,
    ]);
    const rows = [
      ...notes,
      ['alias', 'People/Mara Quill.md', 'MQ', null, null],
      ['use', 'Projects/Larkspur Payroll.md', null, 12, 1_700],
    ];

    // Either every note, alias and use comes back, or the read says it could not: a loud, safe answer.
    const outcome = await readLinkHints({ index: cappedIndex(rows) }).then(
      (read) => ({
        notes: read.notes.length,
        alias: read.hints.aliases.has('People/Mara Quill.md'),
        use: read.hints.uses.has('Projects/Larkspur Payroll.md'),
      }),
      () => 'refused' as const,
    );
    expect(outcome).toSatisfy(
      (seen: typeof outcome) =>
        seen === 'refused' || (seen.notes === 6_000 && seen.alias && seen.use),
    );
  });
});
