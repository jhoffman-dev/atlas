// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createVaultPath, type VaultPath } from '@atlas/domain';
import { fakeIndexPort, fakeVaultFs, recordingActivity, type IndexPort } from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import { useTermsPage, type TermsPagePorts } from './use-terms-page.ts';

const LARKSPUR = createVaultPath('Terms/Larkspur.md');
const COLUMNS = ['path', 'title', 'type', 'key', 'value'];

/** An index holding one term, Larkspur, misheard as "lark spur"; counts how often it is asked. */
function oneTermIndex() {
  const asked = { count: 0 };
  const index = fakeIndexPort({
    query: async () => {
      asked.count += 1;
      return {
        columns: COLUMNS,
        rows: [['Terms/Larkspur.md', 'Larkspur', 'term', 'variants', 'lark spur']],
        truncated: false,
      };
    },
  });
  return { index, asked };
}

/** The vault's files in memory, the Terms folder among them; a write fails with `refuse` when given. */
function memoryFs(files: Record<string, string>, refuse: string | null = null) {
  const notes = new Map(Object.entries(files));
  const fs = fakeVaultFs({
    listDirectory: async () => [
      { kind: 'directory', name: 'Terms', path: createVaultPath('Terms') },
    ],
    readTextFile: async (path) => ({ text: notes.get(path) ?? '', modified: 1 }),
    writeTextFile: async ({ path, contents }) => {
      if (refuse !== null) throw new Error(refuse);
      notes.set(path, contents);
      return 2;
    },
    createNote: async ({ path, contents }) => {
      if (notes.has(path)) throw new Error('A note is already there.');
      notes.set(path, contents);
    },
  });
  return { fs, notes };
}

function renderPage({
  index = oneTermIndex().index,
  files = {},
  open = true,
  takenByAPane = false,
  refuse = null,
}: {
  index?: Pick<IndexPort, 'query'>;
  files?: Record<string, string>;
  open?: boolean;
  takenByAPane?: boolean;
  refuse?: string | null;
} = {}) {
  const { fs, notes } = memoryFs(files, refuse);
  const activity = recordingActivity();
  const setPropertiesIfOpen = vi.fn(async () => takenByAPane);
  const ports: TermsPagePorts = {
    index,
    fs,
    markdown: remarkMarkdown,
    editors: { setPropertiesIfOpen },
  };
  const onChanged = vi.fn();
  const hook = renderHook(
    (props: { open: boolean; indexKey: string }) =>
      useTermsPage({
        ports,
        ...props,
        types: [],
        templates: [],
        notePaths: Object.keys(files).map(createVaultPath) as VaultPath[],
        onChanged,
        activity,
      }),
    { initialProps: { open, indexKey: 'a' } },
  );
  return { ...hook, notes, onChanged, setPropertiesIfOpen, activity };
}

describe('useTermsPage', () => {
  it('reads the terms and the vocabulary while the page is open', async () => {
    const { result } = renderPage();
    await waitFor(() => expect(result.current.page.contents).not.toBeNull());
    expect(result.current.page.contents).toEqual({
      terms: [{ path: LARKSPUR, canonical: 'Larkspur', variants: ['lark spur'], kind: null }],
      conflicts: [],
      spellings: 2,
    });
  });

  it('asks nothing while the page is closed, and asks again when the index changes', async () => {
    const { index, asked } = oneTermIndex();
    const { result, rerender } = renderPage({ index, open: false });
    await act(async () => {});
    expect(asked.count).toBe(0);
    expect(result.current.page.contents).toBeNull();

    rerender({ open: true, indexKey: 'a' });
    await waitFor(() => expect(asked.count).toBe(1));
    rerender({ open: true, indexKey: 'b' });
    await waitFor(() => expect(asked.count).toBe(2));
  });

  it('says why when the index cannot be read', async () => {
    const index = fakeIndexPort({
      query: async () => {
        throw new Error('index closed');
      },
    });
    const { result } = renderPage({ index });
    await waitFor(() => expect(result.current.page.error).toBe('index closed'));
  });

  it('adds a term as a note of type term, then re-reads the vault', async () => {
    const { result, notes, onChanged } = renderPage();
    await act(async () =>
      result.current.page.onAdd({
        canonical: 'Fenn Ledger',
        variants: 'fen ledger',
        kind: 'product',
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(notes.get('Terms/Fenn Ledger.md')).toBe(
      '---\ntype: term\nkind: product\nvariants:\n  - fen ledger\n---\n',
    );
    expect(result.current.notice).toBeNull();
  });

  it('says why a term was not added, records no refusal, and re-reads nothing', async () => {
    const { result, onChanged, activity } = renderPage({ files: { 'Zeta/Larkspur.md': '' } });
    await act(async () =>
      result.current.page.onAdd({ canonical: 'Larkspur', variants: '', kind: null }),
    );
    await waitFor(() => expect(result.current.notice).toMatch(/^“Larkspur” was not added: /));
    expect(onChanged).not.toHaveBeenCalled();
    expect(activity.reports).toEqual([]);

    // The next write that lands takes the notice down.
    await act(async () =>
      result.current.page.onAdd({ canonical: 'Fenn Ledger', variants: '', kind: null }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(result.current.notice).toBeNull();
  });

  it('edits variants in the file’s frontmatter only, when no pane holds the term', async () => {
    const before = '---\ntype: term\nvariants:\n  - lark spur\n---\n\nHeard at the standup.\n';
    const { result, notes, onChanged, setPropertiesIfOpen } = renderPage({
      files: { 'Terms/Larkspur.md': before },
    });
    await act(async () =>
      result.current.page.onEditVariants({ path: LARKSPUR, variants: 'lark spur, Larks Burr' }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(setPropertiesIfOpen).toHaveBeenCalledWith({
      path: LARKSPUR,
      values: { variants: ['lark spur', 'Larks Burr'] },
    });
    expect(notes.get('Terms/Larkspur.md')).toBe(
      '---\ntype: term\nvariants:\n  - lark spur\n  - Larks Burr\n---\n\nHeard at the standup.\n',
    );
  });

  it('leaves the file to the pane that holds the term, which writes it through its own save', async () => {
    const before = '---\ntype: term\n---\n';
    const { result, notes, onChanged } = renderPage({
      files: { 'Terms/Larkspur.md': before },
      takenByAPane: true,
    });
    await act(async () => result.current.page.onEditVariants({ path: LARKSPUR, variants: 'x' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(notes.get('Terms/Larkspur.md')).toBe(before);
  });

  it('records once a variants write it gave up on', async () => {
    const { result, activity } = renderPage({
      files: { 'Terms/Larkspur.md': '---\ntype: term\n---\n' },
      refuse: 'The disk is full.',
    });
    await act(async () =>
      result.current.page.onEditVariants({ path: LARKSPUR, variants: 'lark spur' }),
    );
    await waitFor(() => expect(result.current.notice).toMatch(/The disk is full\./));
    expect(activity.reports).toEqual([
      expect.objectContaining({
        level: 'error',
        kind: 'save',
        subject: { kind: 'note', path: LARKSPUR },
      }),
    ]);
    expect(activity.reports[0]?.message).toMatch(/^Could not save the term — Larkspur\./);
  });
});
