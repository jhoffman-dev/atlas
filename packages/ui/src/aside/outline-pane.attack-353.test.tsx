// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OutlineHeading } from '@atlas/domain';
import { OutlinePane } from './outline-pane.tsx';

const depths = () =>
  screen.getAllByRole('listitem').map((item) => Number(item.getAttribute('data-depth')));

describe('OutlinePane (attack #353)', () => {
  it('steps a skipped level by its real depth: h1 then h4 is three in', () => {
    render(
      <OutlinePane
        headings={[
          { text: 'Plans', level: 1, at: [0] },
          { text: 'Deep', level: 4, at: [3] },
        ]}
        onJump={vi.fn()}
      />,
    );
    expect(depths()).toEqual([0, 3]);
  });

  it('draws all six levels with depths 0 to 5, the ones aside.css styles', () => {
    const headings: OutlineHeading[] = [1, 2, 3, 4, 5, 6].map((level) => ({
      text: `Level ${level}`,
      level,
      at: [level],
    }));
    render(<OutlinePane headings={headings} onJump={vi.fn()} />);
    expect(depths()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('measures depth from the shallowest heading, not from h1', () => {
    render(
      <OutlinePane
        headings={[
          { text: 'Three', level: 3, at: [0] },
          { text: 'Five', level: 5, at: [1] },
        ]}
        onJump={vi.fn()}
      />,
    );
    expect(depths()).toEqual([0, 2]);
  });

  it('jumps to the exact path of the heading clicked, once', async () => {
    const onJump = vi.fn();
    render(
      <OutlinePane
        headings={[
          { text: 'Same words', level: 2, at: [1] },
          { text: 'Same words', level: 2, at: [7] },
        ]}
        onJump={onJump}
      />,
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Same words' })[1]!);
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onJump).toHaveBeenCalledWith([7]);
  });

  it('keeps a very long heading’s full words readable where the row truncates them', () => {
    const text = 'The Larkspur payroll import stalls on the third retry when '.repeat(6).trim();
    render(<OutlinePane headings={[{ text, level: 2, at: [0] }]} onJump={vi.fn()} />);
    const button = screen.getByRole('button');
    expect(button.textContent).toBe(text);
    // aside.css ellipsises the row; a pointer reader needs the rest somewhere.
    expect(button.getAttribute('title')).toBe(text);
  });

  it('says there are no headings, with no list', () => {
    render(<OutlinePane headings={[]} onJump={vi.fn()} />);
    expect(screen.getByText('No headings yet.')).toBeDefined();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
