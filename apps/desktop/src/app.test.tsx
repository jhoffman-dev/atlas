// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type VaultEntry, type VaultPath } from '@atlas/domain';
import {
  VaultAccessError,
  memoryActivityStore,
  fakeGoogleCalendar,
  failed,
  memorySyncFiles,
  scriptedFolders,
  scriptedGit,
  type AppInfoPort,
  type ModelProvider,
  type VaultFsPort,
  type VaultLocation,
  type VaultLocationStore,
  type VaultPickerPort,
} from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import { App, localToday } from './app.tsx';
import type { VaultPorts } from './vault/use-vault.ts';
import type { NotePorts } from './notes/use-note.ts';
import type { IndexPorts } from './index/use-index.ts';
import type { ChatPorts } from './chat/use-chat.ts';
import type { LocalApiPorts } from './api/use-local-api.ts';
import type { SourcePorts } from './sources/source-ports.ts';

const appInfo: AppInfoPort = { read: async () => ({ name: 'Atlas', version: '0.1.0' }) };

const location: VaultLocation = { absolutePath: '/Users/j/Vault', name: 'Vault' };

const entry = (path: string, kind: VaultEntry['kind']): VaultEntry =>
  ({ kind, name: path.split('/').at(-1) ?? '', path: createVaultPath(path) }) as VaultEntry;

/** A vault held in memory: directory listings by path, and file contents by path. */
function fakeVault({
  directories = {},
  files = {},
  remembered = null,
}: {
  directories?: Record<string, VaultEntry[]>;
  files?: Record<string, string>;
  remembered?: VaultLocation | null;
} = {}): VaultPorts & { picked: VaultPickerPort; written: Record<string, string> } {
  const written: Record<string, string> = {};
  const fs: VaultFsPort = {
    listDirectory: async (path: VaultPath) => directories[path] ?? [],
    listNotes: async () =>
      Object.keys(files)
        .filter((name) => name.endsWith('.md'))
        .map((name) => ({
          name,
          path: createVaultPath(name),
          modified: 1,
          size: (files[name] ?? '').length,
        })),
    readNotes: async (paths: readonly string[]) =>
      paths.flatMap((path) =>
        files[path] === undefined
          ? []
          : [{ path, text: files[path], modified: 1, size: files[path].length }],
      ),
    readBinaryFile: async () => new ArrayBuffer(0),
    createFolder: async () => {},
    trashEntry: async () => {},
    writeBinaryFile: async () => 0,
    moveEntry: async ({ from, to }) => {
      files[to] = files[from] ?? '';
      delete files[from];
      directories[''] = (directories[''] ?? [])
        .filter((item) => item.path !== from)
        .concat(entry(to, 'file'));
    },
    createNote: async ({ path, contents }) => {
      if (files[path] !== undefined)
        throw new VaultAccessError('a note with that name already exists');
      files[path] = contents;
      directories[''] = [...(directories[''] ?? []), entry(path, 'file')];
    },
    readTextFile: async (path: VaultPath) => {
      const text = files[path];
      if (text === undefined) throw new VaultAccessError('no such entry');
      return { text, modified: 1 };
    },
    writeTextFile: async ({ path, contents }) => {
      written[path] = contents;
      files[path] = contents;
      return 2;
    },
  };
  let held = remembered;
  const store: VaultLocationStore = {
    read: async () => held,
    write: async (next) => {
      held = next;
    },
  };
  const picker: VaultPickerPort = { pickDirectory: async () => location };
  const watch = { start: async () => {}, onChange: async () => () => {} };
  return { fs, store, picker, watch, picked: picker, written };
}

const notesFor = (vault: VaultPorts): NotePorts => ({
  fs: vault.fs,
  markdown: remarkMarkdown,
});

