// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WidgetResult } from '@atlas/application';
import { parseDashboard } from '@atlas/domain';
import { DashboardView, type DashboardEditing } from './dashboard-view.tsx';
import { announced, dragByKeyboard, layOut } from './drag/test-layout.ts';

/** Three widgets as a file lists them; the second entry does not parse, so it is not drawn. */
const WIDGETS = parseDashboard({
  atlas: 'dashboard',
  widgets: [
    { title: 'Tasks', kind: 'number', type: 'task' },
    { title: 'Broken', kind: 'bar', type: 'task' },
    { title: 'By status', kind: 'bar', type: 'task', groupBy: 'status', span: 8 },
    { title: 'Open', kind: 'list', type: 'task' },
  ],
});

const RESULTS: WidgetResult[] = WIDGETS.map((widget) => ({
  widget,
  sql: 'SELECT 1',
  data: { shape: 'number', value: '3' },
}));

function editing(more: Partial<DashboardEditing> = {}): DashboardEditing {
  return {
    arranging: true,
    error: null,
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    onPlace: vi.fn(),
    ...more,
  };
}

const draw = (edits: DashboardEditing) =>
  render(<DashboardView results={RESULTS} onOpenNote={() => {}} editing={edits} />);

const grip = (title: string) => screen.getByRole('button', { name: `Move ${title}` });

