// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type ViewTab } from '@atlas/domain';
import { ViewTabs, type ViewTabEditing } from './view-tabs.tsx';

/**
 * Adversarial pass on issue #11 (ADR-0023): moving a type's tabs from the
 * keyboard. A move is written, then the tabs are re-read from the files — and
 * the person at the keyboard does not wait for that.
 */

const tab = (title: string, selected = false): ViewTab => ({
  path: createVaultPath(`.atlas/views/${title}.md`),
  title,
  icon: 'table',
  selected,
  virtual: false,
  movable: true,
  deletable: true,
});

const editing = (onMove: ViewTabEditing['onMove']): ViewTabEditing => ({
  typeLabel: 'Task',
  layouts: [],
  onAdd: vi.fn(),
  onRename: vi.fn(),
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
  onMove,
  onEditType: vi.fn(),
});

const strip = () => within(screen.getByRole('navigation', { name: 'Views' }));

describe('Alt+← pressed twice before the tabs are re-read', () => {
  it('asks for the tab two places along, not the same place twice', async () => {
    const onMove = vi.fn();
    const tabs = [tab('Alpha', true), tab('Beta'), tab('Gamma')];
    render(<ViewTabs tabs={tabs} onOpenView={vi.fn()} editing={editing(onMove)} />);

    strip().getByRole('button', { name: 'Gamma' }).focus();
    await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}');
    await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}');

    expect(onMove.mock.calls.map(([args]) => (args as { to: number }).to)).toEqual([1, 0]);
  });
});
