// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type ViewTab } from '@atlas/domain';
import { ViewTabs, type ViewTabEditing } from './view-tabs.tsx';

const tab = (title: string, icon: ViewTab['icon'], selected = false, virtual = false): ViewTab => ({
  path: createVaultPath(`.atlas/views/${title}.md`),
  title,
  icon,
  selected,
  virtual,
  movable: !virtual,
  deletable: !virtual,
});

const TABS = [tab('Board', 'board', true), tab('All tasks', 'table'), tab('Roadmap', 'timeline')];

function editing(overrides: Partial<ViewTabEditing> = {}): ViewTabEditing {
  return {
    typeLabel: 'Task',
    layouts: [
      { layout: 'table', available: true, reason: null },
      { layout: 'board', available: true, reason: null },
      {
        layout: 'calendar',
        available: false,
        reason: 'A calendar needs a date, and Task has no date property.',
      },
    ],
    onAdd: vi.fn(),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onMove: vi.fn(),
    onEditType: vi.fn(),
    onEditTemplate: vi.fn(),
    ...overrides,
  };
}

function show({
  tabs = TABS,
  edit,
}: { tabs?: readonly ViewTab[]; edit?: ViewTabEditing | null } = {}) {
  const onOpenView = vi.fn();
  const given = edit === undefined ? editing() : (edit ?? undefined);
  render(<ViewTabs tabs={tabs} onOpenView={onOpenView} editing={given} />);
  return { onOpenView, edit: given ?? editing() };
}

const strip = () => within(screen.getByRole('navigation', { name: 'Views' }));
const names = () =>
  strip()
    .getAllByRole('button')
    .filter((button) => button.classList.contains('view-tabs__tab'))
    .map((button) => button.textContent);

async function openOptions() {
  await userEvent.click(strip().getByRole('button', { name: 'View options' }));
  return within(await screen.findByRole('menu', { name: 'View options' }));
}

