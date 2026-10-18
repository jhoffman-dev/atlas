// @vitest-environment jsdom
/**
 * Attack on #252 (grouped tables' arrow keys, #248). A move to a line the
 * virtualiser has not drawn waits for it by its index. These tests change
 * the lines while it waits — a group unfolded from the keyboard, a re-read
 * that adds or removes rows — and check where the focus ends up. The rest
 * are probes of what held: empty and folded groups, sub-groups, a held key.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  groupResultRows,
  parseObjectType,
  toBoardRows,
  viewGroupLevels,
  type RowGroup,
} from '@atlas/domain';
import { TableView, type TableResult } from './table-view.tsx';
import { ROW_ESTIMATE } from './grouped-rows.tsx';
import { scrollableSheet } from './testing/scrollable-sheet.ts';

afterEach(cleanup);

const TASK = parseObjectType({
  name: 'task',
  properties: {
    status: { kind: 'select', options: ['backlog', 'doing'] },
    area: { kind: 'select', options: ['home', 'work'] },
  },
});

interface Task {
  readonly at: number;
  readonly status: 'backlog' | 'doing';
  readonly area?: 'home' | 'work';
}

/** `count` tasks, the first half in Backlog and the rest in Doing. */
const halves = (count: number, first = 0): Task[] =>
  Array.from({ length: count }, (_, step) => ({
    at: first + step,
    status: step < count / 2 ? 'backlog' : 'doing',
  }));

function resultOf(tasks: readonly Task[]): TableResult {
  return {
    columns: ['path', 'title', 'status', 'area'],
    rows: tasks.map(({ at, status, area }) => [`r${at}.md`, `Row ${at}`, status, area ?? 'home']),
    truncated: false,
    sql: '',
  };
}

function groupsOf(result: TableResult, subGroupBy: string | null = null): RowGroup[] {
  return groupResultRows({
    rows: toBoardRows(result),
    groups: viewGroupLevels({ type: TASK, groupBy: 'status', subGroupBy, sorts: [] }),
  });
}

