// @vitest-environment jsdom
/**
 * Attacks on the board restyle (#297): the card's metadata line, the column
 * head's decorative dot, and the copy at a column's foot.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  noteNames,
  relationHue,
  UNGROUPED_LABEL,
  type BoardColumn,
  type BoardRow,
  type PropertyKind,
  type VaultPath,
} from '@dfai/domain';
import { BoardView } from './board-view.tsx';
import { NoteNamesProvider } from './note-names.tsx';
import { StatusPill } from './status-pill.tsx';

const noop = () => {};

function oneCard({
  values,
  fields,
  kinds = {},
  groupBy = 'status',
}: {
  values: Record<string, unknown>;
  fields: readonly string[];
  kinds?: Record<string, PropertyKind>;
  groupBy?: string;
}) {
  const columns: BoardColumn[] = [
    {
      value: 'backlog',
      label: 'backlog',
      rows: [{ path: 'a.md', title: 'First', values: { status: 'backlog', ...values } }],
    },
  ];
  return render(
    <BoardView
      columns={columns}
      groupBy={groupBy}
      fields={fields}
      kinds={kinds}
      onOpenNote={noop}
      onMoveCard={noop}
      onAddCard={noop}
    />,
  );
}

const metaText = () => document.querySelector('.board__meta')?.textContent ?? null;
const metaItems = () =>
  [...document.querySelectorAll('.board__meta-item')].map((item) => item.textContent);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the metadata line: a select’s empty values are left off', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['the empty string', ''],
    ['whitespace', '   '],
  ])('leaves off a select whose value is %s', (_name, value) => {
    oneCard({ values: { stage: value }, fields: ['stage'], kinds: { stage: 'select' } });
    expect(metaText()).toBeNull();
  });

  it('leaves off a select whose value is false, as a chip leaves off false', () => {
    oneCard({ values: { stage: false }, fields: ['stage'], kinds: { stage: 'select' } });
    expect(metaText()).toBeNull();
  });

  it('writes a select whose value is a number as that number', () => {
    oneCard({ values: { stage: 3 }, fields: ['stage'], kinds: { stage: 'select' } });
    expect(metaText()).toBe('3');
  });

  it('writes a GTD select value as its label', () => {
    oneCard({ values: { stage: 'next-action' }, fields: ['stage'], kinds: { stage: 'select' } });
    expect(metaText()).toBe('Next Action');
  });
});

describe('the metadata line: which fields it shows, and in what order', () => {
  it('omits the grouping property even when it is a select', () => {
    oneCard({
      values: { phase: 2 },
      fields: ['status', 'phase'],
      kinds: { status: 'select' },
    });
    expect(metaText()).toBe('Phase 2');
  });

  it('omits title, summary and path, which have places of their own', () => {
    oneCard({
      values: { path: 'a.md', title: 'First', summary: 'About it', phase: 2 },
      fields: ['path', 'title', 'summary', 'phase'],
    });
    expect(metaText()).toBe('Phase 2');
    expect(document.querySelector('.board__summary')?.textContent).toBe('About it');
  });

  it('writes a field listed twice once', () => {
    oneCard({ values: { phase: 2 }, fields: ['phase', 'phase'] });
    expect(metaItems()).toEqual(['Phase 2']);
  });

  it('draws a field listed twice without React warning of a repeated key', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    oneCard({
      values: { stage: 'review' },
      fields: ['stage', 'stage'],
      kinds: { stage: 'select' },
    });
    const keyWarnings = error.mock.calls.filter((call) => String(call[0]).includes('same key'));
    expect(keyWarnings).toEqual([]);
  });

  it('keeps the view’s order when a choice comes after another field', () => {
    oneCard({
      values: { phase: 14, stage: 'review' },
      fields: ['phase', 'stage'],
      kinds: { stage: 'select' },
    });
    // CardLook.fields: "Properties to show on the metadata line, in the view's order."
    // The choice is a pill (#413), set apart by its fill rather than a dot.
    expect(metaText()).toBe('Phase 14 Review');
    const line = document.querySelector('.board__meta');
    expect([...(line?.children ?? [])].map((child) => child.textContent)).toEqual([
      'Phase 14',
      'Review',
    ]);
    expect(line?.querySelector('.status-pill')?.textContent).toBe('Review');
  });

  it('is one paragraph however many values it holds', () => {
    const values = Object.fromEntries(
      Array.from({ length: 12 }, (_, at) => [`f${at}`, `value number ${at} that is long`]),
    );
    oneCard({ values, fields: Object.keys(values) });
    expect(document.querySelectorAll('.board__meta')).toHaveLength(1);
    expect(document.querySelector('.board__meta')?.tagName).toBe('P');
    expect(document.querySelectorAll('.board__meta-item')).toHaveLength(12);
    expect(document.querySelectorAll('.board__meta-sep')).toHaveLength(11);
    expect(
      [...document.querySelectorAll('.board__meta-sep')].every(
        (sep) => sep.getAttribute('aria-hidden') === 'true',
      ),
    ).toBe(true);
  });
});

describe('the metadata line: a relation', () => {
  function relationCard(project: unknown) {
    return render(
      <NoteNamesProvider value={noteNames([{ path: 'Here.md' as VaultPath, title: 'Here' }])}>
        <BoardView
          columns={[
            {
              value: 'backlog',
              label: 'backlog',
              rows: [{ path: 'a.md', title: 'First', values: { status: 'backlog', project } }],
            },
          ]}
          groupBy="status"
          fields={['project']}
          kinds={{ project: 'relation' }}
          onOpenNote={noop}
          onMoveCard={noop}
          onAddCard={noop}
        />
      </NoteNamesProvider>,
    );
  }

  it('draws each linked note on its own: one there as a pill, one missing struck', () => {
    relationCard(['[[Here]]', '[[Gone]]']);
    const pill = document.querySelector('.board__meta .status-pill');
    expect(pill?.textContent).toBe('Here');
    expect(pill?.getAttribute('data-hue')).toBe(relationHue({ key: 'Here' }));
    const gone = document.querySelector('.board__meta-item');
    expect(gone?.textContent).toBe('Gone');
    expect(gone?.getAttribute('data-missing')).toBe('true');
  });

  it('strikes a relation array whose every note is missing', () => {
    relationCard(['[[Gone]]', '[[Also gone]]']);
    expect(document.querySelector('.board__meta-item')?.getAttribute('data-missing')).toBe('true');
  });
});

describe('the card face: accessibility', () => {
  it('names the title button by the plain title, clamp span and all', () => {
    oneCard({ values: {}, fields: [] });
    const button = screen.getByRole('button', { name: 'First' });
    expect(button.querySelector('.board__title-text')?.textContent).toBe('First');
  });

  it('gives a done column’s card exactly one “Done” image, and its head none', () => {
    render(
      <BoardView
        columns={[
          {
            value: 'done',
            label: 'done',
            rows: [{ path: 'a.md', title: 'First', values: { status: 'done' } }],
          },
        ]}
        groupBy="status"
        fields={[]}
        onOpenNote={noop}
        onMoveCard={noop}
        onAddCard={noop}
      />,
    );
    const region = screen.getByRole('region', { name: 'Done' });
    const header = region.querySelector('header') as HTMLElement;
    expect(within(header).queryAllByRole('img')).toHaveLength(0);
    expect(within(region).getAllByRole('img')).toHaveLength(1);
    expect(within(region).getByRole('img', { name: 'Done' })).toBeDefined();
  });
});

describe('StatusPill’s decorative prop', () => {
  it('is a no-op on the pill variant, whose label is inside it', () => {
    const { container } = render(<StatusPill value="doing" decorative />);
    const pill = container.querySelector('.status-pill') as HTMLElement;
    expect(pill.getAttribute('aria-hidden')).toBeNull();
    expect(pill.textContent).toBe('Doing');
    expect(screen.getByText('Doing')).toBeDefined();
  });

  it('hides a decorative dot with an empty value, with no role or label', () => {
    const { container } = render(<StatusPill value="" variant="dot" decorative />);
    const dot = container.querySelector('.status-pill--dot') as HTMLElement;
    expect(dot.getAttribute('aria-hidden')).toBe('true');
    expect(dot.getAttribute('role')).toBeNull();
    expect(dot.getAttribute('aria-label')).toBeNull();
  });

  it('still names a non-decorative dot with an empty value', () => {
    render(<StatusPill value="" variant="dot" />);
    expect(screen.getByRole('img', { name: 'No status' })).toBeDefined();
  });
});

describe('a column’s heading', () => {
  function board(columns: BoardColumn[]) {
    return render(
      <BoardView
        columns={columns}
        groupBy="status"
        fields={[]}
        onOpenNote={noop}
        onMoveCard={noop}
        onAddCard={noop}
      />,
    );
  }
  const head = (name: string) =>
    screen.getByRole('region', { name }).querySelector('header') as HTMLElement;

  it('tones a status column with no tone by its name, and writes its label', () => {
    board([{ value: 'done', label: 'done', rows: [] }]);
    expect(head('Done').querySelector('.status-pill--dot')?.getAttribute('data-tone')).toBe('done');
    expect(head('Done').querySelector('.board__group-label')?.textContent).toBe('Done');
  });

  it('heads a tone-null column with its raw label and no dot', () => {
    board([{ value: 'next-action', label: 'next-action', rows: [], tone: null }]);
    expect(head('next-action').querySelector('.status-pill')).toBeNull();
    expect(head('next-action').querySelector('.board__group-label')?.textContent).toBe(
      'next-action',
    );
  });

  it('heads the “No value” column with its words and no dot', () => {
    const row: BoardRow = { path: 'a.md', title: 'First', values: {} };
    board([{ value: null, label: UNGROUPED_LABEL, rows: [row], tone: null }]);
    expect(head(UNGROUPED_LABEL).querySelector('.status-pill')).toBeNull();
    expect(head(UNGROUPED_LABEL).querySelector('.board__group-label')?.textContent).toBe(
      'No value',
    );
  });

  it.each([
    ['next-action', 'Next Action'],
    ['-dash', '-dash'],
    ['mIxEd', 'MIxEd'],
  ])('writes the label %s through optionLabel as %s', (label, shown) => {
    board([{ value: label, label, rows: [] }]);
    expect(head(shown).querySelector('.board__group-label')?.textContent).toBe(shown);
    expect(within(head(shown)).queryAllByRole('img')).toHaveLength(0);
  });
});

describe('a column’s foot', () => {
  const rows = (count: number): BoardRow[] =>
    Array.from({ length: count }, (_, at) => ({
      path: `t${at}.md`,
      title: `Task ${at}`,
      values: { status: 'backlog' },
    }));
  function board(count: number) {
    return render(
      <BoardView
        columns={[{ value: 'backlog', label: 'backlog', rows: rows(count) }]}
        groupBy="status"
        fields={[]}
        onOpenNote={noop}
        onMoveCard={noop}
        onAddCard={noop}
      />,
    );
  }

  it('shows a column one past the preview whole, with no “N more”', () => {
    board(5);
    expect(screen.queryByRole('button', { name: /more$/ })).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(5);
  });

  it('writes “N more” without a plus, then “Show fewer” once open', async () => {
    board(6);
    const more = screen.getByRole('button', { name: '2 more' });
    expect(more.textContent).toBe('2 more');
    await userEvent.click(more);
    expect(screen.getAllByRole('article')).toHaveLength(6);
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.getByRole('button', { name: '2 more' })).toBeDefined();
  });

  it('says “No tasks” only in an empty column, and not while adding to it', async () => {
    board(0);
    expect(screen.getByText('No tasks')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Add to Backlog' }));
    expect(screen.queryByText('No tasks')).toBeNull();
  });
});
