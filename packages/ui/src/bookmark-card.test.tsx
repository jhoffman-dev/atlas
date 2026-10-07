// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BookmarkCard, bookmarkClass, type BookmarkState } from './bookmark-card.tsx';

afterEach(cleanup);

const NOTE: BookmarkState = {
  kind: 'note',
  title: 'Rome in May',
  summary: 'Ten days, three cities.',
  place: 'Trips',
  archived: false,
  picture: 'blob:rome',
};

describe('a bookmark card', () => {
  it('shows the note: title, summary, where it lives and its picture', () => {
    const { container } = render(<BookmarkCard label="Rome" state={NOTE} />);
    expect(screen.getByRole('link', { name: 'Rome in May' })).toBeTruthy();
    expect(screen.getByText('Ten days, three cities.')).toBeTruthy();
    expect(screen.getByText('Trips')).toBeTruthy();
    expect(container.querySelector('img.bookmark__img')?.getAttribute('src')).toBe('blob:rome');
    expect(screen.queryByText('Archived')).toBeNull();
  });

  it('shows the page icon where the note has no picture', () => {
    const { container } = render(<BookmarkCard label="Rome" state={{ ...NOTE, picture: null }} />);
    expect(container.querySelector('.bookmark__picture')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.bookmark__picture svg')).not.toBeNull();
  });

  it('says a note is archived', () => {
    render(<BookmarkCard label="Rome" state={{ ...NOTE, archived: true }} />);
    expect(screen.getByText('Archived')).toBeTruthy();
    expect(bookmarkClass({ ...NOTE, archived: true }, false)).toContain('bookmark--archived');
  });

  it('says a link names no note, by the link as it reads', () => {
    render(<BookmarkCard label="Paris" state={{ kind: 'missing', label: 'Paris' }} />);
    expect(screen.getByRole('link', { name: 'Paris' })).toBeTruthy();
    expect(screen.getByText(/No note is called “Paris”/)).toBeTruthy();
    expect(screen.getByText('Missing note')).toBeTruthy();
    expect(bookmarkClass({ kind: 'missing', label: 'Paris' }, false)).toContain(
      'bookmark--missing',
    );
  });

  it('says when the note could not be read, and shows the link while it is read', () => {
    const { rerender } = render(<BookmarkCard label="Rome" state={{ kind: 'loading' }} />);
    expect(screen.getByRole('link', { name: 'Rome' })).toBeTruthy();
    expect(screen.queryByText(/could not be read/)).toBeNull();
    rerender(<BookmarkCard label="Rome" state={{ kind: 'failed' }} />);
    expect(screen.getByText(/could not be read/)).toBeTruthy();
  });

  it('opens the link menu from its "…" without the click reaching the card', () => {
    const onOptions = vi.fn();
    const onCard = vi.fn();
    render(
      <div onClick={onCard}>
        <BookmarkCard label="Rome" state={NOTE} onOptions={onOptions} />
      </div>,
    );
    // Named for its card, so a note of several cards is not a row of identical buttons.
    const button = screen.getByRole('button', { name: 'Options for Rome in May' });
    fireEvent.click(button);
    expect(onOptions).toHaveBeenCalledWith(button);
    expect(onCard).not.toHaveBeenCalled();
  });

  it('has no "…" where it has no menu', () => {
    render(<BookmarkCard label="Rome" state={NOTE} />);
    expect(screen.getByText('Rome in May')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is drawn selected with its own class', () => {
    expect(bookmarkClass(NOTE, true).split(' ')).toEqual(['bookmark', 'bookmark--selected']);
    expect(bookmarkClass({ kind: 'loading' }, false)).toBe('bookmark bookmark--loading');
  });
});
