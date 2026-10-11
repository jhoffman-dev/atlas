// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GlobalCaptureSettings, type GlobalCaptureView } from './global-capture-settings.tsx';

/** #81: Settings → Quick capture from anywhere. */
const HELD: GlobalCaptureView = { shortcut: 'Control+Alt+KeyN', registered: true, problem: null };

describe('GlobalCaptureSettings', () => {
  it('shows the shortcut in force as a Mac menu writes it', () => {
    render(<GlobalCaptureSettings view={HELD} onChange={vi.fn()} />);
    expect(screen.getByText('⌃⌥N')).toBeDefined();
    // The default is in force, so there is nothing to go back to.
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull();
  });

  it('records a new shortcut from the keys pressed, by their place on the keyboard', async () => {
    const onChange = vi.fn();
    render(<GlobalCaptureSettings view={HELD} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'Change…' }));
    const field = screen.getByRole('button', { name: 'Press the shortcut…' });
    fireEvent.keyDown(field, { key: ' ', code: 'Space', metaKey: true, shiftKey: true });

    expect(onChange).toHaveBeenCalledWith('Shift+Super+Space');
    expect(screen.getByRole('button', { name: 'Change…' })).toBeDefined();
  });

  it('keeps recording, and says why, while the keys would take a key from every app', async () => {
    const onChange = vi.fn();
    render(<GlobalCaptureSettings view={HELD} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Change…' }));
    const field = screen.getByRole('button', { name: 'Press the shortcut…' });

    fireEvent.keyDown(field, { key: 'N', code: 'KeyN', shiftKey: true });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toMatch(/^Hold ⌘, ⌥ or ⌃ with it/);
    fireEvent.keyDown(field, { key: 'n', code: 'KeyN', ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith('Control+KeyN');
  });

  it('lets no key reach the window while it records: ⌘N would make a note, Esc close Settings', async () => {
    const onChange = vi.fn();
    const windowHeard = vi.fn();
    window.addEventListener('keydown', windowHeard);
    render(<GlobalCaptureSettings view={HELD} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Change…' }));
    const field = () => screen.getByRole('button', { name: 'Press the shortcut…' });

    fireEvent.keyDown(field(), { key: 'n', code: 'KeyN' });
    fireEvent.keyDown(field(), { key: 'n', code: 'KeyN', metaKey: true });
    await userEvent.click(screen.getByRole('button', { name: 'Change…' }));
    fireEvent.keyDown(field(), { key: 'Escape', code: 'Escape' });
    window.removeEventListener('keydown', windowHeard);

    expect(onChange.mock.calls).toEqual([['Super+KeyN']]);
    expect(windowHeard).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Change…' })).toBeDefined();
  });

  it('turns it off, and offers the default back once it is not in force', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<GlobalCaptureSettings view={HELD} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(onChange).toHaveBeenLastCalledWith(null);

    rerender(
      <GlobalCaptureSettings
        view={{ shortcut: null, registered: false, problem: null }}
        onChange={onChange}
      />,
    );
    expect(screen.getByText('Off')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Use ⌃⌥N' }));
    expect(onChange).toHaveBeenLastCalledWith('Control+Alt+KeyN');
  });

  it('says when the system would not give Atlas the shortcut, and why', () => {
    render(
      <GlobalCaptureSettings
        view={{
          shortcut: 'Super+Space',
          registered: false,
          problem: 'macOS would not give Atlas this shortcut — another app may be using it.',
        }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('⌘Space — not working')).toBeDefined();
    expect(screen.getByRole('alert').textContent).toMatch(/another app may be using it/);
  });

  it('says it is checking until the host has answered', () => {
    render(<GlobalCaptureSettings view={null} onChange={vi.fn()} />);
    expect(screen.getByText('Checking…')).toBeDefined();
  });
});
