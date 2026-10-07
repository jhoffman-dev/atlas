// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CapturePalette } from './capture-palette.tsx';

const props = { destination: 'a Task', onCapture: () => {}, onClose: () => {} };

/** The palette as the app mounts it: something else has focus until it opens. */
function Opener({ open }: { open: boolean }) {
  return (
    <>
      <button type="button">Opened me</button>
      {open ? <CapturePalette {...props} /> : null}
    </>
  );
}

describe('CapturePalette', () => {
  it('focuses the field, so capture starts with typing', async () => {
    render(<CapturePalette {...props} />);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: 'What needs doing' }),
      ),
    );
  });

  it('says where the note will go', () => {
    render(<CapturePalette {...props} />);
    expect(screen.getByText(/a Task/)).toBeDefined();
  });

  it('captures what was typed', async () => {
    const onCapture = vi.fn();
    render(<CapturePalette {...props} onCapture={onCapture} />);
    await userEvent.type(screen.getByRole('textbox'), 'Buy milk{Enter}');
    expect(onCapture).toHaveBeenCalledWith('Buy milk');
  });

  it('trims what was typed', async () => {
    const onCapture = vi.fn();
    render(<CapturePalette {...props} onCapture={onCapture} />);
    await userEvent.type(screen.getByRole('textbox'), '  Buy milk  {Enter}');
    expect(onCapture).toHaveBeenCalledWith('Buy milk');
  });

  it('stays open for the next one', async () => {
    const onCapture = vi.fn();
    const onClose = vi.fn();
    render(<CapturePalette {...props} onCapture={onCapture} onClose={onClose} />);

    const field = screen.getByRole('textbox');
    await userEvent.type(field, 'One{Enter}');
    await userEvent.type(field, 'Two{Enter}');

    expect(onCapture).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on an empty Enter rather than making a nameless note', async () => {
    const onCapture = vi.fn();
    const onClose = vi.fn();
    render(<CapturePalette {...props} onCapture={onCapture} onClose={onClose} />);
    await userEvent.type(screen.getByRole('textbox'), '{Enter}');

    expect(onCapture).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on escape', async () => {
    const onClose = vi.fn();
    render(<CapturePalette {...props} onClose={onClose} />);
    await userEvent.type(screen.getByRole('textbox'), 'half a thought{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    // The palette is portalled to the body, so the backdrop is not under the
    // container the test rendered into.
    const { baseElement } = render(<CapturePalette {...props} onClose={onClose} />);
    const backdrop = baseElement.querySelector('.palette__backdrop');
    expect(backdrop).not.toBeNull();
    if (backdrop !== null) await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('gives focus back to whatever had it before, once it closes', async () => {
    const view = render(<Opener open={false} />);
    const opener = screen.getByRole('button', { name: 'Opened me' });
    opener.focus();

    view.rerender(<Opener open />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox')));

    view.rerender(<Opener open={false} />);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('locks the page behind it, and lets go when it closes', async () => {
    expect(document.body.style.overflowY).toBe('');

    const view = render(<CapturePalette {...props} />);
    await waitFor(() => expect(document.body.style.overflowY).toBe('hidden'));

    view.unmount();
    await waitFor(() => expect(document.body.style.overflowY).toBe(''));
  });
});
