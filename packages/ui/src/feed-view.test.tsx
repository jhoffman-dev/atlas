// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FEED_EXCERPT_BLOCKS, type BoardRow, type EditorDocument } from '@atlas/domain';
import { FeedView, type FeedBodies } from './feed-view.tsx';

const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

const rows: BoardRow[] = [
  { path: 'new.md', title: 'Newest', values: { status: 'doing', summary: 'What it is **about**' } },
  { path: 'old.md', title: 'Oldest', values: { status: 'done', summary: '' } },
];

const bodiesOf = (docs: Record<string, EditorDocument>): FeedBodies => ({
  bodyOf: (path) => docs[path],
  load: async () => null,
});

const props = {
  rows,
  fields: ['status'],
  shown: 10,
  onShowMore: () => {},
  onOpenNote: () => {},
  onFollowLink: () => {},
};

describe('FeedView', () => {
  it('draws each note as a card, in the order it is given', () => {
    render(<FeedView {...props} bodies={bodiesOf({})} />);
    const cards = within(screen.getByRole('list', { name: 'Notes' })).getAllByRole('article');
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual(['Newest', 'Oldest']);
  });

  it('shows a note’s fields as pills', () => {
    render(<FeedView {...props} bodies={bodiesOf({})} />);
    const newest = screen.getByRole('article', { name: 'Newest' });
    expect(within(newest).getByText(/^doing$/i)).toBeDefined();
  });

  it('shows what the note is about until its body has been read', () => {
    render(<FeedView {...props} bodies={bodiesOf({})} />);
    expect(screen.getByText('What it is about')).toBeDefined();
  });

  it('draws the body once it is read, with its links followable', async () => {
    const onFollowLink = vi.fn();
    const doc: EditorDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            { type: 'wikiLink', attrs: { target: 'Roadmap' } },
          ],
        },
      ],
    };
    render(
      <FeedView {...props} bodies={bodiesOf({ 'new.md': doc })} onFollowLink={onFollowLink} />,
    );
    const body = await screen.findByLabelText('Body of Newest');
    await waitFor(() => expect(body.textContent).toContain('See'));
    expect(screen.queryByText('What it is about')).toBeNull();

    const link = body.querySelector('[data-wikilink]');
    expect(link).not.toBeNull();
    await userEvent.click(link as Element);
    expect(onFollowLink).toHaveBeenCalledWith('Roadmap');
  });

  it('opens the tags page for a tag clicked in a body', async () => {
    const onOpenTag = vi.fn();
    const onOpenNote = vi.fn();
    render(
      <FeedView
        {...props}
        bodies={bodiesOf({ 'new.md': { type: 'doc', content: [paragraph('Plans #Draft now')] } })}
        onOpenNote={onOpenNote}
        onOpenTag={onOpenTag}
      />,
    );
    const body = await screen.findByLabelText('Body of Newest');
    await waitFor(() => expect(body.querySelector('[data-tag]')).not.toBeNull());
    await userEvent.click(body.querySelector('[data-tag]') as Element);
    expect(onOpenTag).toHaveBeenCalledWith('Draft');
    expect(onOpenNote).not.toHaveBeenCalled();
  });

  it('shows the opening of a long note, and the rest on Show more', async () => {
    const long: EditorDocument = {
      type: 'doc',
      content: Array.from({ length: FEED_EXCERPT_BLOCKS + 2 }, (_, at) => paragraph(`Line ${at}`)),
    };
    render(<FeedView {...props} bodies={bodiesOf({ 'new.md': long })} />);
    const body = await screen.findByLabelText('Body of Newest');
    await waitFor(() => expect(body.textContent).toContain('Line 0'));
    expect(body.textContent).not.toContain(`Line ${FEED_EXCERPT_BLOCKS + 1}`);

    const more = screen.getByRole('button', { name: 'Show more' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(more);
    await waitFor(() => expect(body.textContent).toContain(`Line ${FEED_EXCERPT_BLOCKS + 1}`));
    expect(screen.getByRole('button', { name: 'Show less' })).toBeDefined();
  });

  it('offers no Show more for a short note', async () => {
    render(
      <FeedView
        {...props}
        bodies={bodiesOf({ 'new.md': { type: 'doc', content: [paragraph('Short')] } })}
      />,
    );
    await screen.findByLabelText('Body of Newest');
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('opens a note from its title', async () => {
    const onOpenNote = vi.fn();
    render(<FeedView {...props} bodies={bodiesOf({})} onOpenNote={onOpenNote} />);
    await userEvent.click(screen.getByRole('button', { name: 'Oldest' }));
    expect(onOpenNote).toHaveBeenCalledWith('old.md');
  });

  it('draws only the notes it is shown, and offers the rest', async () => {
    const onShowMore = vi.fn();
    render(<FeedView {...props} shown={1} bodies={bodiesOf({})} onShowMore={onShowMore} />);
    expect(screen.getByRole('article', { name: 'Newest' })).toBeDefined();
    expect(screen.queryByRole('article', { name: 'Oldest' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show more notes' }));
    expect(onShowMore).toHaveBeenCalled();
  });

  it('offers no more when every note is drawn', () => {
    render(<FeedView {...props} shown={2} bodies={bodiesOf({})} />);
    expect(screen.getByRole('article', { name: 'Oldest' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Show more notes' })).toBeNull();
  });

  it('says so when nothing matches', () => {
    render(<FeedView {...props} rows={[]} bodies={bodiesOf({})} />);
    expect(screen.getByText('Nothing matches this view yet.')).toBeDefined();
  });
});