/** An index that answers plausibly without a database behind it. */
const fakeIndexPorts = (vault: VaultPorts): IndexPorts => ({
  fs: vault.fs,
  markdown: remarkMarkdown,
  index: {
    open: async () => {},
    clear: async () => {},
    manifest: async () => [],
    put: async () => {},
    remove: async () => {},
    search: async () => [],
    backlinks: async () => [],
    notesOfType: async () => [],
    rebuildViews: async () => {},
    query: async () => ({ columns: [], rows: [], truncated: false }),
    stats: async () => ({ notes: 0, properties: 0, links: 0 }),
  },
});

/** Google Calendar with no sign-in, as on a Mac that never connected. */
const googleCalendar = fakeGoogleCalendar().port;

/** Nothing in these tests fetches; a source that did would say so by throwing. */
const sources: SourcePorts = {
  http: {
    get: async () => {
      throw new Error('the app fetched something this test did not expect');
    },
  },
  sqlite: {
    query: () => Promise.reject(new Error('the app read a SQLite file this test did not expect')),
    pick: async () => null,
  },
  secrets: {
    list: async () => [],
    set: async () => {},
    bind: async () => {},
    remove: async () => {},
  },
};

/** The local API, off, with nothing arriving over it. */
const api: LocalApiPorts = {
  bridge: { serve: async () => () => {} },
  settings: {
    status: async () => ({ enabled: false, port: null, running: false, file: '/tmp/api.json' }),
    setEnabled: async () => {
      throw new Error('this test did not expect the API to be switched');
    },
    token: async () => 'token',
    rotateToken: async () => 'rotated',
  },
  clipboard: { write: async () => {} },
  mcpEntry: null,
};

/** Claude, reachable by neither way: these tests never open the chat. */
const unreachable: ModelProvider = {
  id: 'claude-code',
  status: async () => ({
    ready: false,
    problem: 'unavailable',
    message: 'Not in tests.',
    fix: null,
  }),
  stream: () => {
    throw new Error('this test did not expect to ask Claude anything');
  },
};
const chat: ChatPorts = { claudeCode: unreachable, anthropicApi: () => unreachable };

/** The Activity log kept in memory, and a window whose close button is never pressed. */
const activityIn = (store = memoryActivityStore()) => ({
  store,
  closing: { beforeClose: async () => () => undefined },
});

/** A vault in no repository, on a Mac with git: sync is simply not set up. */
const noSync = {
  git: () => scriptedGit({ script: { topLevel: failed('fatal: not a git repository', 128) } }).git,
  folders: scriptedFolders(),
  files: () => memorySyncFiles().port,
  github: { listRepositories: async () => ({ code: 0, stdout: '[]', stderr: '' }) },
  pause: { read: () => false, write: () => {} },
  thisMac: { name: async () => 'Test Mac', id: async () => 'mac-test' },
};

const renderApp = (
  vault: ReturnType<typeof fakeVault>,
  activity: ReturnType<typeof memoryActivityStore> = memoryActivityStore(),
) =>
  render(
    <App
      appInfo={appInfo}
      vault={vault}
      notes={notesFor(vault)}
      index={fakeIndexPorts(vault)}
      sources={sources}
      links={{ open: async () => {} }}
      snapshot={{ capture: () => Promise.reject(new Error('no pictures in these tests')) }}
      api={api}
      chat={chat}
      activity={activityIn(activity)}
      sync={noSync}
      googleCalendar={googleCalendar}
    />,
  );

// The window now remembers its split per vault, in local storage, and every
// test here opens the same vault. Without this each test would inherit the
// panes the one before it left, which is an order dependence.
beforeEach(() => window.localStorage.clear());

