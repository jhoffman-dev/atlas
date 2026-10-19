// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, NO_LINKS, type NoteLinks } from '@atlas/domain';
import { BacklinksPane } from './backlinks-pane.tsx';

const LINKS: NoteLinks = {
  incoming: [
    { path: createVaultPath('Meetings/Larkspur kickoff.md'), title: 'Larkspur kickoff', via: null },
    { path: createVaultPath('People/Mara Quill.md'), title: 'Mara Quill', via: 'Owner' },
  ],
  outgoing: [{ path: createVaultPath('Projects/Larkspur.md'), title: 'Larkspur', via: 'Project' }],
};

function show(overrides: Partial<Parameters<typeof BacklinksPane>[0]> = {}) {
  const props = {
    links: LINKS,
    mentions: { kind: 'idle' as const },
    onOpen: vi.fn(),
    onFindMentions: vi.fn(),
    onLinkMention: vi.fn(),
    ...overrides,
  };
  return { ...render(<BacklinksPane {...props} />), props };
}

describe('BacklinksPane', () => {
  it('lists what links here and what this note links to, open, with no toggle to find', () => {
    show();
    const incoming = screen.getByRole('region', { name: 'Links here' });
    expect(
      within(incoming)
        .getAllByRole('button')
        .map((each) => each.textContent),
    ).toEqual(['Larkspur kickoffMeetings/Larkspur kickoff.md', 'Mara QuillOwner']);
    const outgoing = screen.getByRole('region', { name: 'Links from this note' });
    expect(within(outgoing).getByRole('button', { name: 'Larkspur — Project' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /^Links/ })).toBeNull();
  });

  it('heads the incoming group as the page asks — "Mentioned in" on a person', () => {
    show({ incomingTitle: 'Mentioned in' });
    expect(screen.getByRole('region', { name: 'Mentioned in' })).toBeDefined();
  });

  it('opens a note when its row is clicked', async () => {
    const { props } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Mara Quill — Owner' }));
    expect(props.onOpen).toHaveBeenCalledWith(createVaultPath('People/Mara Quill.md'));
  });

  it('says so when nothing links either way', () => {
    show({ links: NO_LINKS });
    expect(screen.getByText('Nothing links here yet.')).toBeDefined();
    expect(screen.getByText('This note links nowhere yet.')).toBeDefined();
  });

  it('looks for unlinked mentions only when that group is opened', async () => {
    const { props } = show();
    expect(props.onFindMentions).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Unlinked mentions' }));
    expect(props.onFindMentions).toHaveBeenCalledTimes(1);
  });

  it('offers to link a mention it found', async () => {
    const { props } = show({
      mentions: {
        kind: 'ready',
        mentions: [
          {
            path: createVaultPath('Notes/Standup.md'),
            title: 'Standup',
            excerpt: '…talked to Larkspur about…',
          },
        ],
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Unlinked mentions' }));
    await userEvent.click(screen.getByRole('button', { name: 'Link the mention in Standup' }));
    expect(props.onLinkMention).toHaveBeenCalledWith(createVaultPath('Notes/Standup.md'));
    expect(props.onFindMentions).not.toHaveBeenCalled();
  });
});
