// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabStrip, type TabStripTab } from './tab-strip.tsx';

const TABS: readonly TabStripTab[] = [
  { id: 't1', title: 'Task table', icon: 'table' },
  { id: 't2', title: 'Weekly review' },
  { id: 't3', title: 'Leftovers from the autumn review: templates in views' },
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

const tab = (name: string) => screen.getByRole('tab', { name });
const tabs = () => screen.getAllByRole('tab');

describe('TabStrip', () => {
  it('is a tablist of one tab per entry, with the shown one selected', () => {
    show();
    expect(screen.getByRole('tablist', { name: 'Pane 1 tabs' })).toBeDefined();
    expect(tabs().map((each) => each.textContent)).toEqual(TABS.map((each) => each.title));
    expect(tab('Task table').getAttribute('aria-selected')).toBe('true');
    expect(tab('Weekly review').getAttribute('aria-selected')).toBe('false');
  });

  it('asks to show a tab when it is clicked', async () => {
    const { props } = show();
    await userEvent.click(tab('Weekly review'));
    expect(props.onActivate).toHaveBeenCalledWith('t2');
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('offers × on the shown tab only, and it asks to close that tab', async () => {
    const { props } = show({ active: 't2' });
    expect(document.querySelectorAll('.tab-strip__close')).toHaveLength(1);
    await userEvent.click(screen.getByTitle('Close Weekly review'));
    expect(props.onClose).toHaveBeenCalledWith('t2');
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  it('closes a tab on a middle click, shown or not', async () => {
    const { props } = show();
    await userEvent.pointer({ keys: '[MouseMiddle]', target: tab('Weekly review') });
    expect(props.onClose).toHaveBeenCalledWith('t2');
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  it('asks for a new tab from +', async () => {
    const { props } = show();
    await userEvent.click(screen.getByRole('button', { name: 'New tab' }));
    expect(props.onNew).toHaveBeenCalledTimes(1);
  });

  it('puts only the shown tab in the Tab order, so the strip is one stop', () => {
    show({ active: 't2' });
    expect(tabs().map((each) => each.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('moves the focus between tabs with ← and →, round the ends, without showing them', async () => {
    const { props } = show();
    tab('Task table').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tab('Weekly review'));
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toBe(tab('Task table'));
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(tab(TABS[2]!.title));
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  it('jumps to the first and last tab with Home and End', async () => {
    show({ active: 't2' });
    tab('Weekly review').focus();
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(tab(TABS[2]!.title));
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(tab('Task table'));
  });

  it('shows the focused tab on Enter or Space', async () => {
    const { props } = show();
    tab('Task table').focus();
    await userEvent.keyboard('{ArrowRight}{Enter}');
    expect(props.onActivate).toHaveBeenLastCalledWith('t2');
    await userEvent.keyboard('{ArrowRight} ');
    expect(props.onActivate).toHaveBeenLastCalledWith('t3');
  });

  it('says whether its pane is the focused one, for the 2px ink border', () => {
    const { rerender, props } = show({ focused: true });
    const strip = screen.getByRole('tablist').parentElement!;
    expect(strip.className).toContain('tab-strip--focused');
    rerender(<TabStrip {...props} focused={false} />);
    expect(strip.className).not.toContain('tab-strip--focused');
  });

  it('closes the focused tab on Delete, shown or not', async () => {
    const { props } = show();
    tab('Task table').focus();
    await userEvent.keyboard('{ArrowRight}{Delete}');
    expect(props.onClose).toHaveBeenCalledWith('t2');
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  it('calls a tab with no title Untitled, on the tab and on its ×', () => {
    show({ tabs: [{ id: 't1', title: '  ' }], active: 't1' });
    expect(tab('Untitled')).toBeDefined();
    expect(screen.getByTitle('Close Untitled')).toBeDefined();
  });

  it('keeps × and + out of the tab list, which holds tabs alone', () => {
    show();
    const list = screen.getByRole('tablist');
    expect(list.contains(screen.getByRole('button', { name: 'New tab' }))).toBe(false);
    for (const child of Array.from(list.children))
      expect(child.getAttribute('role')).toBe('presentation');
    expect(screen.queryByRole('button', { name: /^Close/ })).toBeNull();
    expect(screen.getByTitle('Close Task table').tabIndex).toBe(-1);
  });

  it('moves the focus to the tab now shown when the focused tab closes', () => {
    const { rerender, props } = show({ active: 't1' });
    tab('Task table').focus();
    rerender(<TabStrip {...props} tabs={TABS.slice(1)} active="t2" />);
    expect(document.activeElement).toBe(tab('Weekly review'));
  });

  it('leaves the focus alone once it has left the strip for nowhere in particular', () => {
    const { rerender, props } = show({ active: 't1' });
    tab('Task table').focus();
    tab('Task table').blur();
    expect(document.activeElement).toBe(document.body);
    rerender(<TabStrip {...props} tabs={TABS.slice(1)} active="t2" />);
    expect(document.activeElement).toBe(document.body);
  });

  it('leaves the focus where the page put it when the focused tab closes from elsewhere', () => {
    const { rerender, props } = show({ active: 't1' });
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    tab('Task table').focus();
    elsewhere.focus();
    rerender(<TabStrip {...props} tabs={TABS.slice(1)} active="t2" />);
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('carries the whole title on a tab too long to show it', () => {
    show();
    expect(tab(TABS[2]!.title).getAttribute('title')).toBe(TABS[2]!.title);
  });
});
