// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RightSidebar, type AsideTab } from './right-sidebar.tsx';

const PANELS = {
  properties: <p>the rows</p>,
  backlinks: <p>the links</p>,
  outline: <p>the headings</p>,
};

function show(overrides: Partial<Parameters<typeof RightSidebar>[0]> = {}) {
  const props = {
    tab: 'properties' as AsideTab,
    panels: PANELS,
    onSelectTab: vi.fn(),
    onHide: vi.fn(),
    onEscape: vi.fn(),
    ...overrides,
  };
  return { ...render(<RightSidebar {...props} />), props };
}

const tab = (name: string) => screen.getByRole('tab', { name });

describe('RightSidebar', () => {
  it('is a complementary landmark named for the screen reader', () => {
    show();
    expect(screen.getByRole('complementary', { name: 'Right sidebar' })).toBeDefined();
  });

  it('offers a tab per panel it is given, in the sidebar’s order, with the shown one selected', () => {
    show({ tab: 'outline' });
    expect(screen.getByRole('tablist', { name: 'Right sidebar tabs' })).toBeDefined();
    expect(screen.getAllByRole('tab').map((each) => each.textContent)).toEqual([
      'Properties',
      'Backlinks',
      'Outline',
    ]);
    expect(tab('Outline').getAttribute('aria-selected')).toBe('true');
    expect(tab('Properties').getAttribute('aria-selected')).toBe('false');
  });

  it('draws the Claude tab only when a panel is given for it, after the others', () => {
    show({ panels: { ...PANELS, claude: <p>the chat</p> }, tab: 'claude' });
    expect(screen.getAllByRole('tab').map((each) => each.textContent)).toEqual([
      'Properties',
      'Backlinks',
      'Outline',
      'Claude',
    ]);
    expect(screen.getByRole('tabpanel').textContent).toBe('the chat');
  });

  it('shows the panel of the selected tab alone, labelled by its tab', () => {
    show({ tab: 'backlinks' });
    const panel = screen.getByRole('tabpanel', { name: 'Backlinks' });
    expect(panel.textContent).toBe('the links');
    expect(screen.queryByText('the rows')).toBeNull();
    expect(tab('Backlinks').getAttribute('aria-controls')).toBe(panel.id);
  });

  it('asks to show a tab when it is clicked, and decides nothing itself', async () => {
    const { props } = show();
    await userEvent.click(tab('Outline'));
    expect(props.onSelectTab).toHaveBeenCalledWith('outline');
    expect(screen.getByRole('tabpanel').textContent).toBe('the rows');
  });

  it('is one Tab stop: the selected tab, which ← → Home and End walk without showing', async () => {
    const { props } = show({ tab: 'backlinks' });
    expect(tab('Backlinks').tabIndex).toBe(0);
    expect(tab('Properties').tabIndex).toBe(-1);
    expect(tab('Outline').tabIndex).toBe(-1);

    tab('Backlinks').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tab('Outline'));
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tab('Properties'));
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(tab('Outline'));
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(tab('Properties'));
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(tab('Outline'));
    expect(props.onSelectTab).not.toHaveBeenCalled();

    await userEvent.keyboard('{Enter}');
    expect(props.onSelectTab).toHaveBeenCalledWith('outline');
  });

  it('asks to hide from the × in the tab row', async () => {
    const { props } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Hide right sidebar' }));
    expect(props.onHide).toHaveBeenCalledTimes(1);
    expect(props.onSelectTab).not.toHaveBeenCalled();
  });

  it('hands Escape up so the app can return the focus to the content', async () => {
    const { props } = show();
    tab('Properties').focus();
    await userEvent.keyboard('{Escape}');
    expect(props.onEscape).toHaveBeenCalledTimes(1);
    expect(props.onHide).not.toHaveBeenCalled();
  });

  it('leaves an Escape alone that an editor inside already answered', () => {
    const { props } = show({
      panels: { properties: <input aria-label="Due" onKeyDown={(e) => e.preventDefault()} /> },
    });
    const field = screen.getByLabelText('Due');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(props.onEscape).not.toHaveBeenCalled();
  });

  it('falls back to the first tab’s panel when asked for a tab it has no panel for', () => {
    show({ tab: 'claude' });
    expect(screen.getByRole('tabpanel').textContent).toBe('the rows');
    expect(tab('Properties').getAttribute('aria-selected')).toBe('true');
  });

  it('offers the type editor first, as Type, and widens to 340px only while it is shown', () => {
    const { container, rerender, props } = show({
      panels: { type: <p>the type</p>, properties: <p>the row</p> },
      tab: 'type',
    });
    expect(screen.getAllByRole('tab').map((each) => each.textContent)).toEqual([
      'Type',
      'Properties',
    ]);
    expect(screen.getByRole('tabpanel').textContent).toBe('the type');
    expect(container.querySelector('.aside')?.classList.contains('aside--type')).toBe(true);
    rerender(
      <RightSidebar
        {...props}
        panels={{ type: <p>the type</p>, properties: <p>the row</p> }}
        tab="properties"
      />,
    );
    expect(container.querySelector('.aside')?.classList.contains('aside--type')).toBe(false);
  });

  it('falls back past the Type tab: a chosen tab the page lacks shows Properties, at 300px', () => {
    const { container } = show({
      panels: { type: <p>the type</p>, properties: <p>the row</p> },
      tab: 'outline',
    });
    expect(screen.getByRole('tabpanel').textContent).toBe('the row');
    expect(container.querySelector('.aside--type')).toBeNull();
  });
});
