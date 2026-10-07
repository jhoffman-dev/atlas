// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  buildVaultGraph,
  createVaultPath,
  DEFAULT_GRAPH_FILTER,
  graphTypeTones,
  scopeGraph,
  UNTYPED,
  type GraphFilter,
  type VaultGraph,
} from '@atlas/domain';
import { GraphView, type GraphViewProps } from './graph-view.tsx';

const vault: VaultGraph = buildVaultGraph({
  notes: [
    { path: 'plan.md', title: 'The plan', type: 'project' },
    { path: 'task.md', title: 'A task', type: 'task' },
    { path: 'loose.md', title: 'Loose', type: null },
  ],
  links: [{ source: 'task.md', target: 'plan.md' }],
  relations: [{ source: 'task.md', key: 'project', value: '[[plan]]' }],
});
const types = ['project', 'task', UNTYPED];

/** The page as the app drives it: filters applied to the vault's graph by the domain's rule. */
function Harness(overrides: Partial<GraphViewProps>) {
  const [filter, setFilter] = useState<GraphFilter>(DEFAULT_GRAPH_FILTER);
  const graph = scopeGraph(vault, { scope: { kind: 'vault' }, filter });
  return (
    <GraphView
      content={{ kind: 'ready', graph, hidden: 0 }}
      centre={null}
      types={types}
      typeLabel={(type) => (type === null ? 'No type' : type)}
      tones={graphTypeTones(types)}
      filter={filter}
      onFilterChange={setFilter}
      onDepthChange={vi.fn()}
      onShowVault={vi.fn()}
      onOpen={vi.fn()}
      {...overrides}
    />
  );
}

const showList = () => userEvent.click(screen.getByRole('radio', { name: 'List' }));
const listed = () =>
  within(screen.getByRole('list', { name: 'Notes in the graph' }))
    .getAllByRole('listitem')
    .map((item) => item.getAttribute('data-path'))
    .filter((path) => path !== null);

describe('GraphView', () => {
  it('draws a dot per note, coloured by its type, and a dashed line per relation', () => {
    const { container } = render(<Harness />);
    const dots = [...container.querySelectorAll('.graph__node')];
    expect(dots.map((dot) => dot.getAttribute('data-path'))).toEqual([
      'loose.md',
      'plan.md',
      'task.md',
    ]);
    expect(dots.map((dot) => dot.getAttribute('data-tone'))).toEqual(['none', 'next', 'doing']);
    expect(container.querySelectorAll('[data-edge="relation"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-edge="link"]')).toHaveLength(1);
    expect(screen.getByText('3 notes · 2 connections')).toBeDefined();
  });

  it('lists the same notes with what each is connected to, as buttons', async () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);
    await showList();
    expect(listed()).toEqual(['loose.md', 'plan.md', 'task.md']);

    const task = screen.getByRole('list', { name: 'Connected to A task' });
    const ways = within(task)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(ways).toEqual(['Links toThe plan', 'ProjectThe plan']);

    await userEvent.click(within(task).getByRole('button', { name: /ProjectThe plan/ }));
    expect(onOpen).toHaveBeenCalledWith('plan.md', { split: false });
  });

  it('opens beside the note being read on Cmd-click', async () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);
    await showList();
    fireEvent.click(screen.getByRole('button', { name: /^Loose/ }), { metaKey: true });
    expect(onOpen).toHaveBeenCalledWith('loose.md', { split: true });
  });

  it('opens a note when its dot is clicked without being dragged', () => {
    const onOpen = vi.fn();
    const { container } = render(<Harness onOpen={onOpen} />);
    const dot = container.querySelector('[data-path="plan.md"]') as Element;
    fireEvent.pointerDown(dot, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(dot, { clientX: 11, clientY: 10, pointerId: 1 });
    expect(onOpen).toHaveBeenCalledWith('plan.md', { split: false });
  });

  it('does not open a note that was dragged', () => {
    const onOpen = vi.fn();
    const { container } = render(<Harness onOpen={onOpen} />);
    const dot = container.querySelector('[data-path="plan.md"]') as Element;
    fireEvent.pointerDown(dot, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(dot, { clientX: 60, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(dot, { clientX: 60, clientY: 40, pointerId: 1 });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('hides a type when its chip is pressed, and shows it again', async () => {
    render(<Harness />);
    await showList();
    const chip = screen.getByRole('button', { name: 'task' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');

    await userEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(listed()).toEqual(['loose.md', 'plan.md']);

    await userEvent.click(chip);
    expect(listed()).toEqual(['loose.md', 'plan.md', 'task.md']);
  });

  it('hides orphans on request', async () => {
    render(<Harness />);
    await showList();
    await userEvent.click(screen.getByRole('switch', { name: 'Hide orphans' }));
    expect(listed()).toEqual(['plan.md', 'task.md']);
  });

  it('offers depth and the whole vault only around one note', async () => {
    const onDepthChange = vi.fn();
    const onShowVault = vi.fn();
    const { unmount } = render(<Harness />);
    expect(screen.queryByRole('radiogroup', { name: 'Depth' })).toBeNull();
    unmount();

    render(
      <Harness
        centre={{ path: createVaultPath('plan.md'), title: 'The plan', depth: 1 }}
        onDepthChange={onDepthChange}
        onShowVault={onShowVault}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Around The plan' })).toBeDefined();
    await userEvent.click(screen.getByRole('radio', { name: '2 steps' }));
    expect(onDepthChange).toHaveBeenCalledWith(2);
    await userEvent.click(screen.getByRole('button', { name: 'Whole vault' }));
    expect(onShowVault).toHaveBeenCalled();
  });

  it('says how many notes it left out when the graph was capped', () => {
    render(<Harness content={{ kind: 'ready', graph: vault, hidden: 1400 }} />);
    expect(screen.getByRole('status').textContent).toContain('1400 more are left out');
  });

  it('says why there is no graph', () => {
    render(<Harness content={{ kind: 'failed', message: 'The index could not be read' }} />);
    expect(screen.getByRole('alert').textContent).toBe('The index could not be read');
  });
});
