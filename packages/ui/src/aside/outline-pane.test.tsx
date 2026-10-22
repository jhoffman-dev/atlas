// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OutlineHeading } from '@dfai/domain';
import { OutlinePane } from './outline-pane.tsx';

const HEADINGS: readonly OutlineHeading[] = [
  { text: 'Plans', level: 1, at: [0] },
  { text: 'June', level: 2, at: [2] },
  { text: 'Larkspur launch', level: 3, at: [3] },
  { text: 'July', level: 2, at: [5] },
];

function show(overrides: Partial<Parameters<typeof OutlinePane>[0]> = {}) {
  const props = { headings: HEADINGS, onJump: vi.fn(), ...overrides };
  return { ...render(<OutlinePane {...props} />), props };
}

describe('OutlinePane', () => {
  it('is a navigation of the headings in the note’s order', () => {
    show();
    const nav = screen.getByRole('navigation', { name: 'Outline' });
    expect(nav).toBeDefined();
    expect(screen.getAllByRole('button').map((each) => each.textContent)).toEqual([
      'Plans',
      'June',
      'Larkspur launch',
      'July',
    ]);
  });

  it('indents each heading by its depth under the shallowest one', () => {
    show({ headings: HEADINGS.slice(1) });
    const depths = screen.getAllByRole('listitem').map((item) => item.getAttribute('data-depth'));
    expect(depths).toEqual(['0', '1', '0']);
  });

  it('asks to jump to a heading, by where it is, when it is clicked', async () => {
    const { props } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Larkspur launch' }));
    expect(props.onJump).toHaveBeenCalledTimes(1);
    expect(props.onJump).toHaveBeenCalledWith([3]);
  });

  it('says so when the note has no headings', () => {
    show({ headings: [] });
    expect(screen.getByText('No headings yet.')).toBeDefined();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
