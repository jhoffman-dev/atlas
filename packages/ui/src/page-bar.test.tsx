// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageBar } from './page-bar.tsx';

const crumb = { icon: 'doc', parent: 'Pages' } as const;

describe('PageBar history', () => {
  it('puts Back and Forward before the breadcrumb, naming where each goes', () => {
    render(
      <PageBar
        crumb={crumb}
        name="beta"
        history={{ back: 'alpha', forward: 'gamma', onBack: () => {}, onForward: () => {} }}
      />,
    );
    const back = screen.getByRole('button', { name: 'Back' });
    const forward = screen.getByRole('button', { name: 'Forward' });
    expect(back.getAttribute('title')).toBe('Back to alpha (⌘[)');
    expect(forward.getAttribute('title')).toBe('Forward to gamma (⌘])');
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(
      back.compareDocumentPosition(breadcrumb) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('disables a direction with nowhere to go', () => {
    render(
      <PageBar
        crumb={crumb}
        name="alpha"
        history={{ back: null, forward: 'beta', onBack: () => {}, onForward: () => {} }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Back' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Back' }).getAttribute('title')).toBe('Back');
    expect(screen.getByRole('button', { name: 'Forward' }).hasAttribute('disabled')).toBe(false);
  });

  it('goes back and forward when pressed', async () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    render(
      <PageBar
        crumb={crumb}
        name="beta"
        history={{ back: 'a', forward: 'c', onBack, onForward }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await userEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onForward).toHaveBeenCalledOnce();
  });

  it('draws no history controls when it is given none', () => {
    render(<PageBar crumb={crumb} name="alpha" />);
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeDefined();
  });
});

describe('PageBar pane buttons', () => {
  it('offers a named Split right button with its shortcut, and splits when pressed', async () => {
    const onSplit = vi.fn();
    render(<PageBar crumb={crumb} name="alpha" onSplit={onSplit} />);

    const split = screen.getByRole('button', { name: 'Split right' });
    expect(split.getAttribute('title')).toBe('Split right (⇧⌘\\)');
    await userEvent.click(split);

    expect(onSplit).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Close pane' })).toBeNull();
  });

  it('offers a named Close pane button as the last control, and closes when pressed', async () => {
    const onClose = vi.fn();
    render(
      <PageBar
        crumb={crumb}
        name="alpha"
        menu={[{ label: 'Close pane', onSelect: () => {} }]}
        onClose={onClose}
      />,
    );

    const close = screen.getByRole('button', { name: 'Close pane' });
    expect(close.getAttribute('title')).toBe('Close pane');
    const more = screen.getByRole('button', { name: 'More' });
    expect(more.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(close);

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Split right' })).toBeNull();
  });

  // The shortcut closes the focused pane: named on the other pane's Close, it
  // promised to close that pane and closed this one.
  it('names the shortcut on Close only where the shortcut closes this pane', () => {
    render(<PageBar crumb={crumb} name="alpha" onClose={() => {}} closesFromShortcut />);
    const close = screen.getByRole('button', { name: 'Close pane' });
    expect(close.getAttribute('title')).toBe('Close pane (⇧⌘\\)');
  });

  it('draws neither button when it is given neither', () => {
    render(<PageBar crumb={crumb} name="alpha" />);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Split right' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close pane' })).toBeNull();
  });
});

describe('PageBar count and actions', () => {
  it('shows the count beside the name, and the actions before the save word', () => {
    render(
      <PageBar
        crumb={crumb}
        name="Task table"
        count="186 tasks"
        status="Saved"
        actions={<button type="button">Filter</button>}
      />,
    );
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(breadcrumb.textContent).toContain('Task table');
    expect(breadcrumb.querySelector('.page-bar__count')?.textContent).toBe('186 tasks');
    const filter = screen.getByRole('button', { name: 'Filter' });
    expect(filter.closest('.page-bar__actions')).not.toBeNull();
    const status = screen.getByRole('status');
    expect(
      breadcrumb.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(filter.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws neither a count nor an actions slot when it is given neither', () => {
    const { container } = render(<PageBar crumb={crumb} name="Task table" status="Saved" />);
    expect(container.querySelector('.page-bar__count')).toBeNull();
    expect(container.querySelector('.page-bar__actions')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toBe(
      'Pages/Task table',
    );
  });
});
