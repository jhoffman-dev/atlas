// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type PropertyDef, type PropertyKind } from '@dfai/domain';
import type { PropertyRow } from '../properties-panel.tsx';
import { PropertiesPane } from './properties-pane.tsx';

const row = (key: string, kind: PropertyKind, value: unknown): PropertyRow => ({
  def: {
    key,
    kind,
    label: key[0]!.toUpperCase() + key.slice(1),
    required: false,
    options: kind === 'select' ? ['Doing', 'Done'] : [],
    target: null,
    many: false,
  } satisfies PropertyDef,
  value,
  error: null,
});

const ROWS: readonly PropertyRow[] = [
  row('status', 'select', 'Doing'),
  row('due', 'date', '2026-10-21'),
  row('estimate', 'number', null),
  row('notes', 'text', ''),
];

function show(overrides: Partial<Parameters<typeof PropertiesPane>[0]> = {}) {
  const props = {
    context: 'Task · selected row',
    title: 'Cmd+N still fires behind an open palette',
    path: createVaultPath('Tasks/Cmd+N still fires.md'),
    typeName: 'task',
    rows: ROWS,
    relationChoices: {},
    onChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<PropertiesPane {...props} />), props };
}

describe('PropertiesPane', () => {
  it('heads itself with what is shown and its title', () => {
    show();
    expect(screen.getByText('Task · selected row')).toBeDefined();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Cmd+N still fires behind an open palette' }),
    ).toBeDefined();
  });

  it('shows the filled properties and folds the empty ones behind a count', () => {
    show();
    const rows = screen.getByRole('region', { name: 'Properties' });
    expect(within(rows).getByLabelText('Status')).toBeDefined();
    expect(within(rows).getByLabelText('Due')).toBeDefined();
    expect(within(rows).queryByLabelText('Estimate')).toBeNull();
    expect(within(rows).queryByLabelText('Notes')).toBeNull();
    expect(screen.getByRole('button', { name: '2 empty properties' })).toBeDefined();
  });

  it('unfolds the empty properties on request, in their own order, and folds them again', async () => {
    show();
    const fold = screen.getByRole('button', { name: '2 empty properties' });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(fold);
    const rows = screen.getByRole('region', { name: 'Properties' });
    expect(within(rows).getByLabelText('Estimate')).toBeDefined();
    expect(within(rows).getByLabelText('Notes')).toBeDefined();
    const labels = within(rows)
      .getAllByRole('term')
      .map((term) => term.textContent);
    expect(labels).toEqual(['Status', 'Due', 'Estimate', 'Notes']);
    const unfold = screen.getByRole('button', { name: 'Hide 2 empty properties' });
    expect(unfold.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(unfold);
    expect(within(rows).queryByLabelText('Estimate')).toBeNull();
  });

  it('counts one empty property in the singular, and none at all with no button', () => {
    show({ rows: [row('status', 'select', 'Doing'), row('notes', 'text', null)] });
    expect(screen.getByRole('button', { name: '1 empty property' })).toBeDefined();
  });

  it('offers no fold when every property is filled', () => {
    show({ rows: [row('status', 'select', 'Doing')] });
    expect(screen.queryByRole('button', { name: /empty propert/ })).toBeNull();
  });

  it('writes an edit through the same onChange a page’s panel uses, once', async () => {
    const { props } = show();
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'Done');
    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(props.onChange).toHaveBeenCalledWith('status', 'Done');
  });

  it('decides the fold afresh for the next note, from the rows that come with it', async () => {
    const { rerender, props } = show();
    await userEvent.click(screen.getByRole('button', { name: '2 empty properties' }));
    expect(screen.getByLabelText('Estimate')).toBeDefined();
    // Another note: Estimate is filled now, Due and Notes are not. Its empties
    // fold, folded, whatever the last note's fold was.
    rerender(
      <PropertiesPane
        {...props}
        path={createVaultPath('Tasks/Another.md')}
        rows={[
          row('status', 'select', 'Done'),
          row('due', 'date', null),
          row('estimate', 'number', 3),
          row('notes', 'text', ''),
        ]}
      />,
    );
    const rows = screen.getByRole('region', { name: 'Properties' });
    expect(within(rows).getByLabelText('Estimate')).toBeDefined();
    expect(within(rows).queryByLabelText('Due')).toBeNull();
    expect(within(rows).queryByLabelText('Notes')).toBeNull();
    expect(screen.getByRole('button', { name: '2 empty properties' })).toBeDefined();
  });

  it('reads the summary under the rows, and skips the block when there is none', () => {
    const { unmount } = show({ summary: 'The one-overlay rule keeps a second palette out.' });
    expect(screen.getByText('Summary')).toBeDefined();
    expect(screen.getByText('The one-overlay rule keeps a second palette out.')).toBeDefined();
    unmount();
    show({ summary: null });
    expect(screen.queryByText('Summary')).toBeNull();
  });

  it('offers Open and New tab at its foot only when the app gives them, and hands each up', async () => {
    const { props, unmount } = show({ onOpen: vi.fn(), onOpenInNewTab: vi.fn() });
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(props.onOpen).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'New tab' }));
    expect(props.onOpenInNewTab).toHaveBeenCalledTimes(1);
    unmount();
    show();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New tab' })).toBeNull();
  });
});