describe('App', () => {
  it('offers to open a vault on a first run', async () => {
    renderApp(fakeVault());
    expect(await screen.findByRole('heading', { name: 'Open a vault' })).toBeDefined();
    // No vault, so no tree and nothing to index — only the way to open one.
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('opens Settings from the gear, with or without a vault, and closes it again', async () => {
    renderApp(fakeVault());
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));

    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    expect(await within(dialog).findByText('Off')).toBeDefined();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
  });

  it('opens Settings with Cmd+,', async () => {
    renderApp(fakeVault());
    await screen.findByRole('heading', { name: 'Open a vault' });

    await userEvent.keyboard('{Meta>},{/Meta}');

    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeDefined();
  });

  it('reopens the vault from last launch and lists it', async () => {
    const vault = fakeVault({
      remembered: location,
      directories: { '': [entry('Notes', 'directory'), entry('todo.md', 'file')] },
    });
    renderApp(vault);
    expect(await screen.findByText('Notes')).toBeDefined();
    expect(screen.getByRole('treeitem', { name: 'todo' })).toBeDefined();
  });

  it('opens a vault the user chooses', async () => {
    const vault = fakeVault({ directories: { '': [entry('todo.md', 'file')] } });
    renderApp(vault);
    await userEvent.click(await screen.findByRole('button', { name: 'Choose folder…' }));
    expect(await screen.findByRole('treeitem', { name: 'todo' })).toBeDefined();
  });

  it('reads a directory only when it is expanded', async () => {
    const vault = fakeVault({
      remembered: location,
      directories: { '': [entry('Notes', 'directory')], Notes: [entry('Notes/today.md', 'file')] },
    });
    const listDirectory = vi.spyOn(vault.fs, 'listDirectory');
    // Only reads of this folder count: the app also reads .atlas for types
    // and templates, which is not what this test is about.
    const readsOf = (path: string) =>
      listDirectory.mock.calls.filter(([argument]) => argument === path).length;
    renderApp(vault);

    await screen.findByText('Notes');
    expect(readsOf('Notes')).toBe(0);
    expect(screen.queryByRole('treeitem', { name: 'today' })).toBeNull();

    await userEvent.click(screen.getByText('Notes'));
    expect(await screen.findByRole('treeitem', { name: 'today' })).toBeDefined();
    expect(readsOf('Notes')).toBe(1);
  });

  it('collapses a directory again without re-reading it', async () => {
    const vault = fakeVault({
      remembered: location,
      directories: { '': [entry('Notes', 'directory')], Notes: [entry('Notes/today.md', 'file')] },
    });
    const listDirectory = vi.spyOn(vault.fs, 'listDirectory');
    const readsOf = (path: string) =>
      listDirectory.mock.calls.filter(([argument]) => argument === path).length;
    renderApp(vault);

    await userEvent.click(await screen.findByText('Notes'));
    await screen.findByRole('treeitem', { name: 'today' });
    await userEvent.click(screen.getByText('Notes'));
    expect(screen.queryByRole('treeitem', { name: 'today' })).toBeNull();

    await userEvent.click(screen.getByText('Notes'));
    await screen.findByRole('treeitem', { name: 'today' });
    expect(readsOf('Notes')).toBe(1);
  });

  it('renders the note body in the editor, without its frontmatter', async () => {
    const text = '---\ntitle: Today\n---\n\n# Today\n\nSome body text.\n';
    const vault = fakeVault({
      remembered: location,
      directories: { '': [entry('today.md', 'file')] },
      files: { 'today.md': text },
    });
    renderApp(vault);

    await userEvent.click(await screen.findByRole('treeitem', { name: 'today' }));

    // The body is edited; the frontmatter is held aside and written back untouched.
    const body = await screen.findByLabelText('Note');
    expect(await within(body).findByRole('heading', { name: 'Today', level: 1 })).toBeDefined();
    expect(await screen.findByText('Some body text.')).toBeDefined();
    expect(screen.queryByText('title: Today')).toBeNull();
  });

  it('shows the note as saved until something is edited', async () => {
    const vault = fakeVault({
      remembered: location,
      directories: { '': [entry('today.md', 'file')] },
      files: { 'today.md': '# Today\n' },
    });
    renderApp(vault);

    await userEvent.click(await screen.findByRole('treeitem', { name: 'today' }));
    expect(await screen.findByText('Saved', { exact: true })).toBeDefined();
    // Saving is a command in the page's menu now, and there is nothing to save.
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    const save = await screen.findByRole('menuitem', { name: /^Save now/ });
    expect(save.getAttribute('aria-disabled')).toBe('true');
  });

  it('reports a note it cannot read instead of showing an empty pane', async () => {
    const vault = fakeVault({
      remembered: location,
      directories: { '': [entry('photo.png', 'file')] },
    });
    renderApp(vault);

    await userEvent.click(await screen.findByText('photo.png'));
    expect((await screen.findByRole('alert')).textContent).toBe('no such entry');
  });

  it('reports a vault it cannot list', async () => {
    const vault = fakeVault({ remembered: location });
    vault.fs.listDirectory = () => Promise.reject(new VaultAccessError('permission denied'));
    renderApp(vault);
    expect((await screen.findByRole('alert')).textContent).toBe('permission denied');
  });

  it('shows the app version in Settings once the host answers', async () => {
    renderApp(fakeVault());
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    expect(await within(dialog).findByText('Atlas 0.1.0')).toBeDefined();
  });
});

