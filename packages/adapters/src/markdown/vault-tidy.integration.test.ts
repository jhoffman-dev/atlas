/**
 * The one-time tidy (#214) with the real YAML reader and the real link
 * rewriter, over an in-memory vault that behaves like the host: the preview
 * lists the exact moves, nothing moves until apply, every link and relation
 * opens the note it opened before, and a second tidy moves nothing.
 */
import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  movedPath,
  parentVaultPath,
  resolveWikiLinkTarget,
  vaultPathName,
  type EntryMove,
  type VaultEntry,
  type VaultPath,
} from '@dfai/domain';
import {
  applyVaultTidy,
  previewVaultTidy,
  type ArchivePorts,
  type IndexPort,
  type VaultFsPort,
} from '@dfai/application';
import { remarkMarkdown } from './markdown-port.ts';

const TODAY = '2026-10-14';

function memoryVault(notes: Record<string, string>) {
  const files = new Map(Object.entries(notes));
  const dirs = new Set<string>();
  const moves: EntryMove[] = [];
  for (const at of files.keys()) {
    let folder = parentVaultPath(createVaultPath(at));
    while (folder !== '') {
      dirs.add(folder);
      folder = parentVaultPath(folder);
    }
  }
  const entry = (at: string, kind: VaultEntry['kind']): VaultEntry =>
    ({ kind, name: vaultPathName(createVaultPath(at)), path: createVaultPath(at) }) as VaultEntry;
  const used: Partial<VaultFsPort> = {
    listNotes: async () =>
      [...files.keys()].map((at) => ({
        name: vaultPathName(createVaultPath(at)),
        path: createVaultPath(at),
        modified: 1,
        size: 1,
      })),
    listDirectory: async (parent) => [
      ...[...dirs]
        .filter((at) => parentVaultPath(createVaultPath(at)) === parent)
        .map((at) => entry(at, 'directory')),
      ...[...files.keys()]
        .filter((at) => parentVaultPath(createVaultPath(at)) === parent)
        .map((at) => entry(at, 'file')),
    ],
    createFolder: async ({ path }) => {
      if (dirs.has(path) || files.has(path)) throw new Error('already there');
      dirs.add(path);
    },
    moveEntry: async (move: EntryMove) => {
      if (!files.has(move.from)) throw new Error('no such entry');
      if (files.has(move.to) || dirs.has(move.to)) throw new Error('already there');
      if (!dirs.has(parentVaultPath(move.to)) && parentVaultPath(move.to) !== '') {
        throw new Error('that folder does not exist');
      }
      moves.push(move);
      for (const [at, text] of [...files]) {
        const to = movedPath(at as VaultPath, move);
        if (to !== null) {
          files.delete(at);
          files.set(to, text);
        }
      }
    },
    readTextFile: async (at) => {
      const text = files.get(at);
      if (text === undefined) throw new Error('no such note');
      return { text, modified: 1 };
    },
    readNotes: async (paths) =>
      paths.flatMap((at) => {
        const text = files.get(at);
        return text === undefined ? [] : [{ path: at, text, modified: 1, size: text.length }];
      }),
    writeTextFile: async ({ path, contents }) => {
      files.set(path, contents);
      return 2;
    },
  };
  const fs = new Proxy(used, {
    get: (target, name: string) => {
      const method = target[name as keyof VaultFsPort];
      if (method === undefined) throw new Error(`fs.${name} is not faked`);
      return method;
    },
  }) as VaultFsPort;
  const ports: ArchivePorts = {
    fs,
    markdown: remarkMarkdown,
    index: { remove: async () => {} } as unknown as IndexPort,
    editors: {
      state: () => 'closed',
      flush: async () => {},
      follow: () => {},
      abandon: () => {},
      reload: () => {},
    },
  };
  return { files, moves, ports };
}

const VAULT = {
  // Loose at the root: a company, a task, a plain note and a daily note.
  'Acme.md': '---\ntype: company\n---\n\nThe client.\n',
  'Call Sam.md': '---\ntype: task\nstatus: next-action\n---\n\nAbout [[Acme]].\n',
  'Idea.md': 'Just a thought.\n',
  '2026-09-30.md': '---\ntype: daily\n---\n\nMet [[Acme]].\n',
  // A namesake one folder down, which [[Acme]] would open once the root one is deeper.
  'Clients/Acme.md': '# Another Acme\n',
  // A note the tidy never moves, linking by body and by relation.
  'Projects/DFAI.md':
    '---\ntype: project\ncompany: "[[Acme]]"\n---\n\nFor [[Acme]], see [[Call Sam]] and [[Idea]].\n',
  // A let-in meeting in the older flat folder, and one still arriving there.
  'Inbox/Meetings/2026-09-29 Larkspur sync.md':
    "---\ntype: meeting\natlas_import: meeting/v1\natlas_import_outcome: imported\ndate: '2026-09-29'\n---\n\nWith [[Acme]].\n",
  'Inbox/Meetings/2026-10-13 Arriving.md':
    "---\ntype: meeting\natlas_import: meeting/v1\ndate: '2026-10-13'\n---\n",
  // Already where the plain note would go: it is refused, not renamed.
  'Notes/2026/Idea.md': 'An older idea.\n',
};

