// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, NO_LINKS, type NoteLinks } from '@atlas/domain';
import type { MentionsState } from '../note-links.tsx';
import { BacklinksPane } from './backlinks-pane.tsx';

function show(overrides: Partial<Parameters<typeof BacklinksPane>[0]> = {}) {
  const props = {
    links: NO_LINKS,
    mentions: { kind: 'idle' } as MentionsState,
    onOpen: vi.fn(),
    onFindMentions: vi.fn(),
    onLinkMention: vi.fn(),
    ...overrides,
  };
  return { ...render(<BacklinksPane {...props} />), props };
}

const group = (name: string) => screen.getByRole('region', { name });

describe('BacklinksPane (attack #353)', () => {
  it('says each group is empty when nothing links either way', () => {
    show();
    expect(within(group('Links here')).getByText('Nothing links here yet.')).toBeDefined();
    expect(
      within(group('Links from this note')).getByText('This note links nowhere yet.'),
    ).toBeDefined();
    expect(within(group('Unlinked mentions')).queryByRole('listitem')).toBeNull();
  });

  it('lists many links, every one openable, each opening its own note once', async () => {
    const incoming = Array.from({ length: 120 }, (_, at) => ({
      path: createVaultPath(`Notes/Larkspur ${at}.md`),
      title: `Larkspur ${at}`,
      via: null,
    }));
    const links: NoteLinks = { incoming, outgoing: [] };
    const { props } = show({ links });
    const buttons = within(group('Links here')).getAllByRole('button');
    expect(buttons).toHaveLength(120);
    await userEvent.click(within(group('Links here')).getByRole('button', { name: 'Larkspur 87' }));
    expect(props.onOpen).toHaveBeenCalledTimes(1);
    expect(props.onOpen).toHaveBeenCalledWith('Notes/Larkspur 87.md');
  });

  it('keeps a note linked both by body and by relation as two rows', () => {
    const path = createVaultPath('People/Mara Quill.md');
    show({
      links: {
        incoming: [
          { path, title: 'Mara Quill', via: null },
          { path, title: 'Mara Quill', via: 'Owner' },
        ],
        outgoing: [],
      },
    });
    expect(within(group('Links here')).getAllByRole('button')).toHaveLength(2);
  });

  it('asks for unlinked mentions once, only when the group is first opened', async () => {
    const { props } = show();
    expect(props.onFindMentions).not.toHaveBeenCalled();
    const toggle = screen.getByRole('button', { name: 'Unlinked mentions' });
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    expect(props.onFindMentions).toHaveBeenCalledTimes(1);
  });

  it('opens a mention on click and links it from its own button', async () => {
    const path = createVaultPath('Meetings/Tobias Fenn sync.md');
    const { props } = show({
      mentions: {
        kind: 'ready',
        mentions: [{ path, title: 'Tobias Fenn sync', excerpt: 'about Larkspur' }],
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Unlinked mentions' }));
    await userEvent.click(screen.getByRole('button', { name: /^Tobias Fenn sync/ }));
    expect(props.onOpen).toHaveBeenCalledWith(path);
    await userEvent.click(
      screen.getByRole('button', { name: 'Link the mention in Tobias Fenn sync' }),
    );
    expect(props.onLinkMention).toHaveBeenCalledWith(path);
    expect(props.onOpen).toHaveBeenCalledTimes(1);
  });

  it('reads a failed search as an alert', async () => {
    show({ mentions: { kind: 'failed', message: 'The index is rebuilding.' } });
    await userEvent.click(screen.getByRole('button', { name: 'Unlinked mentions' }));
    expect(screen.getByRole('alert').textContent).toBe('The index is rebuilding.');
  });
});
