// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageBarToggles } from '../page-bar-toggles.tsx';
import { AsideToggleProvider } from './aside-toggle.tsx';

describe('the right sidebar’s bar button', () => {
  it('is nothing where the app offers no right sidebar', () => {
    render(<PageBarToggles />);
    expect(screen.queryByRole('button', { name: 'Right sidebar' })).toBeNull();
  });

  it('says whether the aside is on screen, and toggles it', async () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <AsideToggleProvider value={{ shown: false, onToggle }}>
        <PageBarToggles />
      </AsideToggleProvider>,
    );
    const button = screen.getByRole('button', { name: 'Right sidebar' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.title).toBe('Show right sidebar (⌥⌘\\)');

    await userEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <AsideToggleProvider value={{ shown: true, onToggle }}>
        <PageBarToggles />
      </AsideToggleProvider>,
    );
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.title).toBe('Hide right sidebar (⌥⌘\\)');
  });
});
