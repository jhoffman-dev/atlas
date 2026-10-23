// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchPalette } from './search-palette.tsx';

/** A note and a highlight in it that both match: the same path, told apart by the block. */
const hits = [
  { path: 'Library/Art.md', title: 'The Art of War', snippet: 'about <<deception>>' },
  {
    path: 'Library/Art.md',
    title: 'The Art of War',
    snippet: 'All warfare is based on <<deception>>',
    block: 'k3x9q2',
  },
];

const props = {
  query: 'deception',
  hits,
  selected: 0,
  onQuery: () => {},
  onMove: () => {},
  onClose: () => {},
};

describe('SearchPalette with highlights (#507)', () => {
  it('lists a highlight beside its note, saying it is a highlight in place of the folder', () => {
    render(<SearchPalette {...props} onPick={() => {}} />);
    const [note, highlight] = screen.getAllByRole('option');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(note?.textContent).toContain('Library');
    expect(note?.textContent).not.toContain('Highlight');
    expect(highlight?.textContent).toContain('Highlight');
    expect(highlight?.textContent).toContain('All warfare is based on deception');
  });

  it('opens a highlight at its block, clicked or chosen with Enter, and a note with none', async () => {
    const onPick = vi.fn();
    const view = render(<SearchPalette {...props} selected={1} onPick={onPick} />);
    await userEvent.keyboard('{Enter}');
    expect(onPick).toHaveBeenLastCalledWith('Library/Art.md', 'k3x9q2');
    await userEvent.pointer({ keys: '[MouseLeft>]', target: screen.getAllByRole('option')[0]! });
    expect(onPick).toHaveBeenLastCalledWith('Library/Art.md');
    expect(onPick.mock.lastCall).toHaveLength(1);
    view.unmount();
  });
});
