// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchPalette } from './search-palette.tsx';

const hits = [
  { path: 'a.md', title: 'Weekly review', snippet: 'the <<weekly>> plan' },
  { path: 'b.md', title: 'Recipes', snippet: 'sourdough' },
];

const props = {
  query: '',
  hits,
  selected: 0,
  onQuery: () => {},
  onMove: () => {},
  onPick: () => {},
  onClose: () => {},
};

/** The palette as the app mounts it: something else has focus until it opens. */
function Opener({ open }: { open: boolean }) {
  return (
    <>
      <button type="button">Opened me</button>
      {open ? <SearchPalette {...props} /> : null}
    </>
  );
}

describe('SearchPalette', () => {
  it('focuses the input so typing starts a search straight away', async () => {
    render(<SearchPalette {...props} />);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('searchbox', { name: 'Search the vault' }),
      ),
    );
  });

  it('lists a result per hit', () => {
    render(<SearchPalette {...props} />);
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('marks the words that matched', () => {
    render(<SearchPalette {...props} />);
    expect(screen.getByText('weekly').tagName).toBe('MARK');
  });

  it('marks the selected result for assistive technology', () => {
    render(<SearchPalette {...props} selected={1} />);
    const selected = screen
      .getAllByRole('option')
      .filter((option) => option.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toContain('Recipes');
  });

  it('reports what is typed', async () => {
    const onQuery = vi.fn();
    render(<SearchPalette {...props} onQuery={onQuery} />);
    await userEvent.type(screen.getByRole('searchbox'), 'we');
    expect(onQuery).toHaveBeenCalled();
  });

  it.each([
    ['ArrowDown', 1],
    ['ArrowUp', -1],
  ])('moves the selection on %s', async (key, delta) => {
    const onMove = vi.fn();
    render(<SearchPalette {...props} onMove={onMove} />);
    await userEvent.type(screen.getByRole('searchbox'), `{${key}}`);
    expect(onMove).toHaveBeenCalledWith(delta);
  });

  it('opens the selected result on Enter', async () => {
    const onPick = vi.fn();
    render(<SearchPalette {...props} selected={1} onPick={onPick} />);
    await userEvent.type(screen.getByRole('searchbox'), '{Enter}');
    expect(onPick).toHaveBeenCalledWith('b.md');
  });

  it('opens a result that is clicked', async () => {
    const onPick = vi.fn();
    render(<SearchPalette {...props} onPick={onPick} />);
    await userEvent.click(screen.getByRole('option', { name: /Recipes/ }));
    expect(onPick).toHaveBeenCalledWith('b.md');
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<SearchPalette {...props} onClose={onClose} />);
    await userEvent.type(screen.getByRole('searchbox'), '{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    // The palette is portalled to the body, so the backdrop is not under the
    // container the test rendered into.
    const { baseElement } = render(<SearchPalette {...props} onClose={onClose} />);
    const backdrop = baseElement.querySelector('.palette__backdrop');
    expect(backdrop).not.toBeNull();
    if (backdrop !== null) await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('gives focus back to whatever had it before, once it closes', async () => {
    const view = render(<Opener open={false} />);
    const opener = screen.getByRole('button', { name: 'Opened me' });
    opener.focus();

    view.rerender(<Opener open />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('searchbox')));

    view.rerender(<Opener open={false} />);
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('locks the page behind it, and lets go when it closes', async () => {
    expect(document.body.style.overflowY).toBe('');

    const view = render(<SearchPalette {...props} />);
    await waitFor(() => expect(document.body.style.overflowY).toBe('hidden'));

    view.unmount();
    await waitFor(() => expect(document.body.style.overflowY).toBe(''));
  });

  it('stays open when the palette itself is clicked', async () => {
    const onClose = vi.fn();
    render(<SearchPalette {...props} onClose={onClose} />);
    await userEvent.click(screen.getByRole('dialog', { name: 'Search notes' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says where each result lives the way the sidebar does, never as .atlas', () => {
    render(
      <SearchPalette
        {...props}
        hits={[
          { path: '.atlas/views/Board.md', title: 'Board', snippet: '' },
          { path: 'tasks/P1.md', title: 'P1', snippet: 'a <<task>>' },
        ]}
      />,
    );
    const [view, note] = screen.getAllByRole('option');
    expect(view?.textContent).toContain('Views');
    expect(view?.textContent).not.toContain('.atlas');
    expect(note?.textContent).toContain('tasks');
  });

  it('names a result by its title and place, not by the keys drawn beside it', () => {
    render(<SearchPalette {...props} />);
    const chosen = screen.getByRole('option', { name: /^Weekly review/ });
    expect(chosen.getAttribute('aria-selected')).toBe('true');
    expect(chosen.textContent).toContain('↵');
    expect(screen.queryByRole('option', { name: /↵/ })).toBeNull();
  });

  it('says so when a search matches nothing', () => {
    render(<SearchPalette {...props} query="zzz" hits={[]} />);
    expect(screen.getByText('Nothing matches.')).toBeDefined();
  });

  it('shows no message before anything has been typed', () => {
    render(<SearchPalette {...props} query="" hits={[]} />);
    expect(screen.queryByText('Nothing matches.')).toBeNull();
  });
});

describe('SearchPalette and archived notes', () => {
  it('offers no Include archived switch unless it is given one', () => {
    render(<SearchPalette {...props} />);
    expect(screen.queryByRole('switch', { name: 'Include archived' })).toBeNull();
  });

  it('switches Include archived, showing which it is', async () => {
    const onChange = vi.fn();
    render(<SearchPalette {...props} archived={{ included: false, onChange }} />);
    const toggle = screen.getByRole('switch', { name: 'Include archived' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('says an archived hit is in the Archive, not the folder it keeps there', () => {
    render(
      <SearchPalette
        {...props}
        hits={[{ path: 'Archive/Projects/Old.md', title: 'Old', snippet: '' }]}
      />,
    );
    expect(screen.getByText('Archive')).toBeTruthy();
    expect(screen.queryByText('Projects')).toBeNull();
  });
});