describe('ViewTabs on a type', () => {
  it('offers options on the selected tab only', () => {
    show();
    const options = strip().getAllByRole('button', { name: 'View options' });
    expect(options).toHaveLength(1);
    expect(options[0]?.closest('.view-tabs__item')?.textContent).toBe('Board');
  });

  it('adds a view in the layout chosen from "+", and says why a layout is not offered', async () => {
    const { edit } = show();
    await userEvent.click(strip().getByRole('button', { name: 'Add a view' }));
    const menu = within(await screen.findByRole('menu', { name: 'Add a view' }));
    expect(menu.getByText(/A calendar needs a date/)).toBeTruthy();
    expect(menu.getByRole('menuitem', { name: /Calendar/ }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    await userEvent.click(menu.getByRole('menuitem', { name: /Board/ }));
    expect(edit.onAdd).toHaveBeenCalledExactlyOnceWith('board');
  });

  it('renames the selected tab in place: Enter commits, Escape leaves it as it was', async () => {
    const { edit } = show();
    await userEvent.click((await openOptions()).getByRole('menuitem', { name: 'Rename' }));
    const field = strip().getByRole('textbox', { name: 'View name' });
    expect(document.activeElement).toBe(field);
    await userEvent.clear(field);
    await userEvent.type(field, 'Sprint{Enter}');
    expect(edit.onRename).toHaveBeenCalledExactlyOnceWith({
      path: '.atlas/views/Board.md',
      name: 'Sprint',
    });
    expect(strip().queryByRole('textbox', { name: 'View name' })).toBeNull();

    await userEvent.click((await openOptions()).getByRole('menuitem', { name: 'Rename' }));
    await userEvent.type(strip().getByRole('textbox', { name: 'View name' }), ' later{Escape}');
    expect(edit.onRename).toHaveBeenCalledTimes(1);
  });

  it('duplicates, opens the type, and asks to delete the selected view', async () => {
    const { edit } = show();
    const options = await openOptions();
    // The type is opened from the gear beside the tabs, not from a view's menu.
    expect(options.queryByRole('menuitem', { name: /type/ })).toBeNull();
    await userEvent.click(options.getByRole('menuitem', { name: 'Duplicate' }));
    expect(edit.onDuplicate).toHaveBeenCalledExactlyOnceWith('.atlas/views/Board.md');
    await userEvent.click(strip().getByRole('button', { name: 'Edit Task type' }));
    expect(edit.onEditType).toHaveBeenCalledOnce();
    await userEvent.click((await openOptions()).getByRole('menuitem', { name: 'Delete view' }));
    expect(edit.onDelete).toHaveBeenCalledExactlyOnceWith('.atlas/views/Board.md');
  });

  it('moves a tab with Alt+arrows, stops at the ends, and says where it went', async () => {
    const { edit } = show();
    strip().getByRole('button', { name: 'All tasks' }).focus();
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(edit.onMove).toHaveBeenLastCalledWith({ path: '.atlas/views/All tasks.md', to: 2 });
    expect(strip().getByText('All tasks moved to tab 3 of 3.').getAttribute('role')).toBe('status');

    strip().getByRole('button', { name: 'Board' }).focus();
    await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}');
    await userEvent.keyboard('{ArrowRight}');
    expect(edit.onMove).toHaveBeenCalledTimes(1);
  });

  it('says a movable tab moves with Alt+arrows, to assistive technology too', () => {
    show();
    expect(strip().getByRole('button', { name: 'Board' }).getAttribute('aria-keyshortcuts')).toBe(
      'Alt+ArrowLeft Alt+ArrowRight',
    );
    show({ tabs: [tab('Task table', 'table', true, true)] });
    expect(
      screen.getAllByRole('button', { name: 'Task table' })[0]!.getAttribute('aria-keyshortcuts'),
    ).toBeNull();
  });

  it('moves and deletes only what each tab says it can', async () => {
    const fixed = { ...tab('Board', 'board', true), movable: false, deletable: false };
    const { edit } = show({ tabs: [fixed, tab('All tasks', 'table')] });
    expect((await openOptions()).queryByRole('menuitem', { name: 'Delete view' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    strip().getByRole('button', { name: 'Board' }).focus();
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(edit.onMove).not.toHaveBeenCalled();
  });

  it('shows a moved tab in its new place before the tabs are read again', async () => {
    show();
    strip().getByRole('button', { name: 'Board' }).focus();
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(names()).toEqual(['All tasks', 'Board', 'Roadmap']);
    expect(document.activeElement?.textContent).toBe('Board');
  });

  it('puts a tab back where it was when its move fails', async () => {
    let fail: (cause: Error) => void = () => undefined;
    const onMove = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        }),
    );
    show({ edit: editing({ onMove }) });
    strip().getByRole('button', { name: 'Board' }).focus();
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(names()).toEqual(['All tasks', 'Board', 'Roadmap']);
    await act(async () => fail(new Error('disk full')));
    expect(names()).toEqual(['Board', 'All tasks', 'Roadmap']);
  });

  it('follows the tabs as read again once they agree with the move, and after it', async () => {
    const onOpenView = vi.fn();
    const edit = editing();
    const { rerender } = render(<ViewTabs tabs={TABS} onOpenView={onOpenView} editing={edit} />);
    strip().getByRole('button', { name: 'Board' }).focus();
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');
    const [board, all, roadmap] = TABS;
    rerender(<ViewTabs tabs={[all!, board!, roadmap!]} onOpenView={onOpenView} editing={edit} />);
    expect(names()).toEqual(['All tasks', 'Board', 'Roadmap']);
    // Moved elsewhere afterwards — by another Mac — the tabs read as the files now say.
    rerender(<ViewTabs tabs={[roadmap!, board!, all!]} onOpenView={onOpenView} editing={edit} />);
    expect(names()).toEqual(['Roadmap', 'Board', 'All tasks']);
  });

  it('opens the type’s template from beside the gear (ADR-0026)', async () => {
    const { edit } = show();
    await userEvent.click(strip().getByRole('button', { name: 'Edit Task template' }));
    expect(edit.onEditTemplate).toHaveBeenCalledOnce();
    expect(edit.onEditType).not.toHaveBeenCalled();
  });

  it('offers the template only where it is asked for', () => {
    show({ edit: { ...editing(), onEditTemplate: undefined } });
    expect(strip().getByRole('button', { name: 'Edit Task type' })).toBeTruthy();
    expect(strip().queryByRole('button', { name: 'Edit Task template' })).toBeNull();
  });

  it('offers the type itself only where it is asked for', () => {
    show({ edit: { ...editing(), onEditType: undefined } });
    expect(strip().getByRole('button', { name: 'Add a view' })).toBeTruthy();
    expect(strip().queryByRole('button', { name: 'Edit Task type' })).toBeNull();
  });

  it('gives a type’s default table no Delete and does not move it, since it is not a file yet', async () => {
    const { edit } = show({ tabs: [tab('Task table', 'table', true, true)] });
    const menu = await openOptions();
    expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(menu.queryByRole('menuitem', { name: 'Delete view' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    strip().getByRole('button', { name: 'Task table' }).focus();
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(edit.onMove).not.toHaveBeenCalled();
  });
});

describe('ViewTabs without editing — a query view’s shelf', () => {
  it('only switches: no "+", no options, no moving', async () => {
    const { onOpenView } = show({ edit: null });
    expect(strip().queryByRole('button', { name: 'Add a view' })).toBeNull();
    expect(strip().queryByRole('button', { name: /View options/ })).toBeNull();
    expect(strip().queryByRole('button', { name: /Edit .* type/ })).toBeNull();
    await userEvent.click(strip().getByRole('button', { name: 'Roadmap' }));
    expect(onOpenView).toHaveBeenCalledExactlyOnceWith('.atlas/views/Roadmap.md');
    expect(strip().getAllByRole('button')).toHaveLength(3);
  });
});