describe('the widget menu on an editable dashboard', () => {
  it('offers Edit and Remove, and says which widget', async () => {
    const edits = editing({ arranging: false });
    draw(edits);
    const byStatus = screen.getByRole('region', { name: 'By status' });

    await userEvent.click(within(byStatus).getByRole('button', { name: 'Widget options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit widget' }));
    expect(edits.onEdit).toHaveBeenCalledExactlyOnceWith(WIDGETS[1]);

    await userEvent.click(within(byStatus).getByRole('button', { name: 'Widget options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove widget' }));
    expect(edits.onRemove).toHaveBeenCalledExactlyOnceWith(WIDGETS[1]);
  });

  it('offers neither on a dashboard that cannot be edited', async () => {
    render(<DashboardView results={RESULTS} onOpenNote={() => {}} />);
    const [options] = screen.getAllByRole('button', { name: 'Widget options' });
    await userEvent.click(options as HTMLElement);
    expect(await screen.findByRole('menuitem', { name: 'Show SQL' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Edit widget' })).toBeNull();
  });
});

describe('arranging a dashboard', () => {
  it('shows a grip on every widget and a card to add one only while arranging', async () => {
    const edits = editing({ arranging: false });
    const { rerender } = draw(edits);
    expect(screen.getAllByRole('region').length).toBe(3);
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add widget' })).toBeNull();

    rerender(
      <DashboardView
        results={RESULTS}
        onOpenNote={() => {}}
        editing={{ ...edits, arranging: true }}
      />,
    );
    expect(screen.getAllByRole('button', { name: /^Move / })).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Add widget' }));
    expect(edits.onAdd).toHaveBeenCalledOnce();
  });

  it('says why the last change was not written', () => {
    draw(editing({ error: 'The note changed on disk.' }));
    expect(screen.getByRole('alert').textContent).toBe('The note changed on disk.');
  });

  it('asks an empty dashboard to be customized, not hand-edited', () => {
    render(
      <DashboardView results={[]} onOpenNote={() => {}} editing={editing({ arranging: false })} />,
    );
    expect(screen.getByText(/Choose Customize to add one/)).toBeTruthy();
  });
});

describe('arranging with the keyboard', () => {
  // The keys decide where a widget goes; boxes only have to exist for dnd-kit.
  beforeEach(() => layOut(() => ({ left: 0, top: 0, width: 200, height: 120 })));
  afterEach(() => vi.restoreAllMocks());

  it('moves a widget one place later, to the entry that stood there', async () => {
    const edits = editing();
    draw(edits);

    await dragByKeyboard(grip('Tasks'), ['{ArrowRight}']);

    // "By status" is the third entry in the file, not the second: the broken
    // one between them is not drawn but is still there.
    expect(edits.onPlace).toHaveBeenCalledExactlyOnceWith({
      widget: WIDGETS[0],
      to: 2,
      span: null,
    });
  });

  it('moves earlier with the up arrow and stops at the first place', async () => {
    const edits = editing();
    draw(edits);

    await dragByKeyboard(grip('Open'), ['{ArrowUp}', '{ArrowUp}', '{ArrowUp}']);

    expect(edits.onPlace).toHaveBeenCalledExactlyOnceWith({
      widget: WIDGETS[2],
      to: 0,
      span: null,
    });
  });

  it('resizes with shift and the arrows, where it stands', async () => {
    const edits = editing();
    draw(edits);

    await dragByKeyboard(grip('By status'), [
      '{Shift>}{ArrowLeft}{/Shift}',
      '{Shift>}{ArrowLeft}{/Shift}',
    ]);

    expect(edits.onPlace).toHaveBeenCalledExactlyOnceWith({
      widget: WIDGETS[1],
      to: 2,
      span: 6,
    });
  });

  it('draws the held widget where it would land, at the width it would be', async () => {
    const edits = editing();
    draw(edits);
    const user = userEvent.setup();
    grip('Tasks').focus();
    await user.keyboard(' ');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await user.keyboard('{ArrowRight}{Shift>}{ArrowRight}{/Shift}');

    const order = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'));
    expect(order).toEqual(['By status', 'Tasks', 'Open']);
    const tasks = screen.getByRole('region', { name: 'Tasks' });
    expect(tasks.style.getPropertyValue('--span')).toBe('4');
    expect(announced()).toBe('Tasks is 2 of 3, 4 columns wide.');
    await user.keyboard('{Escape}');
  });

  it('writes nothing when the drag is cancelled', async () => {
    const edits = editing();
    draw(edits);

    await dragByKeyboard(grip('Tasks'), ['{ArrowRight}'], { finish: '{Escape}' });

    expect(edits.onPlace).not.toHaveBeenCalled();
    expect(announced()).toBe('Cancelled. Tasks stays 1 of 3, 3 columns wide.');
    const order = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'));
    expect(order).toEqual(['Tasks', 'By status', 'Open']);
  });

  // The drop is written to the file and the grid redrawn from it, with new
  // widgets in new places. A widget picked up before then is picked up from a
  // grid that is about to vanish under it, and its drag named the wrong one.
  it('picks nothing up again until the drop has been read back from the file', async () => {
    const edits = editing();
    const { rerender } = draw(edits);
    const redraw = (results: WidgetResult[], more: Partial<DashboardEditing> = {}) =>
      rerender(
        <DashboardView results={results} onOpenNote={() => {}} editing={{ ...edits, ...more }} />,
      );

    await dragByKeyboard(grip('Open'), ['{ArrowUp}', '{ArrowUp}']);
    expect(edits.onPlace).toHaveBeenCalledOnce();
    expect(grip('Open').getAttribute('aria-disabled')).toBe('true');
    await dragByKeyboard(grip('Open'), ['{ArrowRight}']);
    expect(edits.onPlace).toHaveBeenCalledOnce();

    const moved = parseDashboard({
      atlas: 'dashboard',
      widgets: [
        { title: 'Open', kind: 'list', type: 'task' },
        { title: 'Tasks', kind: 'number', type: 'task' },
        { title: 'Broken', kind: 'bar', type: 'task' },
        { title: 'By status', kind: 'bar', type: 'task', groupBy: 'status', span: 8 },
      ],
    }).map((widget) => ({ ...RESULTS[0]!, widget }));
    redraw(moved);
    expect(grip('Open').getAttribute('aria-disabled')).toBe('false');
    await dragByKeyboard(grip('Open'), ['{ArrowRight}'], { finish: '{Escape}' });
    expect(announced()).toBe('Cancelled. Open stays 1 of 3, 6 columns wide.');
  });

  it('lets widgets be picked up again when the drop could not be written', async () => {
    const edits = editing();
    const { rerender } = draw(edits);

    await dragByKeyboard(grip('Open'), ['{ArrowUp}']);
    expect(grip('Open').getAttribute('aria-disabled')).toBe('true');
    rerender(
      <DashboardView
        results={RESULTS}
        onOpenNote={() => {}}
        editing={{ ...edits, error: 'The disk is full.' }}
      />,
    );

    expect(grip('Open').getAttribute('aria-disabled')).toBe('false');
    const order = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'));
    expect(order).toEqual(['Tasks', 'By status', 'Open']);
  });

  it('writes nothing for a widget dropped where it started', async () => {
    const edits = editing();
    draw(edits);

    await dragByKeyboard(grip('Tasks'), ['{ArrowRight}', '{ArrowLeft}']);

    expect(edits.onPlace).not.toHaveBeenCalled();
    expect(announced()).toBe('Tasks was dropped where it started.');
  });
});
