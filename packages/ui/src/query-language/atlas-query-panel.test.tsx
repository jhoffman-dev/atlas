// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AtlasQueryPanel, type AtlasQueryPanelProps } from './atlas-query-panel.tsx';

const LAYOUTS = [
  { value: 'table' as const, label: 'Table' },
  { value: 'board' as const, label: 'Board' },
];

function panel(overrides: Partial<AtlasQueryPanelProps> = {}, text = 'FROM task GROUP BY status') {
  const props: AtlasQueryPanelProps = {
    composer: {
      mode: 'text',
      onMode: vi.fn(),
      text,
      onTextChange: vi.fn(),
      problem: null,
      onRun: vi.fn(),
      builder: null,
      onBuilderChange: vi.fn(),
      textOnly: null,
      choices: { types: [{ value: 'task', label: 'Task' }], fields: [], valueChoices: () => [] },
    },
    layout: 'table',
    layouts: LAYOUTS,
    onLayout: vi.fn(),
    result: null,
    truncated: false,
    error: null,
    dashboards: { choices: [], notice: null, onAdd: vi.fn() },
    ...overrides,
  };
  render(<AtlasQueryPanel {...props} />);
  return props;
}

/** The element the toggle says it controls; the test fails if it names none. */
function controlled(toggle: HTMLElement): HTMLElement {
  const region = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
  if (region === null) throw new Error('the toggle controls nothing');
  return region;
}

describe('AtlasQueryPanel', () => {
  it('folded, shows the query as one line and keeps the editor out of reach', () => {
    panel({ fold: { collapsed: true, onToggle: vi.fn() } });
    const toggle = screen.getByRole('button', { name: 'Edit query' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(controlled(toggle).textContent).toBe('FROM task GROUP BY status');
    expect(screen.queryByRole('textbox', { name: 'Query' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Edit the query as' })).toBeNull();
    // What is under it is still there: the layout and the ways to keep it.
    expect(screen.getByRole('radiogroup', { name: 'Layout' })).toBeTruthy();
  });

  it('folded with nothing written yet, says so instead of showing an empty line', () => {
    panel({ fold: { collapsed: true, onToggle: vi.fn() } }, '');
    const toggle = screen.getByRole('button', { name: 'Edit query' });
    expect(controlled(toggle).textContent).toBe('No query yet');
  });

  it('open, shows the editor in the region it controls and offers to hide it', () => {
    panel({ fold: { collapsed: false, onToggle: vi.fn() } });
    const toggle = screen.getByRole('button', { name: 'Hide query' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const editor = screen.getByRole('textbox', { name: 'Query' });
    expect(controlled(toggle).contains(editor)).toBe(true);
  });

  it('asks to be folded or opened when the toggle is pressed', async () => {
    const onToggle = vi.fn();
    panel({ fold: { collapsed: true, onToggle } });
    await userEvent.click(screen.getByRole('button', { name: 'Edit query' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('without a fold, draws the editor open with no toggle, as the query page does', () => {
    panel();
    expect(screen.getByRole('textbox', { name: 'Query' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /query$/ })).toBeNull();
  });
});
