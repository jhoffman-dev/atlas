// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeekDialog, type PeekDialogProps } from './peek-dialog.tsx';

const TITLE = 'Leftovers from A15-02';

function props(overrides: Partial<PeekDialogProps> = {}): PeekDialogProps {
  return {
    title: TITLE,
    position: { index: 2, count: 186, within: 'Task table' },
    status: 'Saved',
    onStep: vi.fn(),
    onClose: vi.fn(),
    children: (
      <>
        <h1>{TITLE}</h1>
        <div contentEditable suppressContentEditableWarning aria-label="Body">
          The text
        </div>
        <input aria-label="Phase" type="number" defaultValue={15} />
      </>
    ),
    ...overrides,
  };
}

function show(overrides: Partial<PeekDialogProps> = {}) {
  const given = props(overrides);
  render(<PeekDialog {...given} />);
  return given;
}

const dialog = () => screen.getByRole('dialog', { name: TITLE });

describe('PeekDialog: the chrome', () => {
  it('is a dialog named for its note, saying where its row sits and how it stands', () => {
    show();
    expect(dialog().textContent).toContain('3 of 186 in Task table');
    expect(screen.getByRole('status').textContent).toBe('Saved');
  });

  it('steps with its own buttons, and stops at either end', async () => {
    const { onStep } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Next row' }));
    expect(onStep).toHaveBeenLastCalledWith(3);
    await userEvent.click(screen.getByRole('button', { name: 'Previous row' }));
    expect(onStep).toHaveBeenLastCalledWith(1);
  });

  it('cannot step past the last row', () => {
    const { onStep } = show({ position: { index: 185, count: 186, within: 'Task table' } });
    const next = screen.getByRole<HTMLButtonElement>('button', { name: 'Next row' });
    expect(next.disabled).toBe(true);
    fireEvent.keyDown(dialog(), { key: 'ArrowDown' });
    expect(onStep).not.toHaveBeenCalled();
  });

  it('draws no stepping at all for a note opened from no list', () => {
    show({ position: null });
    expect(screen.queryByRole('button', { name: 'Next row' })).toBeNull();
    expect(dialog().textContent).not.toContain(' of ');
  });

  it('offers expand, new tab and split only when the app gives them, and hands each up', async () => {
    const onExpand = vi.fn();
    const onOpenInNewTab = vi.fn();
    const onOpenInSplit = vi.fn();
    show({ onExpand, onOpenInNewTab, onOpenInSplit });
    await userEvent.click(screen.getByRole('button', { name: 'Open as full page' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open in new tab' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open in split' }));
    expect(onExpand).toHaveBeenCalledOnce();
    expect(onOpenInNewTab).toHaveBeenCalledOnce();
    expect(onOpenInSplit).toHaveBeenCalledOnce();
  });

  it('has none of them when it is not given them', () => {
    show();
    expect(screen.queryByRole('button', { name: 'Open in new tab' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });

  it("offers the app's commands in its ⋯ menu", async () => {
    const onSelect = vi.fn();
    show({ menu: [{ label: 'Copy link', onSelect }] });
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy link' }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe('PeekDialog: the keys (Q6)', () => {
  it('takes the focus itself, so ↑ and ↓ step at once', async () => {
    const { onStep } = show();
    await waitFor(() => expect(document.activeElement).toBe(dialog()));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(onStep).toHaveBeenLastCalledWith(3);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(onStep).toHaveBeenLastCalledWith(1);
  });

  it('leaves ↑ and ↓ to the body, which moves the caret, and to a field', () => {
    const { onStep } = show();
    const body = screen.getByLabelText('Body');
    const down = fireEvent.keyDown(body, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByLabelText('Phase'), { key: 'ArrowUp' });
    expect(onStep).not.toHaveBeenCalled();
    // Not prevented: the caret still moves.
    expect(down).toBe(true);
  });

  it('steps on ⌥↑ and ⌥↓ from the body too, keeping the caret where it is', () => {
    const { onStep } = show();
    const body = screen.getByLabelText('Body');
    const moved = fireEvent.keyDown(body, { key: 'ArrowDown', altKey: true });
    expect(onStep).toHaveBeenLastCalledWith(3);
    expect(moved).toBe(false);
    fireEvent.keyDown(body, { key: 'ArrowUp', altKey: true });
    expect(onStep).toHaveBeenLastCalledWith(1);
  });

  it('leaves a key something inside already answered alone', () => {
    const { onStep } = show();
    const body = screen.getByLabelText('Body');
    body.addEventListener('keydown', (event) => event.preventDefault());
    fireEvent.keyDown(body, { key: 'ArrowDown', altKey: true });
    expect(onStep).not.toHaveBeenCalled();
  });

  it('opens in a tab on ⌘↵ and in a split on ⌘⇧↵, from the chrome', () => {
    const onOpenInNewTab = vi.fn();
    const onOpenInSplit = vi.fn();
    show({ onOpenInNewTab, onOpenInSplit });
    fireEvent.keyDown(dialog(), { key: 'Enter', metaKey: true });
    fireEvent.keyDown(dialog(), { key: 'Enter', metaKey: true, shiftKey: true });
    expect(onOpenInNewTab).toHaveBeenCalledOnce();
    expect(onOpenInSplit).toHaveBeenCalledOnce();
  });

  it('leaves ⌘↵ in the body to the editor, which opens the link under the caret', () => {
    const onOpenInNewTab = vi.fn();
    show({ onOpenInNewTab });
    fireEvent.keyDown(screen.getByLabelText('Body'), { key: 'Enter', metaKey: true });
    expect(onOpenInNewTab).not.toHaveBeenCalled();
  });

  it('lets ⌘K through to the app: search opens above the peek', () => {
    show();
    const heard = vi.fn((event: KeyboardEvent) => event.defaultPrevented);
    window.addEventListener('keydown', heard);
    fireEvent.keyDown(dialog(), { key: 'k', metaKey: true });
    window.removeEventListener('keydown', heard);
    expect(heard).toHaveBeenCalledOnce();
    expect(heard.mock.results[0]!.value).toBe(false);
  });

  it('lists its keys along its foot', () => {
    show({ onOpenInNewTab: vi.fn() });
    const foot = dialog().querySelector('.key-hints');
    expect(foot?.textContent).toContain('close');
    expect(foot?.textContent).toContain('previous / next row');
    expect(foot?.textContent).toContain('open in tab');
    expect(foot?.textContent).not.toContain('open in split');
  });
});

/** A row that opens the peek, as a table's would. */
function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Row 3
      </button>
      {open && <PeekDialog {...props({ onClose: () => setOpen(false) })} />}
    </>
  );
}

describe('PeekDialog: closing', () => {
  it('closes on Esc and hands the focus back to the row that opened it', async () => {
    render(<Opener />);
    await userEvent.click(screen.getByRole('button', { name: 'Row 3' }));
    expect(dialog()).toBeDefined();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Row 3' }));
  });

  it('closes on its ×', async () => {
    render(<Opener />);
    await userEvent.click(screen.getByRole('button', { name: 'Row 3' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Row 3' }));
  });
});

describe('PeekDialog: a place for the window’s toasts (#468)', () => {
  it('hands over a place inside the dialog, after its header and before the note', () => {
    let slot: HTMLElement | null = null;
    show({ toastSlot: (element) => (slot = element) });
    expect(slot).not.toBeNull();
    const placed = slot as unknown as HTMLElement;
    expect(dialog().contains(placed)).toBe(true);
    const header = dialog().querySelector('header');
    const body = dialog().querySelector('.peek__body');
    expect(header?.compareDocumentPosition(placed)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(placed.compareDocumentPosition(body!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
