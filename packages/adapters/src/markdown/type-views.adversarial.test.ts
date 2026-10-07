import { describe, expect, it } from 'vitest';
import {
  duplicateTypeView,
  fakeVaultFs,
  moveTypeView,
  renameTypeView,
  setNoteProperties,
  type TypeViewPorts,
} from '@atlas/application';
import {
  savedViewSummary,
  splitFrontmatter,
  type SavedViewSummary,
  type VaultPath,
} from '@atlas/domain';
import { remarkMarkdown } from './markdown-port.ts';

/**
 * Adversarial pass on issue #11 (ADR-0023), through the real markdown adapter:
 * the tabs' writes — a copy, a rename, a move — on view notes written by hand.
 * ADR-0003: a save keeps every byte it did not mean to change.
 */

function vaultWith(files: Record<string, string>) {
  let modified = 1;
  const fs = fakeVaultFs({
    readTextFile: async (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return { text, modified };
    },
    writeTextFile: async ({ path, contents }) => {
      files[path] = contents;
      modified += 1;
      return modified;
    },
    createNote: async ({ path, contents }) => {
      if (files[path] !== undefined) throw new Error(`already exists: ${path}`);
      files[path] = contents;
    },
  });
  const ports: TypeViewPorts = {
    fs,
    markdown: remarkMarkdown,
    writeProperties: ({ path, values }) =>
      setNoteProperties({ fs, markdown: remarkMarkdown, path, values }),
  };
  const summaryOf = (path: string): SavedViewSummary => {
    const frontmatter = remarkMarkdown.frontmatterProperties(
      splitFrontmatter(files[path] ?? '').frontmatter,
    );
    const summary = savedViewSummary(path as VaultPath, frontmatter);
    if (summary === null) throw new Error(`not a view: ${path}`);
    return summary;
  };
  const known = () => {
    const views = Object.keys(files).map(summaryOf);
    return { views, takenPaths: views.map((view) => view.path) };
  };
  return { files, ports, summaryOf, known };
}

const BOARD = '.atlas/views/Board.md';

async function copyOf(text: string): Promise<string> {
  const vault = vaultWith({ [BOARD]: text });
  const path = await duplicateTypeView({
    ports: vault.ports,
    source: vault.summaryOf(BOARD),
    ...vault.known(),
  });
  return vault.files[path] ?? '';
}

describe('duplicating a view written by hand', () => {
  const head = [
    '---',
    'atlas: view',
    'type: task',
    'layout: board',
    '# grouped by status so the standup reads left to right',
    'groupBy: status',
    '---',
  ];

  it('keeps the comments in its settings', async () => {
    const copy = await copyOf(`${head.join('\n')}\n# Board\n`);
    expect(copy).toContain('# grouped by status so the standup reads left to right');
  });

  it('keeps what is written under its settings', async () => {
    const copy = await copyOf(
      `${head.join('\n')}\n# Board\n\nWhat this board is for: the Monday standup.\n`,
    );
    expect(copy).toContain('What this board is for: the Monday standup.');
  });

  it('keeps the line endings it was written with', async () => {
    const copy = await copyOf(`${head.join('\r\n')}\r\n# Board\r\n`);
    expect(copy).toContain('\r\n');
    expect(copy.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it('keeps a flow-style setting written on one line', async () => {
    const copy = await copyOf(
      [
        '---',
        'atlas: view',
        'type: task',
        'filters: [{key: status, operator: isNot, value: done}]',
        '---',
        '# Board',
        '',
      ].join('\n'),
    );
    expect(copy).toContain('filters: [{key: status, operator: isNot, value: done}]');
  });
});

describe('renaming a tab to words YAML reads as something else', () => {
  // A rename writes `title:`; what the tab then shows is the title read back.
  for (const name of ['null', 'true', '123', '~', 'no', '#1 priority', 'a: b', '- dash', '[x]']) {
    it(`reads back “${name}” as written`, async () => {
      const vault = vaultWith({ [BOARD]: '---\natlas: view\ntype: task\n---\n# Board\n' });
      await renameTypeView({ ports: vault.ports, path: BOARD as VaultPath, name });
      expect(vault.summaryOf(BOARD).title).toBe(name);
    });
  }
});

describe('moving a tab written with a byte-order mark and CRLF', () => {
  it('keeps every byte but its new order', async () => {
    const text = '﻿---\r\natlas: view\r\ntype: task\r\n# keep me\r\n---\r\n# Board\r\n';
    const vault = vaultWith({
      [BOARD]: text,
      '.atlas/views/Alpha.md': '---\natlas: view\ntype: task\nlayout: list\n---\n# Alpha\n',
    });
    // Unplaced, a board reads before a list; move it after.
    await moveTypeView({
      ports: vault.ports,
      ...vault.known(),
      typeName: 'task',
      path: BOARD,
      to: 1,
    });
    const written = vault.files[BOARD] ?? '';
    expect(written.startsWith('﻿---\r\n')).toBe(true);
    expect(written).toContain('# keep me\r\n');
    expect(written.replace(/order: \d+\r\n/, '')).toBe(text);
  });
});
