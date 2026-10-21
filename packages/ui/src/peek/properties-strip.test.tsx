// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type PropertyDef, type PropertyKind } from '@dfai/domain';
import type { PropertyRow } from '../properties-panel.tsx';
import { PropertiesStrip } from './properties-strip.tsx';

const row = (key: string, kind: PropertyKind, value: unknown): PropertyRow => ({
  def: {
    key,
    kind,
    label: key[0]!.toUpperCase() + key.slice(1),
    required: false,
    options: kind === 'select' ? ['Backlog', 'Doing', 'Done'] : [],
    target: null,
    many: false,
  } satisfies PropertyDef,
  value,
  error: null,
});

const ROWS: readonly PropertyRow[] = [
  row('status', 'select', 'Backlog'),
  row('phase', 'number', 15),
  row('estimate', 'text', null),
  row('due', 'date', null),
  row('notes', 'text', ''),
];

function show(overrides: Partial<Parameters<typeof PropertiesStrip>[0]> = {}) {
  const props = {
    path: createVaultPath('Tasks/Leftovers from A15-02.md'),
    typeName: 'task',
    rows: ROWS,
    relationChoices: {},
    onChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<PropertiesStrip {...props} />), props };
}

const shownLabels = () =>
  within(screen.getByRole('region', { name: 'Properties' }))
    .queryAllByRole('term')
    .map((term) => term.textContent);

describe('PropertiesStrip', () => {
  it('shows the filled properties and counts the empty ones as "+ N empty"', () => {
    show();
    expect(shownLabels()).toEqual(['Status', 'Phase']);
    expect(screen.getByRole('button', { name: '+ 3 empty' })).toBeDefined();
  });

  it('reveals exactly the rows it counted, in their own order, and hides them again', async () => {
    show();
    const fold = screen.getByRole('button', { name: '+ 3 empty' });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(fold);
    expect(shownLabels()).toEqual(['Status', 'Phase', 'Estimate', 'Due', 'Notes']);
    const hide = screen.getByRole('button', { name: 'Hide empty' });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(hide);
    expect(shownLabels()).toEqual(['Status', 'Phase']);
  });

  it('offers no fold when every property is filled', () => {
    show({ rows: [row('status', 'select', 'Doing')] });
    expect(screen.queryByRole('button', { name: /empty/ })).toBeNull();
  });

  it("commits an edit through the page's onChange, once", async () => {
    const { props } = show();
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'Done');
    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(props.onChange).toHaveBeenCalledWith('status', 'Done');
  });

  it('folds the next note afresh, from the rows that come with it', async () => {
    const { rerender, props } = show();
    await userEvent.click(screen.getByRole('button', { name: '+ 3 empty' }));
    rerender(
      <PropertiesStrip
        {...props}
        path={createVaultPath('Tasks/Another.md')}
        rows={[row('status', 'select', 'Done'), row('due', 'date', null)]}
      />,
    );
    expect(shownLabels()).toEqual(['Status']);
    expect(screen.getByRole('button', { name: '+ 1 empty' })).toBeDefined();
  });
});