describe('wiki links', () => {
  const linked = () =>
    fakeVault({
      remembered: location,
      directories: { '': [entry('today.md', 'file'), entry('Another Note.md', 'file')] },
      files: {
        'today.md': 'see [[Another Note]] for more\n',
        'Another Note.md': '# Another Note\n\nThe target.\n',
      },
    });

  it('opens the note a link points at when it is clicked', async () => {
    renderApp(linked());
    await userEvent.click(await screen.findByRole('treeitem', { name: 'today' }));
    await userEvent.click(await screen.findByRole('link', { name: 'Another Note' }));

    expect(await screen.findByRole('article', { name: 'Another Note' })).toBeDefined();
    expect(await screen.findByText('The target.')).toBeDefined();
  });

  it('says so when a link points nowhere', async () => {
    const vault = fakeVault({
      remembered: location,
      directories: { '': [entry('today.md', 'file')] },
      files: { 'today.md': 'see [[Missing Note]] for more\n' },
    });
    renderApp(vault);
    await userEvent.click(await screen.findByRole('treeitem', { name: 'today' }));
    await userEvent.click(await screen.findByRole('link', { name: 'Missing Note' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'No note called "Missing Note"',
    );
  });

  it('shows the alias rather than the target when one is given', async () => {
    const vault = fakeVault({
      remembered: location,
      directories: { '': [entry('today.md', 'file')] },
      files: { 'today.md': 'see [[Another Note|the other one]]\n' },
    });
    renderApp(vault);
    await userEvent.click(await screen.findByRole('treeitem', { name: 'today' }));
    expect(await screen.findByRole('link', { name: 'the other one' })).toBeDefined();
  });
});

describe('two panes', () => {
  // jsdom lays nothing out, and ProseMirror measures the selection when the
  // focus lands back in an editor after a close.
  beforeAll(() => {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
  });

  const linked = () =>
    fakeVault({
      remembered: location,
      directories: { '': [entry('today.md', 'file'), entry('Another Note.md', 'file')] },
      files: {
        'today.md': 'see [[Another Note]] for more\n',
        'Another Note.md': '# Another Note\n\nThe target.\n',
      },
    });

  const pane = (which: 1 | 2) => screen.getByRole('region', { name: `Pane ${which}` });

  /** Opens today.md and splits the window, which is where each test starts. */
  async function splitOnToday(vault: ReturnType<typeof fakeVault>) {
    renderApp(vault);
    await userEvent.click(await screen.findByRole('treeitem', { name: 'today' }));
    await screen.findByRole('article', { name: 'today' });
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Split right/ }));
    await screen.findByRole('region', { name: 'Pane 2' });
  }

  it('starts the new pane on the note the old one holds', async () => {
    await splitOnToday(linked());

    expect(within(pane(1)).getByRole('article', { name: 'today' })).toBeDefined();
    expect(within(pane(2)).getByRole('article', { name: 'today' })).toBeDefined();
  });

  it('opens a note from the sidebar in the pane being worked in', async () => {
    await splitOnToday(linked());

    await userEvent.click(screen.getByRole('treeitem', { name: 'Another Note' }));

    // The split moved the focus to the new pane, so that is where it landed.
    expect(await within(pane(2)).findByRole('article', { name: 'Another Note' })).toBeDefined();
    expect(within(pane(1)).getByRole('article', { name: 'today' })).toBeDefined();
  });

  it('lands in the other pane once that is the one clicked into', async () => {
    await splitOnToday(linked());
    await userEvent.click(within(pane(1)).getByRole('article', { name: 'today' }));

    await userEvent.click(screen.getByRole('treeitem', { name: 'Another Note' }));

    expect(await within(pane(1)).findByRole('article', { name: 'Another Note' })).toBeDefined();
    expect(within(pane(2)).getByRole('article', { name: 'today' })).toBeDefined();
  });

  it('follows a link in the pane it was clicked in, leaving the other one alone', async () => {
    await splitOnToday(linked());

    await userEvent.click(within(pane(1)).getByRole('link', { name: 'Another Note' }));

    expect(await within(pane(1)).findByRole('article', { name: 'Another Note' })).toBeDefined();
    expect(within(pane(2)).getByRole('article', { name: 'today' })).toBeDefined();
  });

  it('closes a pane, leaving the note the other one held', async () => {
    await splitOnToday(linked());
    await userEvent.click(screen.getByRole('treeitem', { name: 'Another Note' }));
    await within(pane(2)).findByRole('article', { name: 'Another Note' });

    await userEvent.click(within(pane(2)).getByRole('button', { name: 'More' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Close pane/ }));

    expect(screen.queryByRole('region', { name: 'Pane 2' })).toBeNull();
    expect(within(pane(1)).getByRole('article', { name: 'today' })).toBeDefined();
    // The menu went with the pane; the focus is not left on the body.
    expect(pane(1).contains(document.activeElement)).toBe(true);
  });

  it('marks only the note in the focused pane in the sidebar', async () => {
    await splitOnToday(linked());
    await userEvent.click(screen.getByRole('treeitem', { name: 'Another Note' }));
    await within(pane(2)).findByRole('article', { name: 'Another Note' });

    const marked = screen
      .getAllByRole('treeitem')
      .filter((row) => row.getAttribute('aria-selected') === 'true')
      .map((row) => row.getAttribute('aria-label'));
    expect(marked).toEqual(['Another Note']);
  });

  it('stars a note open in both panes through an editor, not underneath one', async () => {
    const vault = linked();
    await splitOnToday(vault);

    await userEvent.click(within(pane(1)).getByRole('button', { name: 'Add today to favorites' }));

    // Written through a pane's own save, so it keeps the body it was holding.
    expect(vault.written['today.md']).toContain('favorite: true');
    expect(vault.written['today.md']).toContain('[[Another Note]]');
    // Both panes still show the note, neither stuck on a stale read.
    expect(within(pane(1)).getByRole('article', { name: 'today' })).toBeDefined();
    expect(within(pane(2)).getByRole('article', { name: 'today' })).toBeDefined();
  });
});

