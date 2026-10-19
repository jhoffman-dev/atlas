// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type PropertyDef, type PropertyKind } from '@atlas/domain';
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

type PaneProps = Parameters<typeof PropertiesPane>[0];

function show(overrides: Partial<PaneProps> = {}) {
  const props: PaneProps = {
    context: 'Task · selected row',
    title: 'Larkspur payroll import stalls',
    path: createVaultPath('Tasks/Larkspur payroll import stalls.md'),
    typeName: 'task',
    rows: [row('status', 'select', 'Doing'), row('estimate', 'number', null)],
    relationChoices: {},
    onChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<PropertiesPane {...props} />), props };
}

const region = () => screen.getByRole('region', { name: 'Properties' });

describe('PropertiesPane commit rules (attack #353)', () => {
  it('writes a checkbox tick once, as a boolean', async () => {
    const { props } = show({ rows: [row('done', 'checkbox', false)] });
    await userEvent.click(screen.getByLabelText('Done'));
    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(props.onChange).toHaveBeenCalledWith('done', true);
  });

  it('writes a typed number once per keystroke, the last one the whole number', async () => {
    const { props } = show({ rows: [row('estimate', 'number', 3)] });
    const field = screen.getByLabelText('Estimate');
    await userEvent.clear(field);
    await userEvent.type(field, '412');
    expect(props.onChange).toHaveBeenLastCalledWith('estimate', 412);
    // clear (null) + 4 + 41 + 412
    expect(props.onChange).toHaveBeenCalledTimes(4);
  });

  it('does not write on focus and blur alone', async () => {
    const { props } = show({ rows: [row('notes', 'text', 'Mara Quill to confirm')] });
    const field = screen.getByLabelText('Notes');
    field.focus();
    fireEvent.blur(field);
    expect(props.onChange).not.toHaveBeenCalled();
  });
});

describe('PropertiesPane fold (attack #353)', () => {
  it('counts many empty properties among many in the plural', () => {
    const rows = Array.from({ length: 60 }, (_, at) =>
      row(`field${String(at).padStart(2, '0')}`, 'text', at % 3 === 0 ? `value ${at}` : null),
    );
    show({ rows });
    expect(screen.getByRole('button', { name: '40 empty properties' })).toBeDefined();
    expect(within(region()).getAllByRole('term')).toHaveLength(20);
  });

  it('keeps the fold button focused across its own toggle', async () => {
    show();
    const fold = screen.getByRole('button', { name: '1 empty property' });
    await userEvent.click(fold);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Hide 1 empty property' }),
    );
  });

  it('still offers "Add a property" on an untyped note whose properties are all folded away', () => {
    show({
      typeName: null,
      rows: [row('estimate', 'number', null), row('notes', 'text', '')],
      onAdd: vi.fn(async () => 'extra'),
    });
    // The page's panel offers the add for these rows; folding them must not
    // take the add away with them.
    expect(screen.getByRole('button', { name: 'Add a property' })).toBeDefined();
  });

  it('keeps an untyped note’s rows reachable: the fold still unfolds them', async () => {
    show({ typeName: null, rows: [row('notes', 'text', '')] });
    await userEvent.click(screen.getByRole('button', { name: '1 empty property' }));
    expect(screen.getByLabelText('Notes')).toBeDefined();
  });

  // Known from review: the fold filters live. Pinned here.
  it('keeps a filled row on screen, and focused, when it is cleared while folded', async () => {
    const rows = [row('notes', 'text', 'Tobias Fenn'), row('estimate', 'number', null)];
    const { rerender, props } = show({ rows });
    const field = screen.getByLabelText('Notes');
    field.focus();
    rerender(<PropertiesPane {...props} rows={[row('notes', 'text', null), rows[1]!]} />);
    expect(screen.queryByLabelText('Notes')).not.toBeNull();
    expect(document.activeElement).toBe(screen.queryByLabelText('Notes'));
  });

  // Known from review: an added (empty) property is folded away before it can be focused.
  it('draws a property the moment it arrives, though it is empty', () => {
    const rows = [row('status', 'select', 'Doing')];
    const { rerender, props } = show({ rows, onAdd: vi.fn(async () => 'owner') });
    rerender(<PropertiesPane {...props} rows={[...rows, row('owner', 'text', null)]} />);
    expect(screen.queryByLabelText('Owner')).not.toBeNull();
  });
});

describe('PropertiesPane foot (attack #353)', () => {
  it('offers only Open when only onOpen is given', () => {
    show({ onOpen: vi.fn() });
    expect(screen.getByRole('button', { name: 'Open' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'New tab' })).toBeNull();
  });

  it('offers only New tab when only onOpenInNewTab is given', () => {
    show({ onOpenInNewTab: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.getByRole('button', { name: 'New tab' })).toBeDefined();
  });

  it('skips a summary of whitespace alone', () => {
    show({ summary: '  \n ' });
    expect(screen.queryByRole('region', { name: 'Summary' })).toBeNull();
  });
});