/** Every `[[link]]` in the vault, with the note it opens among these paths. */
function linkTargets(files: ReadonlyMap<string, string>): Map<string, VaultPath | null> {
  const paths = [...files.keys()].map((at) => createVaultPath(at));
  const opened = new Map<string, VaultPath | null>();
  for (const [at, text] of files) {
    for (const [, target] of text.matchAll(/\[\[([^\]|#]+)/g)) {
      opened.set(`${at} -> ${target}`, resolveWikiLinkTarget(target!, paths));
    }
  }
  return opened;
}

describe('tidying the vault (#214)', () => {
  it('previews the exact moves and the notes it leaves, writing nothing', async () => {
    const vault = memoryVault(VAULT);
    const before = new Map(vault.files);

    const plan = await previewVaultTidy(vault.ports, TODAY);

    expect(plan.moves).toEqual(
      expect.arrayContaining([
        { from: 'Acme.md', to: 'Companies/Acme.md' },
        { from: 'Call Sam.md', to: 'Tasks/2026/10/Call Sam.md' },
        { from: '2026-09-30.md', to: 'Daily/2026/2026-09-30.md' },
        {
          from: 'Inbox/Meetings/2026-09-29 Larkspur sync.md',
          to: 'Meetings/2026/09/2026-09-29 Larkspur sync.md',
        },
      ]),
    );
    expect(plan.moves).toHaveLength(4);
    expect(plan.refused.map(({ path }) => path).sort()).toEqual([
      'Idea.md',
      'Inbox/Meetings/2026-10-13 Arriving.md',
    ]);
    expect(vault.files).toEqual(before);
    expect(vault.moves).toEqual([]);
  });

  it('moves them, keeping every link and relation opening the note it opened', async () => {
    const vault = memoryVault(VAULT);
    const opened = linkTargets(vault.files);
    const plan = await previewVaultTidy(vault.ports, TODAY);

    const done = await applyVaultTidy({ ports: vault.ports, shown: plan, today: TODAY });

    expect(done.failed).toEqual([]);
    expect(done.moved).toEqual(plan.moves);
    expect(vault.files.has('Companies/Acme.md')).toBe(true);
    expect(vault.files.has('Acme.md')).toBe(false);
    expect(vault.files.get('Idea.md')).toBe('Just a thought.\n');
    expect(vault.files.has('Inbox/Meetings/2026-10-13 Arriving.md')).toBe(true);
    // Each link opens the same note it did, now wherever that note lives.
    const moved = new Map<string, string>(plan.moves.map(({ from, to }) => [from, to]));
    for (const [link, note] of opened) {
      const [from, target] = link.split(' -> ') as [string, string];
      const now = linkTargets(vault.files);
      const key = `${moved.get(from) ?? from} -> `;
      const after = [...now].filter(([each]) => each.startsWith(key));
      const expected = note === null ? null : (moved.get(note) ?? note);
      expect(
        after.some(([, opens]) => opens === expected),
        `${link} (was ${note}, ${target})`,
      ).toBe(true);
    }
    // The relation was rewritten, since [[Acme]] alone now opens Clients/Acme.md.
    expect(vault.files.get('Projects/DFAI.md')).toContain('Companies/Acme');
    expect(done.linksUpdated).toBeGreaterThan(0);
  });

  it('moves nothing the second time', async () => {
    const vault = memoryVault(VAULT);
    await applyVaultTidy({
      ports: vault.ports,
      shown: await previewVaultTidy(vault.ports, TODAY),
      today: TODAY,
    });
    const after = new Map(vault.files);
    const moves = vault.moves.length;

    const again = await previewVaultTidy(vault.ports, TODAY);
    const done = await applyVaultTidy({ ports: vault.ports, shown: again, today: TODAY });

    expect(again.moves).toEqual([]);
    expect(done.moved).toEqual([]);
    expect(vault.moves).toHaveLength(moves);
    expect(vault.files).toEqual(after);
  });

  it('makes no move the preview did not show, and refuses one whose place was taken since', async () => {
    const vault = memoryVault(VAULT);
    const plan = await previewVaultTidy(vault.ports, TODAY);
    const shown = { ...plan, moves: plan.moves.filter(({ from }) => from !== 'Call Sam.md') };
    vault.files.set('Companies/Acme.md', '# Made since\n');

    const done = await applyVaultTidy({ ports: vault.ports, shown, today: TODAY });

    expect(vault.files.has('Call Sam.md')).toBe(true);
    expect(vault.files.get('Companies/Acme.md')).toBe('# Made since\n');
    expect(vault.files.has('Acme.md')).toBe(true);
    expect(done.moved.map(({ from }) => from)).not.toContain('Acme.md');
    expect(done.moved.map(({ from }) => from)).not.toContain('Call Sam.md');
  });
});