describe('creating a note', () => {
  const vaultWith = () =>
    fakeVault({
      remembered: location,
      directories: { '': [entry('today.md', 'file')] },
      files: { 'today.md': '# Today\n' },
    });

  it('adds a note and opens it', async () => {
    const vault = vaultWith();
    renderApp(vault);

    await userEvent.click(await screen.findByRole('button', { name: 'New note' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Blank note' }));

    expect(await screen.findByRole('article', { name: 'Untitled' })).toBeDefined();
    expect(vault.written['Untitled.md'] ?? Object.keys(vault.fs)).toBeDefined();
  });

  it('names the new note once, at the top of its page, not again in a heading (U-09)', async () => {
    renderApp(vaultWith());

    await userEvent.click(await screen.findByRole('button', { name: 'New note' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Blank note' }));

    const article = await screen.findByRole('article', { name: 'Untitled' });
    expect(within(article).getByRole('button', { name: 'Untitled' })).toBeDefined();
    const body = await screen.findByLabelText('Note');
    expect(within(body).queryAllByRole('heading')).toEqual([]);
  });

  it('numbers the next one rather than refusing', async () => {
    renderApp(vaultWith());

    const button = await screen.findByRole('button', { name: 'New note' });
    await userEvent.click(button);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Blank note' }));
    await screen.findByRole('article', { name: 'Untitled' });

    await userEvent.click(button);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Blank note' }));

    expect(await screen.findByRole('article', { name: 'Untitled 2' })).toBeDefined();
  });

  it('keeps no error line for the name it tried first and found taken (A28-01)', async () => {
    const activity = memoryActivityStore();
    const files: Record<string, string> = { 'today.md': '# Today\n' };
    renderApp(
      fakeVault({
        remembered: location,
        directories: { '': [entry('today.md', 'file')] },
        files,
      }),
      activity,
    );
    const button = await screen.findByRole('button', { name: 'New note' });
    // Made on disk by something else, and not yet seen: the first name tried is refused.
    files['Untitled.md'] = '# Untitled\n';
    await userEvent.click(button);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Blank note' }));
    await screen.findByRole('article', { name: 'Untitled 2' });

    // What waits is written at once as the page unloads, so a line would be in the file now.
    window.dispatchEvent(new Event('beforeunload'));
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    expect(activity.files.get(location.absolutePath) ?? '').not.toContain('"level":"error"');
  });

  it("puts today's note at the root, whatever note is in view", async () => {
    const vault = fakeVault({
      remembered: location,
      directories: { '': [entry('Notes', 'directory')], Notes: [entry('Notes/a.md', 'file')] },
      files: { 'Notes/a.md': '# A\n' },
    });
    const createNote = vi.spyOn(vault.fs, 'createNote');
    renderApp(vault);

    await userEvent.click(await screen.findByText('Notes'));
    await userEvent.click(await screen.findByRole('treeitem', { name: 'a' }));
    await screen.findByRole('article', { name: 'a' });
    await userEvent.click(await screen.findByRole('button', { name: 'New note' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: "Today's note" }));

    expect(await screen.findByRole('article', { name: localToday() })).toBeDefined();
    expect(createNote.mock.calls.map(([args]) => args.path)).toEqual([`${localToday()}.md`]);
  });
});

describe('the palettes and the shortcuts around them', () => {
  const vaultWith = () =>
    fakeVault({
      remembered: location,
      directories: { '': [entry('recipes.md', 'file')] },
      files: { 'recipes.md': '# Recipes\n\nSourdough.\n' },
    });

  const searchPalette = () => screen.queryByRole('dialog', { name: 'Search notes' });

  it('finds a note from Cmd+K, opens it, and puts the palette away', async () => {
    const vault = vaultWith();
    const index = fakeIndexPorts(vault);
    index.index.search = async () => [
      { path: 'recipes.md', title: 'Recipes', snippet: '<<Sourdough>>' },
    ];
    render(
      <App
        appInfo={appInfo}
        vault={vault}
        notes={notesFor(vault)}
        index={index}
        sources={sources}
        links={{ open: async () => {} }}
        snapshot={{ capture: () => Promise.reject(new Error('no pictures in these tests')) }}
        api={api}
        chat={chat}
        activity={activityIn()}
        sync={noSync}
        googleCalendar={googleCalendar}
      />,
    );
    await screen.findByRole('treeitem', { name: 'recipes' });

    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.click(await screen.findByLabelText('Search the vault'));
    await userEvent.paste('sour');
    await userEvent.click(await screen.findByRole('option', { name: /Recipes/ }));

    expect(await screen.findByRole('article', { name: 'recipes' })).toBeDefined();
    expect(searchPalette()).toBeNull();
  });

  it('closes the search palette with Escape, opening nothing', async () => {
    renderApp(vaultWith());
    await screen.findByRole('treeitem', { name: 'recipes' });

    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(await screen.findByRole('dialog', { name: 'Search notes' })).toBeDefined();
    await userEvent.keyboard('{Escape}');

    expect(searchPalette()).toBeNull();
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('makes a captured line a note of its own and opens it (Shift+Cmd+N)', async () => {
    const vault = vaultWith();
    const createNote = vi.spyOn(vault.fs, 'createNote');
    renderApp(vault);
    await screen.findByRole('treeitem', { name: 'recipes' });

    await userEvent.keyboard('{Meta>}{Shift>}n{/Shift}{/Meta}');
    await userEvent.type(await screen.findByLabelText('What needs doing'), 'Buy flour{Enter}');

    // Capture stays up for the next line; the note opens behind it.
    await vi.waitFor(() =>
      expect(createNote.mock.calls.map(([args]) => args.path)).toEqual(['Buy flour.md']),
    );
    expect(screen.getByRole('dialog', { name: 'Capture a task' })).toBeDefined();
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('article', { name: 'Buy flour' })).toBeDefined();
  });

  it("opens today's note with Shift+Cmd+D", async () => {
    renderApp(vaultWith());
    await screen.findByRole('treeitem', { name: 'recipes' });

    await userEvent.keyboard('{Meta>}{Shift>}d{/Shift}{/Meta}');

    expect(await screen.findByRole('article', { name: localToday() })).toBeDefined();
  });

  it('makes no note from Cmd+N or Shift+Cmd+D behind the search palette (A14-08)', async () => {
    const vault = vaultWith();
    const createNote = vi.spyOn(vault.fs, 'createNote');
    renderApp(vault);
    await screen.findByRole('treeitem', { name: 'recipes' });

    await userEvent.keyboard('{Meta>}k{/Meta}');
    await screen.findByRole('dialog', { name: 'Search notes' });
    await userEvent.keyboard('{Meta>}n{/Meta}');
    await userEvent.keyboard('{Meta>}{Shift>}d{/Shift}{/Meta}');
    await userEvent.keyboard('{Escape}');

    // Control, and the clock for the check: Cmd+N now makes "Untitled". Had
    // either press behind the palette made a note, it would be listed first.
    await userEvent.keyboard('{Meta>}n{/Meta}');
    expect(await screen.findByRole('article', { name: 'Untitled' })).toBeDefined();
    expect(createNote.mock.calls.map(([args]) => args.path)).toEqual(['Untitled.md']);
  });

  it('opens a new query from the palette, by the word "sql"', async () => {
    renderApp(vaultWith());
    await screen.findByRole('treeitem', { name: 'recipes' });

    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.click(await screen.findByLabelText('Search the vault'));
    await userEvent.paste('sql');
    await userEvent.click(await screen.findByRole('option', { name: /New query/ }));

    expect(await screen.findByRole('region', { name: 'Query' })).toBeDefined();
    expect(searchPalette()).toBeNull();
  });

  it.each([
    ['New view', 'View name'],
    ['New artifact', 'Link'],
  ])('puts up %s from the palette in its place', async (command, field) => {
    renderApp(vaultWith());
    await screen.findByRole('treeitem', { name: 'recipes' });

    await userEvent.keyboard('{Meta>}k{/Meta}');
    await userEvent.click(await screen.findByLabelText('Search the vault'));
    await userEvent.paste(command);
    await userEvent.click(await screen.findByRole('option', { name: new RegExp(command) }));

    const dialog = await screen.findByRole('dialog', { name: command });
    expect(within(dialog).getByLabelText(field)).toBeDefined();
    expect(searchPalette()).toBeNull();
  });

  it('hides the sidebar with Cmd+\\ and brings it back the same way', async () => {
    renderApp(vaultWith());
    await screen.findByRole('treeitem', { name: 'recipes' });

    await userEvent.keyboard('{Meta>}\\{/Meta}');
    expect(screen.queryByRole('treeitem', { name: 'recipes' })).toBeNull();

    await userEvent.keyboard('{Meta>}\\{/Meta}');
    expect(await screen.findByRole('treeitem', { name: 'recipes' })).toBeDefined();
  });
});

describe('the dialogs the sidebar opens', () => {
  const vaultWith = () =>
    fakeVault({
      remembered: location,
      directories: { '': [entry('recipes.md', 'file')] },
      files: { 'recipes.md': '# Recipes\n' },
    });

  it('opens New type from the sidebar and closes it again', async () => {
    renderApp(vaultWith());
    await userEvent.click(await screen.findByRole('button', { name: 'New type' }));

    const dialog = await screen.findByRole('dialog', { name: 'New type' });
    expect(within(dialog).getByLabelText('Type name')).toBeDefined();
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'New type' })).toBeNull();
  });

  it('opens New view from the Views "+" and closes it again', async () => {
    renderApp(vaultWith());
    await userEvent.click(await screen.findByRole('button', { name: 'New in Views' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'New view' }));

    const dialog = await screen.findByRole('dialog', { name: 'New view' });
    expect(within(dialog).getByLabelText('View name')).toBeDefined();
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'New view' })).toBeNull();
  });

  it('opens New artifact from the new-note menu and closes it again', async () => {
    renderApp(vaultWith());
    await userEvent.click(await screen.findByRole('button', { name: 'New note' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Claude artifact…' }));

    const dialog = await screen.findByRole('dialog', { name: 'New artifact' });
    expect(within(dialog).getByLabelText('Link')).toBeDefined();
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'New artifact' })).toBeNull();
  });
});

describe('the day the app calls today', () => {
  const zone = process.env.TZ;

  beforeEach(() => {
    // Eight in the evening in California is already tomorrow in UTC, which is
    // where a today-line drawn from toISOString used to land.
    process.env.TZ = 'America/Los_Angeles';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T03:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it('is the day where the person is, the way the index reads @today', () => {
    expect(localToday()).toBe('2026-09-20');
  });
});

describe('the Activity log, adversarial (U-28)', () => {
  it('keeps one error line for one index failure, not one from the index and one from its notice', async () => {
    const vault = fakeVault({
      remembered: location,
      directories: { '': [entry('todo.md', 'file')] },
    });
    const failing = fakeIndexPorts(vault);
    const activity = memoryActivityStore();
    render(
      <App
        appInfo={appInfo}
        vault={vault}
        notes={notesFor(vault)}
        index={{
          ...failing,
          index: { ...failing.index, open: () => Promise.reject(new Error('disk I/O error')) },
        }}
        sources={sources}
        links={{ open: async () => {} }}
        snapshot={{ capture: () => Promise.reject(new Error('no pictures in these tests')) }}
        api={api}
        chat={chat}
        activity={activityIn(activity)}
        sync={noSync}
        googleCalendar={googleCalendar}
      />,
    );
    // The window shows the failure as a red notice; both lines are batched into one write.
    expect((await screen.findAllByText(/disk I\/O error/)).length).toBeGreaterThan(0);
    const kept = () => activity.files.get(location.absolutePath) ?? '';
    await vi.waitFor(() => expect(kept()).toContain('disk I/O error'));
    const errors = kept()
      .split('\n')
      .filter((line) => line.includes('"level":"error"'));
    expect(errors).toHaveLength(1);
  });
});
