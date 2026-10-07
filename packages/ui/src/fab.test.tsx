// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FabAnchor } from '@atlas/domain';
import { FloatingAddButton, type FabItem } from './fab.tsx';

const TASK: FabItem = { name: 'task', label: 'Task', icon: 'task' };
const PROJECT: FabItem = { name: 'project', label: 'Project', icon: 'folder' };
const PERSON: FabItem = { name: 'person', label: 'Person', icon: 'person' };

/** The layer's box, which jsdom does not lay out: a 1000×800 panel at the window's corner. */
const PANEL = { left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, x: 0, y: 0 };

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return { ...PANEL, toJSON: () => PANEL } as DOMRect;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The button as the app holds it: the dial's state and its place kept above it. */
function Harness({
  items,
  start = 'bottom-right',
  onPick = () => {},
  onMove = () => {},
}: {
  items: readonly FabItem[];
  start?: FabAnchor;
  onPick?: (name: string) => void;
  onMove?: (anchor: FabAnchor) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<FabAnchor>(start);
  return (
    <>
      <p>Elsewhere</p>
      <FloatingAddButton
        items={items}
        anchor={anchor}
        onMove={(next) => {
          setAnchor(next);
          onMove(next);
        }}
        dialOpen={open}
        onDialOpenChange={setOpen}
        onPick={onPick}
        shortcut="⌥⌘N"
      />
    </>
  );
}

const fab = (name: string | RegExp = /Add…|New/) => screen.getByRole('button', { name });

describe('FloatingAddButton with one type', () => {
  it('asks for that type straight away, with no dial', async () => {
    const onPick = vi.fn();
    render(<Harness items={[TASK]} onPick={onPick} />);

    await userEvent.click(fab('New Task'));

    expect(onPick).toHaveBeenCalledWith('task');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(fab('New Task').getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('is reachable from the keyboard as a real button', async () => {
    const onPick = vi.fn();
    render(<Harness items={[TASK]} onPick={onPick} />);

    await userEvent.tab();
    expect(document.activeElement).toBe(fab('New Task'));
    await userEvent.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith('task');
  });
});

describe('FloatingAddButton with several types', () => {
  it('opens a dial of the types, in their order, instead of adding', async () => {
    const onPick = vi.fn();
    render(<Harness items={[TASK, PROJECT, PERSON]} onPick={onPick} />);

    await userEvent.click(fab('Add…'));

    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Task', 'Project', 'Person']);
    expect(onPick).not.toHaveBeenCalled();
    expect(fab('Add…').getAttribute('aria-expanded')).toBe('true');
  });

  it('adds the type picked from the dial', async () => {
    const onPick = vi.fn();
    render(<Harness items={[TASK, PROJECT]} onPick={onPick} />);

    await userEvent.click(fab('Add…'));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Project' }));

    expect(onPick).toHaveBeenCalledWith('project');
  });

  it('opens up from the bottom, and the arrows walk it that way', async () => {
    render(<Harness items={[TASK, PROJECT, PERSON]} />);
    await userEvent.click(fab('Add…'));

    expect(screen.getByRole('menu').getAttribute('data-direction')).toBe('up');
    const [task, project, person] = screen.getAllByRole('menuitem');
    await waitFor(() => expect(document.activeElement).toBe(task));
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(project);
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(person);
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(project);
  });

  it('opens down from the top', async () => {
    render(<Harness items={[TASK, PROJECT]} start="top-left" />);
    await userEvent.click(fab('Add…'));

    expect(screen.getByRole('menu').getAttribute('data-direction')).toBe('down');
    const [task, project] = screen.getAllByRole('menuitem');
    await waitFor(() => expect(document.activeElement).toBe(task));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(project);
  });

  it('opens inward from either side', async () => {
    const { unmount } = render(<Harness items={[TASK, PROJECT]} start="left-centre" />);
    await userEvent.click(fab('Add…'));
    expect(screen.getByRole('menu').getAttribute('data-direction')).toBe('right');
    unmount();

    render(<Harness items={[TASK, PROJECT]} start="right-centre" />);
    await userEvent.click(fab('Add…'));
    expect(screen.getByRole('menu').getAttribute('data-direction')).toBe('left');
  });

  it('closes on Escape and gives the focus back to the button', async () => {
    render(<Harness items={[TASK, PROJECT]} />);
    await userEvent.click(fab('Add…'));
    await waitFor(() => expect(screen.getByRole('menu')).toBeDefined());

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(fab('Add…'));
  });

  it('closes on a click elsewhere', async () => {
    render(<Harness items={[TASK, PROJECT]} />);
    await userEvent.click(fab('Add…'));
    expect(screen.getByRole('menu')).toBeDefined();

    await userEvent.click(screen.getByText('Elsewhere'));

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes when the button is pressed again', async () => {
    render(<Harness items={[TASK, PROJECT]} />);
    await userEvent.click(fab('Add…'));
    await userEvent.click(fab('Add…'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('moving the button', () => {
  it('moves one place with Alt and an arrow, and says where it went', async () => {
    const onMove = vi.fn();
    render(<Harness items={[TASK]} onMove={onMove} />);
    fab('New Task').focus();

    await userEvent.keyboard('{Alt>}{ArrowLeft}{/Alt}');

    expect(onMove).toHaveBeenCalledWith('bottom-middle');
    expect(screen.getByText('Add button moved to bottom middle')).toBeDefined();
  });

  it('ignores an arrow without Alt', async () => {
    const onMove = vi.fn();
    render(<Harness items={[TASK]} onMove={onMove} />);
    fab('New Task').focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onMove).not.toHaveBeenCalled();
  });

  /** A press at `from`, moved through `to`, and let go there. */
  const drag = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const button = fab();
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: to.x, clientY: to.y });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: to.x, clientY: to.y });
    fireEvent.click(button);
  };

  it('snaps to the nearest anchor when dragged and let go, and does not also add', () => {
    const onMove = vi.fn();
    const onPick = vi.fn();
    render(<Harness items={[TASK]} onMove={onMove} onPick={onPick} />);

    // From the middle of the bottom-right button to near the top-left corner.
    drag({ x: 948, y: 748 }, { x: 70, y: 110 });

    expect(onMove).toHaveBeenCalledWith('top-left');
    expect(onPick).not.toHaveBeenCalled();
  });

  it('shows where it can land while it is dragged, the nearest marked', () => {
    render(<Harness items={[TASK]} />);
    const button = fab();
    fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 948, clientY: 748 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 520, clientY: 760 });

    const previews = document.querySelectorAll('.fab-layer__preview');
    expect(previews).toHaveLength(8);
    const near = document.querySelector('.fab-layer__preview[data-near="true"]');
    expect(near?.getAttribute('data-anchor')).toBe('bottom-middle');
  });

  it('takes a press that wobbles for a click, not a drag', () => {
    const onMove = vi.fn();
    const onPick = vi.fn();
    render(<Harness items={[TASK]} onMove={onMove} onPick={onPick} />);

    drag({ x: 948, y: 748 }, { x: 951, y: 750 });

    expect(onMove).not.toHaveBeenCalled();
    expect(onPick).toHaveBeenCalledWith('task');
  });
});