/** A grouped table that folds as the app's does: its own folded set, toggled by a header. */
function Grouped({
  result,
  groups = groupsOf(result),
  folded = [],
  adds = true,
}: {
  result: TableResult;
  groups?: RowGroup[];
  folded?: readonly string[];
  adds?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(folded));
  const onToggle = (id: string) =>
    setCollapsed((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <TableView
      result={result}
      sorts={[]}
      error={null}
      schema={{ kinds: { status: 'select', area: 'select' }, labels: {}, noun: 'task' }}
      onOpenNote={() => {}}
      onEditCell={() => {}}
      onToggleSort={() => {}}
      grouping={{ groups, collapsed, onToggle, ...(adds && { onNew: () => {} }) }}
    />
  );
}

const headerAt = (line: number) =>
  document.querySelector(`tr[data-index="${line}"] .table__group-toggle`) as HTMLElement;

/** What holds the focus: a row's or header's text, or "<body>" when the focus is lost. */
function focused(): string {
  const at = document.activeElement;
  if (at === null || at === document.body) return '<body>';
  return at.textContent?.trim() ?? '';
}

/** Backlog's group id, as `groupResultRows` names it. */
const BACKLOG = groupsOf(resultOf(halves(2)))[0]?.id ?? '';

describe('#252 attack — a move waiting for its line while the lines change', () => {
  const { sheetOf, scrollSheet } = scrollableSheet();
  /**
   * The scroll lands, by hand as in the #244 tests (the stub does not
   * replay the virtualiser's own): first where the move asked, at `asked`,
   * then at the foot of the table, where End belongs — as a move that
   * re-aimed at the new last line would scroll next.
   */
  const landScroll = (asked: number) => {
    scrollSheet(sheetOf(), asked * ROW_ESTIMATE - 400);
    scrollSheet(sheetOf(), 400 * ROW_ESTIMATE);
  };

  it('End, then the folded group above it unfolded from the keyboard, still ends on the last row', () => {
    const result = resultOf(halves(300));
    render(<Grouped result={result} folded={[BACKLOG]} />);
    // Folded: Backlog's header (0), Doing's header (1), Rows 150–299 (2–151), "+ New" (152).
    headerAt(0).focus();
    fireEvent.keyDown(headerAt(0), { key: 'End' });
    // Enter on the header, before the scroll lands: a click with no press.
    fireEvent.click(headerAt(0));
    expect(headerAt(0).getAttribute('aria-expanded')).toBe('true');

    landScroll(151);
    // Line 151 is now Backlog's "+ New", which holds no stop: the move waits
    // for good, and the header it was asked from has scrolled away.
    expect(focused()).toBe('Row 299');
  });

  it('End, then the folded group above it unfolded, does not land on the next group’s header (no "+ New")', () => {
    const result = resultOf(halves(300));
    render(<Grouped result={result} folded={[BACKLOG]} adds={false} />);
    // Folded, without "+ New": Backlog (0), Doing (1), Rows 150–299 (2–151).
    headerAt(0).focus();
    fireEvent.keyDown(headerAt(0), { key: 'End' });
    fireEvent.click(headerAt(0));

    // The scroll lands where End asked, around line 151.
    scrollSheet(sheetOf(), 151 * ROW_ESTIMATE - 400);
    // Unfolded, line 151 is Doing's header: the move takes the focus there,
    // a line End never names.
    expect(focused()).not.toMatch(/^doing/i);
  });

  it('End, then a re-read that adds a row above, still ends on the last row', () => {
    const before = resultOf(halves(300));
    const view = render(<Grouped result={before} />);
    headerAt(0).focus();
    fireEvent.keyDown(headerAt(0), { key: 'End' });

    // The index reads again with one more Backlog task, at the top.
    const after = resultOf([{ at: 1000, status: 'backlog' }, ...halves(300)]);
    view.rerender(<Grouped result={after} />);

    landScroll(302);
    expect(focused()).toBe('Row 299');
  });

  it('End, then a re-read that removes rows, does not lose the focus to the body', () => {
    const before = resultOf(halves(300));
    const view = render(<Grouped result={before} />);
    headerAt(0).focus();
    fireEvent.keyDown(headerAt(0), { key: 'End' });

    // Ten Doing tasks are deleted before the scroll lands: line 302 is gone.
    const after = resultOf(halves(300).slice(0, 290));
    view.rerender(<Grouped result={after} />);

    landScroll(302);
    expect(screen.getByRole('button', { name: 'Row 289' })).toBeDefined();
    expect(focused()).not.toBe('<body>');
  });

  it('probe: a move waiting whose lines did not change still lands after an unrelated re-read', () => {
    const before = resultOf(halves(300));
    const view = render(<Grouped result={before} />);
    headerAt(0).focus();
    fireEvent.keyDown(headerAt(0), { key: 'End' });
    // Read again, the same rows as new arrays: every line where it was.
    view.rerender(<Grouped result={resultOf(halves(300))} />);

    landScroll(302);
    expect(focused()).toBe('Row 299');
  });
});

describe('#252 attack — probes of what held', () => {
  const { sheetOf, scrollSheet } = scrollableSheet();

  it('Down from an empty group’s header steps over its "+ New" to the next header', () => {
    const result = resultOf(halves(4));
    const [backlog, doing] = groupsOf(result);
    const empty: RowGroup = {
      ...(backlog as RowGroup),
      id: 'status:empty',
      label: 'Empty',
      rows: [],
    };
    render(<Grouped result={result} groups={[empty, backlog as RowGroup, doing as RowGroup]} />);
    // Empty's header (0), its "+ New" (1), Backlog's header (2).
    headerAt(0).focus();
    fireEvent.keyDown(headerAt(0), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(headerAt(2));
    fireEvent.keyDown(headerAt(2), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(headerAt(0));
  });

  it('End in a table whose last group is empty lands on that group’s header, not its "+ New"', () => {
    const result = resultOf(halves(4));
    const [backlog, doing] = groupsOf(result);
    const empty: RowGroup = {
      ...(doing as RowGroup),
      id: 'status:empty',
      label: 'Empty',
      rows: [],
    };
    render(<Grouped result={result} groups={[backlog as RowGroup, doing as RowGroup, empty]} />);
    headerAt(0).focus();
    fireEvent.keyDown(headerAt(0), { key: 'End' });
    expect(focused()).toMatch(/^Empty/);
  });

  it('End with the last group folded lands on its header', () => {
    const result = resultOf(halves(300));
    render(<Grouped result={result} folded={[groupsOf(result)[1]?.id ?? '']} />);
    headerAt(0).focus();
    fireEvent.keyDown(headerAt(0), { key: 'End' });
    scrollSheet(sheetOf(), 400 * ROW_ESTIMATE);
    expect(focused()).toMatch(/^doing/i);
  });

  it('Up from a sub-group’s first row goes to that sub-group’s header, then the group’s', () => {
    const tasks: Task[] = [
      { at: 0, status: 'backlog', area: 'home' },
      { at: 1, status: 'backlog', area: 'work' },
      { at: 2, status: 'doing', area: 'home' },
    ];
    const result = resultOf(tasks);
    render(<Grouped result={result} groups={groupsOf(result, 'area')} />);
    // Backlog (0), Home (1), Row 0 (2), "+ New" (3), Work (4), Row 1 (5), ...
    const row1 = screen.getByRole('button', { name: 'Row 1' });
    row1.focus();
    fireEvent.keyDown(row1, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(headerAt(4));
    fireEvent.keyDown(headerAt(4), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Row 0' }));
  });

  it('a held Down (key repeat) walks row by row and across a header, never to the body', () => {
    const result = resultOf(halves(20));
    render(<Grouped result={result} />);
    headerAt(0).focus();
    // Backlog (0), Rows 0–9 (1–10), "+ New" (11), Doing (12), Row 10 (13).
    for (let step = 0; step < 12; step += 1) {
      fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown', repeat: true });
      expect(focused()).not.toBe('<body>');
    }
    expect(focused()).toBe('Row 10');
  });

  it('three Downs that come before the next line is drawn move three lines, not one', () => {
    const result = resultOf(halves(300));
    render(<Grouped result={result} />);
    const drawn = [...document.querySelectorAll('tbody tr[data-index]')].map((line) =>
      Number(line.getAttribute('data-index')),
    );
    const edge = Math.max(...drawn);
    // Line n is Row n-1: the last row drawn.
    const last = screen.getByRole('button', { name: `Row ${edge - 1}` });
    last.focus();
    // A held key's repeats, faster than the frame that draws the next line:
    // the focus is still on the name, so each asks for the same line again.
    for (let step = 0; step < 3; step += 1) {
      fireEvent.keyDown(last, { key: 'ArrowDown', repeat: true });
    }
    scrollSheet(sheetOf(), 400);
    expect(focused()).toBe(`Row ${edge + 2}`);
  });

  it('an arrow from inside a cell being edited is left to the input', () => {
    const result = resultOf(halves(4));
    render(<Grouped result={result} />);
    fireEvent.click(screen.getAllByRole('button', { name: /^home$/i })[0] as HTMLElement);
    const editor = document.activeElement as HTMLElement;
    expect(editor.closest('tr')?.getAttribute('data-index')).toBe('1');
    const event = fireEvent.keyDown(editor, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(editor);
    // Not prevented: an open select or a text input keeps its own arrows.
    expect(event).toBe(true);
  });
});

describe('#252 attack — the flat table shares the hook (behaviour since #244)', () => {
  const { sheetOf, scrollSheet } = scrollableSheet();

  it('End, then a re-read that removes rows, does not lose the focus to the body', () => {
    const flat = (count: number): TableResult => ({
      columns: ['path', 'title'],
      rows: Array.from({ length: count }, (_, at) => [`r${at}.md`, `Row ${at}`]),
      truncated: false,
      sql: '',
    });
    const table = (result: TableResult) => (
      <TableView
        result={result}
        sorts={[]}
        error={null}
        schema={{ kinds: {}, labels: {}, noun: 'task' }}
        onOpenNote={() => {}}
        onEditCell={() => {}}
        onToggleSort={() => {}}
      />
    );
    const view = render(table(flat(300)));
    const first = screen.getByRole('button', { name: 'Row 0' });
    first.focus();
    fireEvent.keyDown(first, { key: 'End' });
    // Ten notes are deleted before the scroll lands: row 299 is gone.
    view.rerender(table(flat(290)));

    scrollSheet(sheetOf(), 400 * ROW_ESTIMATE);
    expect(screen.getByRole('button', { name: 'Row 289' })).toBeDefined();
    expect(focused()).not.toBe('<body>');
  });
});
