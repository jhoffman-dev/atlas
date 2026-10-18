// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabStrip, type TabStripTab } from './tab-strip.tsx';

/** Adversarial attack on PR #337: the tab strip's keyboard, focus and names. */

const TABS: readonly TabStripTab[] = [
  { id: 't1', title: 'Hollow Pine notes' },
  { id: 't2', title: 'Quarry ledger' },
  { id: 't3', title: 'Fennel garden' },
];

function show(overrides: Partial<Parameters<typeof TabStrip>[0]> = {}) {
  const props = {
    label: 'Pane 1 tabs',
    tabs: TABS,
    active: 't1',
    focused: true,
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onNew: vi.fn(),
    ...overrides,
  };
  return { ...render(<TabStrip {...props} />), props };
}

/** A strip wired to state the way the app would: close removes, the right neighbour shows. */
function Stateful({ onClose }: { onClose: (id: string) => void }) {
  const [tabs, setTabs] = useState<readonly TabStripTab[]>(TABS);
  const [active, setActive] = useState('t1');
  return (
    <TabStrip
      label="Pane 1 tabs"
      tabs={tabs}
      active={active}
      focused
      onActivate={setActive}
      onNew={() => undefined}
      onClose={(id) => {
        onClose(id);
        const at = tabs.findIndex((tab) => tab.id === id);
        const rest = tabs.filter((tab) => tab.id !== id);
        setTabs(rest);
        if (id === active) setActive((rest[at] ?? rest[at - 1])!.id);
      }}
    />
  );
}

const tabs = () => screen.getAllByRole('tab');

describe('attack-337: TabStrip', () => {
  it('has exactly one tab stop for every choice of active tab', () => {
    for (const { id } of TABS) {
      const { unmount } = show({ active: id });
      expect(tabs().filter((each) => each.tabIndex === 0)).toHaveLength(1);
      unmount();
    }
  });

  it('keeps one tab stop when active names no tab (a stale id for one render)', () => {
    show({ active: 'gone' });
    expect(tabs().filter((each) => each.tabIndex === 0)).toHaveLength(1);
  });

  it('wraps ← from the first tab to the last and → from the last to the first', async () => {
    show();
    tabs()[0]!.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(tabs()[2]);
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it('with a single tab, arrows, Home and End keep the focus on it', async () => {
    show({ tabs: [TABS[0]!] });
    tabs()[0]!.focus();
    await userEvent.keyboard('{ArrowLeft}{ArrowRight}{Home}{End}');
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it('keeps the focus inside the strip after the focused × closes its tab by keyboard', async () => {
    const onClose = vi.fn();
    render(<Stateful onClose={onClose} />);
    screen.getByRole('button', { name: /Close Hollow Pine notes/ }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onClose).toHaveBeenCalledWith('t1');
    expect(screen.getByRole('tablist').contains(document.activeElement)).toBe(true);
  });

  it('keeps the focus inside the strip after a focused tab is middle-clicked shut', async () => {
    const onClose = vi.fn();
    render(<Stateful onClose={onClose} />);
    const first = tabs()[0]!;
    first.focus();
    await userEvent.pointer({ keys: '[MouseMiddle]', target: first });
    expect(onClose).toHaveBeenCalledWith('t1');
    expect(screen.getByRole('tablist').contains(document.activeElement)).toBe(true);
  });

  it('shows × only on the active tab, named with that tab’s title', () => {
    show({ active: 't3' });
    const closes = screen.getAllByRole('button', { name: /^Close/ });
    expect(closes).toHaveLength(1);
    expect(closes[0]!.getAttribute('aria-label')).toContain('Fennel garden');
  });

  it('closes the active tab on a middle click on its ×', async () => {
    const { props } = show({ active: 't2' });
    await userEvent.pointer({
      keys: '[MouseMiddle]',
      target: screen.getByRole('button', { name: 'Close Quarry ledger' }),
    });
    expect(props.onClose).toHaveBeenCalledWith('t2');
  });

  it('closes a non-active tab on a middle click without showing it', async () => {
    const { props } = show();
    await userEvent.pointer({ keys: '[MouseMiddle]', target: tabs()[2]! });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledWith('t3');
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  it('a right click closes nothing', async () => {
    const { props } = show();
    await userEvent.pointer({ keys: '[MouseRight]', target: tabs()[1]! });
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('gives an empty-title tab a non-empty accessible name', () => {
    show({ tabs: [{ id: 't1', title: '' }], active: 't1' });
    const only = tabs()[0]!;
    const name = only.getAttribute('aria-label') ?? only.textContent ?? '';
    expect(name.trim()).not.toBe('');
  });

  it('gives an empty-title tab’s × a name that is more than "Close "', () => {
    show({ tabs: [{ id: 't1', title: '' }], active: 't1' });
    const close = screen.getByRole('button', { name: /^Close/ });
    expect(close.getAttribute('aria-label')!.trim()).not.toBe('Close');
  });

  it('rapid clicks on × fire onClose once per tab, never twice for one', async () => {
    const onClose = vi.fn();
    render(<Stateful onClose={onClose} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Close/ }));
    await user.click(screen.getByRole('button', { name: /^Close/ }));
    expect(onClose.mock.calls).toEqual([['t1'], ['t2']]);
  });

  it('Space on a non-active focused tab activates it once', async () => {
    const { props } = show();
    tabs()[0]!.focus();
    await userEvent.keyboard('{End} ');
    expect(props.onActivate).toHaveBeenCalledTimes(1);
    expect(props.onActivate).toHaveBeenCalledWith('t3');
  });
});
