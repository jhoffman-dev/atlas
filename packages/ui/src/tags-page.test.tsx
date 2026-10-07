// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TagRenamePlan } from '@atlas/application';
import { buildTagTree, createVaultPath, type TagTreeNode } from '@atlas/domain';
import { TagsPage, type TaggedNotesState, type TagTreeState } from './tags-page.tsx';
import type { TagRenameState } from './tag-rename-form.tsx';

const TREE = buildTagTree(
  [
    { key: 'idea', name: 'Idea', count: 4 },
    { key: 'para/resource', name: 'para/resource', count: 2 },
    { key: 'para/area', name: 'para/area', count: 1 },
  ],
  'name',
);
const IDEA = TREE.find((node) => node.key === 'idea') as TagTreeNode;

const NOTES: TaggedNotesState = {
  kind: 'ready',
  notes: [
    { path: createVaultPath('Alpha.md'), title: 'Alpha', count: 3 },
    { path: createVaultPath('Beta.md'), title: 'Beta', count: 1 },
  ],
};

const plan = (overrides: Partial<TagRenamePlan> = {}): TagRenamePlan => ({
  rename: { from: 'Idea', to: 'thought' },
  notes: [{ path: createVaultPath('Alpha.md'), title: 'Alpha', count: 3 }],
  total: 3,
  mergesInto: null,
  refused: [],
  ...overrides,
});

function show({
  tags = { kind: 'ready', tree: TREE } as TagTreeState,
  selected = null as TagTreeNode | null,
  rename = { kind: 'idle' } as TagRenameState,
  notice = null as string | null,
} = {}) {
  const props = {
    tags,
    sort: 'name' as const,
    onSortChange: vi.fn(),
    selected,
    onSelect: vi.fn(),
    notes: NOTES,
    onOpenNote: vi.fn(),
    rename: { state: rename, onPreview: vi.fn(), onConfirm: vi.fn(), onCancel: vi.fn() },
    notice,
  };
  render(<TagsPage {...props} />);
  return props;
}

const tree = () => within(screen.getByRole('list', { name: 'Tags' }));

