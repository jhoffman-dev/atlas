/**
 * Attack on #334 (UI v2 slice 4, #296): the table footer's words — each
 * group's count under its value, and how the table is arranged — against the
 * group headers they sit under and the labels a vault actually declares.
 */
import { describe, expect, it } from 'vitest';
import { optionLabel } from '../page/status-tone.ts';
import { queryableFields } from '../query-language/fields.ts';
import { QUERY_TEST_TYPES } from '../query-language/query-fixtures.ts';
import { groupResultRows } from '../query-language/result-groups.ts';
import { groupTotals, tableArrangement, type TotalledGroup } from './table-footer.ts';

/** Seeded, so a failing case names its seed and replays exactly. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const group = (label: string, count: number, kind = 'select'): TotalledGroup => ({
  label,
  kind,
  rows: Array.from({ length: count }, (_, at) => ({ path: `${label}-${at}.md` })),
});

describe('groupTotals (attack-334)', () => {
  it('names a GTD status the way its group header does, not by its raw option', () => {
    // The header above the group reads optionLabel(label): "Next Action", not "next-action".
    const reads = (option: string) => optionLabel(option).toLowerCase();
    expect(reads('next-action')).not.toContain('-');
    expect(groupTotals([group('next-action', 12), group('in-progress', 3)])).toEqual([
      `12 ${reads('next-action')}`,
      `3 ${reads('in-progress')}`,
    ]);
  });

  it('keeps an initialism or a name among select options as written, as the arrangement does', () => {
    // tableArrangement keeps "ID" and "GitHub repo"; the same policy for a select's value.
    expect(groupTotals([group('QA', 4), group('GitHub', 2)])).toEqual(['4 QA', '2 GitHub']);
  });

  it('tells two different groups apart even when their counts match', () => {
    // Option keys are case-sensitive, so `Done` and `done` are two groups.
    const status = queryableFields(QUERY_TEST_TYPES, ['task']).find((f) => f.text === 'status')!;
    const rows = ['Done', 'Done', 'done', 'done'].map((value, at) => ({
      path: `tasks/T${at}.md`,
      title: `T${at}`,
      values: { title: `T${at}`, status: value },
    }));
    const groups = groupResultRows({ rows, groups: [status] });
    expect(groups.length).toBe(2);
    const totals = groupTotals(groups);
    expect(new Set(totals).size).toBe(totals.length);
  });

  it('property: one total per non-empty group, led by its row count (seeded)', () => {
    const random = mulberry32(334);
    for (let run = 0; run < 200; run += 1) {
      const size = Math.floor(random() * 50);
      const groups = Array.from({ length: size }, (_, at) =>
        group(`Option ${at}`, Math.floor(random() * 4), random() < 0.5 ? 'select' : 'relation'),
      );
      const totals = groupTotals(groups);
      const kept = groups.filter((candidate) => candidate.rows.length > 0);
      expect(totals.length).toBe(kept.length);
      totals.forEach((total, at) => {
        expect(total.startsWith(`${kept[at]!.rows.length} `)).toBe(true);
      });
    }
  });

  it('totals ten thousand groups in order without dropping one', () => {
    const groups = Array.from({ length: 10_000 }, (_, at) =>
      group(`Larkspur ${at}`, 1, 'relation'),
    );
    const totals = groupTotals(groups);
    expect(totals.length).toBe(10_000);
    expect(totals[9_999]).toBe('1 Larkspur 9999');
  });
});

describe('tableArrangement (attack-334)', () => {
  it('never half-lowers a title-case label into "due Date"', () => {
    const arrangement = tableArrangement({ groupedBy: null, sortedBy: ['Due Date'] });
    expect(['Sorted by due date', 'Sorted by Due Date']).toContain(arrangement);
  });

  it('property: the sentence starts with a capital and each part appears once (seeded)', () => {
    const random = mulberry32(2961);
    const labels = ['Status', 'Phase', 'Due date', 'ID', 'GitHub repo', 'Owner', 'URL'];
    const pick = () => labels[Math.floor(random() * labels.length)]!;
    for (let run = 0; run < 300; run += 1) {
      const groupedBy = random() < 0.5 ? null : pick();
      const sortedBy = Array.from({ length: Math.floor(random() * 4) }, pick);
      const arrangement = tableArrangement({ groupedBy, sortedBy });
      if (groupedBy === null && sortedBy.length === 0) {
        expect(arrangement).toBeNull();
        continue;
      }
      expect(arrangement).not.toBeNull();
      expect(/^[A-Z]/.test(arrangement!)).toBe(true);
      expect(arrangement!.split(' · ').length).toBe(
        (groupedBy ? 1 : 0) + (sortedBy.length ? 1 : 0),
      );
    }
  });
});
