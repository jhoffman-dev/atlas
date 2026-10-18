// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageFailed, PartFailed } from './part-failed.tsx';

describe('PartFailed', () => {
  it('says the part could not load, and Reload tries again', async () => {
    const onRetry = vi.fn();
    render(<PartFailed retrying={false} onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('This part couldn’t load.');
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('cannot be pressed again while it is reloading', () => {
    render(<PartFailed retrying onRetry={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Reloading…' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('PageFailed', () => {
  it('says so inside the page frame, with Back and Forward still working', async () => {
    const onBack = vi.fn();
    const { container } = render(
      <PageFailed
        props={{ history: { back: 'Today', forward: null, onBack, onForward: vi.fn() } }}
        retrying={false}
        onRetry={vi.fn()}
      />,
    );
    const body = container.querySelector('.panel__body');
    expect(body?.querySelector('[role="alert"]')).not.toBeNull();
    expect(body?.hasAttribute('aria-busy')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