describe('TagsPage: the tree', () => {
  it('lists every tag with its uses, a nested tag under its parent', () => {
    show();
    expect(tree().getByRole('button', { name: 'Idea 4 uses' })).toBeTruthy();
    const para = tree().getByRole('button', { name: 'para 3 uses' });
    const children = para.parentElement?.querySelector('.tags__children');
    expect(children).not.toBeNull();
    expect(
      within(children as HTMLElement)
        .getAllByRole('button')
        .map((row) => row.getAttribute('title')),
    ).toEqual(['#para/area', '#para/resource']);
  });

  it('says one use rather than one uses', () => {
    show();
    expect(tree().getByRole('button', { name: 'area 1 use' })).toBeTruthy();
  });

  it('chooses a tag by its key', async () => {
    const props = show();
    await userEvent.click(tree().getByRole('button', { name: 'resource 2 uses' }));
    expect(props.onSelect).toHaveBeenCalledWith('para/resource');
  });

  it('marks the chosen tag, and only it', () => {
    show({ selected: IDEA });
    const current = tree()
      .getAllByRole('button')
      .filter((row) => row.getAttribute('aria-current') === 'true');
    expect(current.map((row) => row.getAttribute('title'))).toEqual(['#Idea']);
  });

  it('changes the order when another sort is chosen', async () => {
    const props = show();
    await userEvent.click(screen.getByRole('radio', { name: 'Frequency' }));
    expect(props.onSortChange).toHaveBeenCalledWith('frequency');
  });

  it('says how to add a tag when there are none', () => {
    show({ tags: { kind: 'ready', tree: [] } });
    expect(screen.getByText(/Type # and a word/)).toBeTruthy();
  });

  it('says why the tags could not be read', () => {
    show({ tags: { kind: 'failed', message: 'The tags could not be read: boom' } });
    expect(screen.getByRole('alert').textContent).toBe('The tags could not be read: boom');
  });
});

describe('TagsPage: the chosen tag', () => {
  it('asks for a tag until one is chosen', () => {
    show();
    expect(screen.getByText('Choose a tag to see the notes that use it.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Notes' })).toBeNull();
  });

  it('lists the notes using it, each opening its note', async () => {
    const props = show({ selected: IDEA });
    expect(screen.getByRole('heading', { name: '#Idea', level: 2 })).toBeTruthy();
    const notes = within(screen.getByRole('list', { name: 'Notes' }));
    expect(notes.getAllByRole('button').map((note) => note.textContent)).toEqual([
      'Alpha3',
      'Beta1',
    ]);
    await userEvent.click(notes.getByRole('button', { name: /Beta/ }));
    expect(props.onOpenNote).toHaveBeenCalledWith('Beta.md');
  });

  it('shows what the last rename did', () => {
    show({ selected: IDEA, notice: 'Renamed in 2 notes.' });
    expect(screen.getByRole('status').textContent).toBe('Renamed in 2 notes.');
  });
});

describe('TagsPage: renaming', () => {
  it('previews the name typed, # and all, before anything is written', async () => {
    const props = show({ selected: IDEA });
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const form = within(screen.getByRole('form', { name: 'Rename #Idea' }));
    const input = form.getByLabelText('New name');
    expect((input as HTMLInputElement).value).toBe('Idea');
    await userEvent.clear(input);
    await userEvent.type(input, '#thought{Enter}');
    expect(props.rename.onPreview).toHaveBeenCalledWith('#thought');
    expect(props.rename.onConfirm).not.toHaveBeenCalled();
  });

  it('lists the files that will change, and renames on the second press', async () => {
    const props = show({ selected: IDEA, rename: { kind: 'planned', plan: plan() } });
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const form = within(screen.getByRole('form', { name: 'Rename #Idea' }));
    expect(form.getByText('3 uses in 1 note will become #thought:')).toBeTruthy();
    expect(form.getByText('Alpha.md')).toBeTruthy();
    await userEvent.click(form.getByRole('button', { name: 'Rename 3 uses' }));
    expect(props.rename.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('warns before merging into a tag already in use, and says so on the button', async () => {
    show({ selected: IDEA, rename: { kind: 'planned', plan: plan({ mergesInto: 'Thought' }) } });
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const form = within(screen.getByRole('form', { name: 'Rename #Idea' }));
    expect(form.getByRole('alert').textContent).toBe(
      '#Thought is already a tag. Its notes and these will share one tag.',
    );
    expect(form.getByRole('button', { name: 'Merge into #Thought' })).toBeTruthy();
  });

  it('names the notes that keep the old name because the new one would not read back there', async () => {
    const refused = [
      { path: createVaultPath('Beta.md'), reason: '#my tag# can’t be written here.' },
    ];
    show({ selected: IDEA, rename: { kind: 'planned', plan: plan({ refused }) } });
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const form = within(screen.getByRole('form', { name: 'Rename #Idea' }));
    expect(form.getByRole('note').textContent).toBe(
      '1 note keeps #Idea: Beta.md (#my tag# can’t be written here.)',
    );
  });

  it('says every use is written so already when renaming to the same spelling changes nothing', async () => {
    show({
      selected: IDEA,
      rename: {
        kind: 'planned',
        plan: plan({ rename: { from: 'Idea', to: 'Idea' }, notes: [], total: 0 }),
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const form = within(screen.getByRole('form', { name: 'Rename #Idea' }));
    expect(form.getByText('Every use is already written #Idea.')).toBeTruthy();
  });

  it('says why a name is refused', async () => {
    show({ selected: IDEA, rename: { kind: 'refused', message: 'Give the tag a name.' } });
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(screen.getByRole('alert').textContent).toBe('Give the tag a name.');
  });

  it('cannot rename while it is working', async () => {
    show({ selected: IDEA, rename: { kind: 'renaming', plan: plan() } });
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const button = screen.getByRole('button', { name: 'Rename 3 uses' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('forgets the preview when the name is changed, and closes on Cancel', async () => {
    const props = show({ selected: IDEA, rename: { kind: 'planned', plan: plan() } });
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await userEvent.type(screen.getByLabelText('New name'), 's');
    expect(props.rename.onCancel).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.rename.onCancel).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy();
  });
});
