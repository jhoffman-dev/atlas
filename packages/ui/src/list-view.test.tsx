// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardRow } from '@atlas/domain';
import { GalleryView, ListView } from './list-view.tsx';

const rows: BoardRow[] = [
  { path: 'a.md', title: 'First', values: { status: 'doing', phase: 1, empty: '' } },
  { path: 'b.md', title: 'Second', values: { status: 'done', phase: null } },
];

const fields = ['title', 'status', 'phase', 'empty'];

describe('GalleryView covers', () => {
  it('fronts a card with its note’s cover, resolved against that note', async () => {
    const load = vi.fn(
      async ({ path, src }: { path: string; src: string }) => `blob:${path}/${src}`,
    );
    const covers = { coverOf: (path: string) => (path === 'a.md' ? 'front.png' : null), load };
    const { container } = render(
      <GalleryView rows={rows} fields={fields} onOpenNote={() => {}} covers={covers} />,
    );
    await waitFor(() => expect(container.querySelectorAll('img.card-cover')).toHaveLength(1));
    expect(container.querySelector('img.card-cover')?.getAttribute('src')).toBe(
      'blob:a.md/front.png',
    );
    expect(load).toHaveBeenCalledWith({ path: 'a.md', src: 'front.png' });
  });

  it('draws no picture when the cover cannot be read', async () => {
    const load = vi.fn(async () => null);
    const covers = { coverOf: () => 'missing.png', load };
    const { container } = render(
      <GalleryView rows={rows} fields={fields} onOpenNote={() => {}} covers={covers} />,
    );
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(container.querySelector('img')).toBeNull();
  });
});

describe.each([
  ['ListView', ListView],
  ['GalleryView', GalleryView],
])('%s', (_name, View) => {
  it('shows a row per note', () => {
    render(<View rows={rows} fields={fields} onOpenNote={() => {}} />);
    expect(screen.getByText('First')).toBeDefined();
    expect(screen.getByText('Second')).toBeDefined();
  });

  it('shows the other fields', () => {
    render(<View rows={rows} fields={fields} onOpenNote={() => {}} />);
    expect(screen.getByText('doing')).toBeDefined();
  });

  it('leaves out a field with no value rather than showing a gap', () => {
    const { container } = render(<View rows={rows} fields={fields} onOpenNote={() => {}} />);
    const chips = [...container.querySelectorAll('.note-chip, .status-pill')];
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.every((chip) => chip.textContent !== '')).toBe(true);
  });

  it('opens a note when it is clicked', async () => {
    const onOpenNote = vi.fn();
    render(<View rows={rows} fields={fields} onOpenNote={onOpenNote} />);
    await userEvent.click(screen.getByText('First'));
    expect(onOpenNote).toHaveBeenCalledWith('a.md');
  });

  it('draws a choice as its status pill and a number with its name', () => {
    const { container } = render(
      <View
        rows={rows}
        fields={fields}
        kinds={{ status: 'select', phase: 'number' }}
        onOpenNote={() => {}}
      />,
    );
    const pill = container.querySelector('.status-pill');
    expect(pill?.textContent).toBe('Doing');
    expect(screen.getByText('Phase 1')).toBeDefined();
  });

  it('shows what a note is about as plain words, not markdown', () => {
    render(
      <View
        rows={[{ path: 'c.md', title: 'Third', values: { summary: 'Fix `compile` ~~now~~' } }]}
        fields={['title', 'summary']}
        onOpenNote={() => {}}
      />,
    );
    expect(screen.getByText('Fix compile now')).toBeDefined();
  });

  it('says so when nothing matches', () => {
    render(<View rows={[]} fields={fields} onOpenNote={() => {}} />);
    expect(screen.getByText('Nothing matches this view yet.')).toBeDefined();
  });
});
