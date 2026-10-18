// @vitest-environment jsdom
/**
 * Attack on #334 (UI v2 slice 4, #296): what the table's headings and footer
 * tell someone who cannot see the arrow — the sort's direction, and which
 * heading the table is sorted by.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { QuerySort } from '@atlas/domain';
import { TableView, type TableResult } from './table-view.tsx';

const result: TableResult = {
  columns: ['path', 'title', 'status', 'due'],
  rows: [
    ['a.md', 'Water the ferns', 'doing', '2026-10-01'],
    ['b.md', 'Mend the gate', 'done', '2026-10-09'],
  ],
  truncated: false,
  sql: '',
};

const noop = () => {};

function drawn(sorts: readonly QuerySort[]) {
  return render(
    <TableView
      result={result}
      sorts={sorts}
      error={null}
      schema={{ kinds: { status: 'select', due: 'date' }, labels: {}, noun: 'Task' }}
      onOpenNote={noop}
      onToggleSort={noop}
    />,
  );
}

const arrangement = (container: HTMLElement) =>
  container.querySelector('.table__arrangement')?.textContent ?? null;

describe('TableView footer and headings (attack-334)', () => {
  it('says which way the table is sorted: a descending sort does not read as an ascending one', () => {
    const up = drawn([{ key: 'due', direction: 'asc' }]);
    const ascending = arrangement(up.container);
    up.unmount();
    const down = drawn([{ key: 'due', direction: 'desc' }]);
    const descending = arrangement(down.container);
    expect(ascending).not.toBeNull();
    expect(descending).not.toBeNull();
    expect(descending).not.toBe(ascending);
  });

  it('puts aria-sort on one heading at a time, as ARIA asks, when two sorts apply', () => {
    const { container } = drawn([
      { key: 'status', direction: 'asc' },
      { key: 'due', direction: 'desc' },
    ]);
    const sorted = container.querySelectorAll('th[aria-sort]');
    // Proven to match: the primary sort's heading carries it.
    expect(container.querySelector('th[aria-sort="ascending"]')).not.toBeNull();
    expect(sorted.length).toBe(1);
  });
});
