// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type InboxItem } from '@atlas/domain';
import { InboxPage, type InboxContents, type InboxPageProps } from './inbox-page.tsx';
import type { RelationChoice } from './properties-panel.tsx';

const item = (path: string, title: string, type: string | null, arrivedIn = ''): InboxItem => ({
  path: createVaultPath(path),
  title,
  type,
  arrivedIn,
});

const CONTENTS: InboxContents = {
  items: [
    item('Inbox/Call the bank.md', 'Call the bank', 'task'),
    item('Inbox/Meetings/Standup.md', 'Standup', 'meeting', 'Meetings'),
    item('Inbox/Idea.md', 'Idea', null),
  ],
  truncated: false,
};

const FILING: readonly RelationChoice[] = [
  { path: 'Projects/Atlas.md', title: 'Atlas', type: 'project' },
  { path: 'Areas/Garden.md', title: 'Garden', type: 'area' },
];

function page(overrides: Partial<InboxPageProps> = {}) {
  const props: InboxPageProps = {
    contents: CONTENTS,
    error: null,
    filing: FILING,
    onOpen: vi.fn(),
    onProcess: vi.fn(),
    busy: false,
    problem: null,
    ...overrides,
  };
  render(<InboxPage {...props} />);
  return props;
}

const rowOf = (title: string) =>
  screen.getByRole('button', { name: title }).closest('tr') as HTMLElement;

describe('InboxPage', () => {
  it('lists every note waiting, of any type, saying where in the Inbox it arrived', () => {
    page();
    expect(within(rowOf('Call the bank')).getByText('Task')).toBeDefined();
    expect(within(rowOf('Standup')).getByText('Meeting · Meetings')).toBeDefined();
    expect(within(rowOf('Idea')).getByText('Note')).toBeDefined();
    expect(screen.getByText(/3 to process/)).toBeDefined();
  });

  it('opens a note from its name', async () => {
    const props = page();
    await userEvent.click(screen.getByRole('button', { name: 'Standup' }));
    expect(props.onOpen).toHaveBeenCalledWith('Inbox/Meetings/Standup.md');
  });

  it('offers the projects and the areas to file a note under, each under its own', () => {
    page();
    const picker = screen.getByRole('combobox', { name: 'File Idea under' });
    const groups = [...picker.querySelectorAll('optgroup')];
    expect(groups.map((group) => group.label)).toEqual(['Project', 'Area']);
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['File under…', 'Atlas', 'Garden']);
  });

  it('processes a note into the project picked', async () => {
    const props = page();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'File Call the bank under' }),
      'Garden',
    );
    expect(props.onProcess).toHaveBeenCalledWith({
      path: 'Inbox/Call the bank.md',
      project: 'Areas/Garden.md',
    });
  });

  it('files nothing while a note is being filed, or when there is nothing to file under', () => {
    page({ busy: true });
    expect(
      (screen.getByRole('combobox', { name: 'File Idea under' }) as HTMLSelectElement).disabled,
    ).toBe(true);
  });

  it('says there is no project or area yet rather than offering an empty list', () => {
    page({ filing: [] });
    const picker = screen.getByRole('combobox', { name: 'File Idea under' }) as HTMLSelectElement;
    expect(picker.disabled).toBe(true);
    expect(picker.options[0]?.textContent).toBe('No project or area yet');
  });

  it('says why a note could not be filed', () => {
    page({ problem: 'Call the bank: the disk is full' });
    expect(screen.getByRole('alert').textContent).toBe('Call the bank: the disk is full');
  });

  it('says when nothing is waiting', () => {
    page({ contents: { items: [], truncated: false } });
    expect(screen.getByText(/Nothing is waiting/)).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('offers to let the vault’s types link a project or an area, and does it when asked', async () => {
    const onAccept = vi.fn();
    const onDismiss = vi.fn();
    page({
      typesOffer: {
        lines: ['Task gains Project, linking project or area notes.'],
        onAccept,
        onDismiss,
      },
    });
    const offer = screen.getByRole('complementary', {
      name: 'Link your types to projects and areas',
    });
    expect(offer.textContent).toContain('Task gains Project, linking project or area notes.');
    await userEvent.click(within(offer).getByRole('button', { name: 'Add to the types' }));
    expect(onAccept).toHaveBeenCalledOnce();
    await userEvent.click(within(offer).getByRole('button', { name: 'Not now' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('links to the vault’s own Inbox view when it has one', async () => {
    const onOpen = vi.fn();
    page({ view: { title: 'Inbox', onOpen } });
    await userEvent.click(screen.getByRole('button', { name: 'Open the Inbox view' }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('has no offer and no view link when there is neither', () => {
    page();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Open the/ })).toBeNull();
  });
});
