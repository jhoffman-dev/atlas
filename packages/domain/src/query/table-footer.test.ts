import { describe, expect, it } from 'vitest';
import { groupTotals, tableArrangement } from './table-footer.ts';

describe('tableArrangement', () => {
  it('says what the table is grouped by and sorted by, in the properties’ words', () => {
    expect(tableArrangement({ groupedBy: 'Status', sortedBy: ['Phase'] })).toBe(
      'Grouped by status · sorted by phase',
    );
  });

  it('lists every sort, in the order they apply', () => {
    expect(tableArrangement({ groupedBy: null, sortedBy: ['Phase', 'Due date'] })).toBe(
      'Sorted by phase, then due date',
    );
  });

  it('says only the part that holds', () => {
    expect(tableArrangement({ groupedBy: 'Status', sortedBy: [] })).toBe('Grouped by status');
    expect(tableArrangement({ groupedBy: null, sortedBy: ['Name'] })).toBe('Sorted by name');
  });

  it('says nothing of a table that is neither grouped nor sorted', () => {
    expect(tableArrangement({ groupedBy: null, sortedBy: [] })).toBeNull();
  });

  it('keeps a label that is not plain words as it is written', () => {
    expect(tableArrangement({ groupedBy: 'GitHub repo', sortedBy: ['ID'] })).toBe(
      'Grouped by GitHub repo · sorted by ID',
    );
  });

  it('lowers a title-case label whole, never half of it', () => {
    expect(tableArrangement({ groupedBy: 'Due Date', sortedBy: [] })).toBe('Grouped by due date');
  });

  it('says which way a sort runs: descending is said, ascending is the plain reading', () => {
    expect(
      tableArrangement({
        groupedBy: null,
        sortedBy: [
          { label: 'Phase', direction: 'asc' },
          { label: 'Due date', direction: 'desc' },
        ],
      }),
    ).toBe('Sorted by phase, then due date (descending)');
  });
});

describe('groupTotals', () => {
  const group = (label: string, count: number, kind: 'select' | 'relation' = 'select') => ({
    label,
    kind,
    rows: Array.from({ length: count }, (_, at) => ({ path: `${label}-${at}.md` })),
  });

  it('counts each group under its value, a select’s read as its header reads it', () => {
    expect(groupTotals([group('done', 174), group('backlog', 10), group('in-review', 2)])).toEqual([
      '174 done',
      '10 backlog',
      '2 in-review',
    ]);
  });

  it('keeps an option that is an initialism or a name as written', () => {
    expect(groupTotals([group('QA', 4), group('GitHub', 2)])).toEqual(['4 QA', '2 GitHub']);
  });

  it('tells apart two options that read the same, by their values as written', () => {
    expect(groupTotals([group('Done', 2), group('done', 2), group('backlog', 1)])).toEqual([
      '2 Done',
      '2 done',
      '1 backlog',
    ]);
  });

  it('keeps a relation’s names as they are, since a name is not a word', () => {
    expect(groupTotals([group('Larkspur Payroll', 3, 'relation')])).toEqual(['3 Larkspur Payroll']);
  });

  it('leaves out an empty group: a count of nothing says nothing', () => {
    expect(groupTotals([group('Done', 0), group('Backlog', 1)])).toEqual(['1 backlog']);
  });
});
