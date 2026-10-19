// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { RightSidebar, type AsideTab } from './right-sidebar.tsx';

const THREE = {
  properties: <p>the rows</p>,
  backlinks: <p>the links</p>,
  outline: <p>the headings</p>,
};
const FOUR = { ...THREE, claude: <p>the chat</p> };

function show(overrides: Partial<Parameters<typeof RightSidebar>[0]> = {}) {
  const props = {
    tab: 'properties' as AsideTab,
    panels: THREE as Partial<Record<AsideTab, ReactNode>>,
    onSelectTab: vi.fn(),
    onHide: vi.fn(),
    onEscape: vi.fn(),
    ...overrides,
  };
  return { ...render(<RightSidebar {...props} />), props };
}

const tab = (name: string) => screen.getByRole('tab', { name });
const tabStops = () =>
  screen.getAllByRole('tab').filter((each) => each.getAttribute('tabindex') === '0');

describe('RightSidebar roving tabindex (attack #353)', () => {
  it.each([
    ['three tabs', THREE, ['Properties', 'Backlinks', 'Outline']],
    ['four tabs with Claude', FOUR, ['Properties', 'Backlinks', 'Outline', 'Claude']],
  ] as const)('keeps exactly one tab stop with %s, on every shown tab', (_name, panels, names) => {
    for (const name of names) {
      const { unmount } = show({ panels, tab: name.toLowerCase() as AsideTab });
      expect(tabStops().map((each) => each.textContent)).toEqual([name]);
      unmount();
    }
  });

  it('wraps ← from the first tab to Claude and → from Claude to the first, with four tabs', () => {
    show({ panels: FOUR });
    tab('Properties').focus();
    fireEvent.keyDown(tab('Properties'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab('Claude'));
    fireEvent.keyDown(tab('Claude'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('Properties'));
  });

  it('jumps Home and End along four tabs', () => {
    show({ panels: FOUR, tab: 'backlinks' });
    tab('Backlinks').focus();
    fireEvent.keyDown(tab('Backlinks'), { key: 'End' });
    expect(document.activeElement).toBe(tab('Claude'));
    fireEvent.keyDown(tab('Claude'), { key: 'Home' });
    expect(document.activeElement).toBe(tab('Properties'));
  });

  it('walks only the offered tabs when one in the middle is missing', () => {
    show({ panels: { properties: <p>rows</p>, outline: <p>heads</p>, claude: <p>chat</p> } });
    tab('Properties').focus();
    fireEvent.keyDown(tab('Properties'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('Outline'));
  });

  it('shows the focused tab on Enter and on Space, once each', async () => {
    const user = userEvent.setup();
    const { props } = show({ panels: FOUR });
    tab('Properties').focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    await user.keyboard('{Enter}');
    expect(props.onSelectTab).toHaveBeenLastCalledWith('outline');
    await user.keyboard('{ArrowRight}');
    await user.keyboard(' ');
    expect(props.onSelectTab).toHaveBeenLastCalledWith('claude');
    expect(props.onSelectTab).toHaveBeenCalledTimes(2);
  });

  it('does not swallow ⌘← or ⌥→ on a tab, which belong to the app and the system', () => {
    show({ panels: FOUR });
    tab('Properties').focus();
    const meta = fireEvent.keyDown(tab('Properties'), { key: 'ArrowLeft', metaKey: true });
    const alt = fireEvent.keyDown(tab('Properties'), { key: 'ArrowRight', altKey: true });
    // fireEvent returns false when the handler called preventDefault.
    expect(meta).toBe(true);
    expect(alt).toBe(true);
    expect(document.activeElement).toBe(tab('Properties'));
  });
});

describe('RightSidebar Escape and hide (attack #353)', () => {
  it('hands Escape up from a tab once', () => {
    const { props } = show();
    fireEvent.keyDown(tab('Backlinks'), { key: 'Escape' });
    expect(props.onEscape).toHaveBeenCalledTimes(1);
  });

  it('leaves an Escape a panel already answered alone', () => {
    const { props } = show({
      panels: {
        properties: (
          <input
            aria-label="Due"
            onKeyDown={(event) => {
              if (event.key === 'Escape') event.preventDefault();
            }}
          />
        ),
      },
    });
    fireEvent.keyDown(screen.getByLabelText('Due'), { key: 'Escape' });
    expect(props.onEscape).not.toHaveBeenCalled();
  });

  it('leaves Escape to the page when no onEscape is given', () => {
    render(<RightSidebar tab="properties" panels={THREE} onSelectTab={vi.fn()} onHide={vi.fn()} />);
    expect(fireEvent.keyDown(tab('Properties'), { key: 'Escape' })).toBe(true);
  });

  it('hands × up once and does not also select a tab', async () => {
    const user = userEvent.setup();
    const { props } = show();
    await user.click(screen.getByRole('button', { name: 'Hide right sidebar' }));
    expect(props.onHide).toHaveBeenCalledTimes(1);
    expect(props.onSelectTab).not.toHaveBeenCalled();
  });
});

describe('RightSidebar tabs coming and going (attack #353)', () => {
  it('keeps the focus in the tab row when the focused Claude tab goes away', () => {
    const { rerender, props } = show({ panels: FOUR, tab: 'claude' });
    tab('Claude').focus();
    rerender(<RightSidebar {...props} panels={THREE} tab="claude" />);
    // The focused button is gone; the focus must land on the fallback tab,
    // not drop to <body> where the next Tab starts from the top of the window.
    expect(document.activeElement).toBe(tab('Properties'));
  });

  it('falls back to the first offered tab, selected and the one tab stop, when the shown one is missing', () => {
    show({ panels: { backlinks: <p>links</p>, outline: <p>heads</p> }, tab: 'properties' });
    expect(tab('Backlinks').getAttribute('aria-selected')).toBe('true');
    expect(tabStops()).toEqual([tab('Backlinks')]);
    expect(screen.getByRole('tabpanel').textContent).toBe('links');
  });

  it('labels the fallback panel by the tab actually shown', () => {
    show({ panels: { backlinks: <p>links</p> }, tab: 'outline' });
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(tab('Backlinks').id);
  });

  it('offers no tab for a panel given as null or false, the way React spells "nothing"', () => {
    const hasOutline = false;
    show({
      panels: { properties: <p>rows</p>, outline: hasOutline && <p>heads</p>, claude: null },
    });
    expect(screen.getAllByRole('tab').map((each) => each.textContent)).toEqual(['Properties']);
  });

  it('points every tab’s aria-controls at an element in the page', () => {
    show({ panels: FOUR });
    for (const each of screen.getAllByRole('tab')) {
      const controls = each.getAttribute('aria-controls');
      expect(controls === null || document.getElementById(controls) !== null).toBe(true);
    }
  });

  it('draws an empty tab row with no tab stop and no panel when nothing is offered', () => {
    show({ panels: {} });
    expect(screen.queryAllByRole('tab')).toEqual([]);
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(screen.getByRole('button', { name: 'Hide right sidebar' })).toBeDefined();
  });
});
