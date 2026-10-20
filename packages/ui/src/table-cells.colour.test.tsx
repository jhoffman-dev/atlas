// @vitest-environment jsdom
/**
 * A table's pills carry colour (#413): a select's option, each of a
 * multi-select's, and each note a relation links — the same value the same
 * colour in every row, and the colour a type chose where it chose one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createVaultPath, hueOf, noteNames, relationHue, type PropertyDef } from '@atlas/domain';
import { NoteNamesProvider } from './note-names.tsx';
import { TableView, type TableResult, type TableSchema } from './table-view.tsx';

afterEach(cleanup);

function def(key: string, kind: PropertyDef['kind'], more: Partial<PropertyDef> = {}): PropertyDef {
  return {
    key,
    kind,
    label: key,
    required: false,
    options: [],
    target: null,
    many: false,
    ...more,
  };
}

const properties: Record<string, PropertyDef> = {
  kind: def('kind', 'select', {
    options: ['Interview', '1on1', 'Review'],
    colors: { '1on1': 'green' },
  }),
  labels: def('labels', 'multiSelect', { options: ['payroll', 'renewal'] }),
  companies: def('companies', 'relation', { target: 'company', many: true }),
  status: def('status', 'select', { options: ['doing', 'done'] }),
};

const schema: TableSchema = {
  kinds: Object.fromEntries(Object.values(properties).map((p) => [p.key, p.kind])),
  labels: {},
  noun: 'meeting',
  properties,
};

const result: TableResult = {
  columns: ['path', 'title', 'kind', 'labels', 'companies', 'status'],
  rows: [
    ['a.md', 'Kickoff', 'Interview', ['payroll', 'renewal'], ['[[Larkspur Payroll]]'], 'doing'],
    ['b.md', 'Catch-up', '1on1', ['payroll'], ['[[Larkspur Payroll]]', '[[fenn-co]]'], 'done'],
    ['d.md', 'Debrief', 'Interview', null, null, null],
    ['c.md', 'Review', 'Review', null, ['[[Larkspur Payroll|Larkspur]]'], null],
  ],
  truncated: false,
  sql: '',
};

const names = noteNames([
  { path: createVaultPath('companies/Larkspur Payroll.md'), title: 'Larkspur Payroll' },
  { path: createVaultPath('companies/fenn-co.md'), title: 'Fenn & Co' },
]);

function table(known = names) {
  return render(
    <NoteNamesProvider value={known}>
      <TableView
        result={result}
        sorts={[]}
        error={null}
        schema={schema}
        onOpenNote={vi.fn()}
        onToggleSort={vi.fn()}
      />
    </NoteNamesProvider>,
  );
}

describe('a table’s pills', () => {
  it('draws a select in the hue its value gives it, the same in every row', () => {
    const { container } = table();
    const interviews = [...container.querySelectorAll('.status-pill')].filter(
      (pill) => pill.textContent === 'Interview',
    );
    expect(interviews).toHaveLength(2);
    for (const pill of interviews) {
      expect(pill.getAttribute('data-hue')).toBe(hueOf('Interview'));
    }
  });

  it('draws an option in the colour its type chose', () => {
    const { container } = table();
    const oneOnOne = [...container.querySelectorAll('.status-pill')].find(
      (pill) => pill.textContent === '1on1',
    );
    expect(oneOnOne?.getAttribute('data-hue')).toBe('green');
  });

  it('keeps a status in its tone, dot and all', () => {
    const { container } = table();
    const doing = [...container.querySelectorAll('.status-pill')].find(
      (pill) => pill.textContent === 'Doing',
    );
    expect(doing?.getAttribute('data-tone')).toBe('doing');
    expect(doing?.querySelector('.status-pill__dot')).not.toBeNull();
  });

  it('draws a non-status option spelled like a status as a hue, with no status dot', () => {
    const { container } = table();
    const review = [...container.querySelectorAll('.status-pill')].find(
      (pill) => pill.textContent === 'Review',
    );
    expect(review?.getAttribute('data-hue')).toBe(hueOf('Review'));
    expect(review?.getAttribute('data-tone')).toBeNull();
    expect(review?.querySelector('.status-pill__dot')).toBeNull();
  });

  it('draws each of a multi-select’s options as its own pill', () => {
    const { container } = table();
    const firstRow = container.querySelector('tbody tr');
    const labels = [...(firstRow?.querySelectorAll('.table__pills .status-pill') ?? [])];
    expect(labels.map((pill) => pill.textContent)).toEqual(['Payroll', 'Renewal']);
    expect(labels.map((pill) => pill.getAttribute('data-hue'))).toEqual([
      hueOf('payroll'),
      hueOf('renewal'),
    ]);
  });

  it('draws each linked note in its name’s hue, the same in every row', () => {
    const { container } = table();
    const larkspur = [...container.querySelectorAll('.table__note')].filter(
      (chip) => chip.textContent === 'Larkspur Payroll',
    );
    expect(larkspur).toHaveLength(2);
    for (const chip of larkspur) {
      expect(chip.getAttribute('data-hue')).toBe(relationHue({ key: 'Larkspur Payroll' }));
    }
    const fenn = [...container.querySelectorAll('.table__note')].find(
      (chip) => chip.textContent === 'Fenn & Co',
    );
    expect(fenn?.getAttribute('data-hue')).toBe(relationHue({ key: 'fenn-co' }));
  });

  it('colours an aliased link as the note it names, not as its alias', () => {
    const { container } = table();
    const aliased = [...container.querySelectorAll('.table__note')].find(
      (chip) => chip.textContent === 'Larkspur',
    );
    expect(aliased?.getAttribute('data-hue')).toBe(relationHue({ key: 'Larkspur Payroll' }));
  });

  it('keeps a titled note’s hue the same before its title is known and after', () => {
    const hueOfFenn = (container: HTMLElement) =>
      [...container.querySelectorAll('.table__note')]
        .find((chip) => /fenn/i.test(chip.textContent ?? ''))
        ?.getAttribute('data-hue');
    const before = hueOfFenn(table(noteNames(null)).container);
    cleanup();
    const after = hueOfFenn(table().container);
    expect(before).toBeDefined();
    expect(after).toBe(before);
  });

  it('leaves a link to a missing note uncoloured', () => {
    const missing = noteNames([]);
    const { container } = render(
      <NoteNamesProvider value={missing}>
        <TableView
          result={result}
          sorts={[]}
          error={null}
          schema={schema}
          onOpenNote={vi.fn()}
          onToggleSort={vi.fn()}
        />
      </NoteNamesProvider>,
    );
    const chips = [...container.querySelectorAll('.table__note')];
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) expect(chip.getAttribute('data-hue')).toBeNull();
  });
});
