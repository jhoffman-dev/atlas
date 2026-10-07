import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  isTemplateFor,
  isVisibleEntry,
  parentVaultPath,
  vaultPathName,
  type ObjectType,
  type VaultEntry,
} from '@atlas/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { ensureTypeTemplate, loadTemplateCatalog } from './manage-templates.ts';
import { loadTemplates, templateNoteName } from './templates.ts';

/**
 * Adversarial probes of issue #16 (ADR-0026): the Templates page and "Edit
 * template" from a type. Each test names the invariant it holds the code to.
 */

/** A vault in memory whose writes behave as the host's: a create never overwrites. */
function memoryVault(files: Record<string, string>, folders: readonly string[] = []) {
  const notes = new Map(Object.entries(files));
  const dirs = new Set(folders);
  const childrenOf = (folder: string): VaultEntry[] => [
    ...[...dirs]
      .filter((dir) => parentVaultPath(createVaultPath(dir)) === folder)
      .map((dir) => ({
        kind: 'directory' as const,
        name: vaultPathName(createVaultPath(dir)),
        path: createVaultPath(dir),
      })),
    ...[...notes.keys()]
      .filter((path) => parentVaultPath(createVaultPath(path)) === folder)
      .map((path) => ({
        kind: 'file' as const,
        name: vaultPathName(createVaultPath(path)),
        path: createVaultPath(path),
      })),
  ];
  const fs = fakeVaultFs({
    listDirectory: async (path) => {
      if (path !== '' && !dirs.has(path)) throw new Error(`No folder ${path}`);
      return childrenOf(path);
    },
    readTextFile: async (path) => {
      const text = notes.get(path);
      if (text === undefined) throw new Error(`No note ${path}`);
      return { text, modified: 1 };
    },
    createFolder: async ({ path }) => {
      dirs.add(path);
    },
    createNote: async ({ path, contents }) => {
      // The host's create_new: a second create of the same path is refused.
      if (notes.has(path)) throw new Error('a note with that name already exists');
      notes.set(path, contents);
    },
  });
  return { fs, notes };
}

const typeLabelled = (label: string, name: string): ObjectType => ({
  name,
  label,
  properties: [],
});

describe('Edit template works for every type the vault can hold', () => {
  // A type's label is free text (setTypeLabel only refuses blank), while a
  // template's name may not hold / \ : * ? " < > | or start with a dot. The
  // type's name is always an identifier, so it is always a usable fallback.
  it.each([
    { what: 'Q&A / Notes', label: 'Q&A / Notes', name: 'q_a_notes' },
    { what: 'Meeting: 1:1', label: 'Meeting: 1:1', name: 'meeting_1_1' },
    { what: 'Who? What?', label: 'Who? What?', name: 'who_what' },
    { what: '.NET project', label: '.NET project', name: 'net_project' },
    { what: '300 x’s', label: 'x'.repeat(300), name: 'long_type' },
  ])(
    'makes a template for a type labelled $what that then serves the type',
    async ({ label, name }) => {
      const vault = memoryVault({});
      const type = typeLabelled(label, name);
      const made = await ensureTypeTemplate({ fs: vault.fs, markdown: fakeMarkdown(), type });
      expect(made.created).toBe(true);
      const listed = await loadTemplates({ fs: vault.fs });
      expect(listed.some((template) => isTemplateFor(template.name, type))).toBe(true);
    },
  );
});

describe('Edit template pressed twice before the first finishes', () => {
  it('lands both presses on the one template rather than failing the second', async () => {
    const vault = memoryVault({});
    const type = typeLabelled('Person', 'person');
    const ensure = () => ensureTypeTemplate({ fs: vault.fs, markdown: fakeMarkdown(), type });
    const results = await Promise.allSettled([ensure(), ensure()]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect([...vault.notes.keys()]).toEqual(['.atlas/templates/Person.md']);
  });
});

describe('every file in the templates folder can still be reached', () => {
  // ADR-0026 hides all of `.atlas/templates` from the tree, links and search;
  // ADR-0013: "a note you can reach and did not expect beats a note you cannot
  // reach at all". Whatever the tree no longer shows, the Templates page must.
  const reachable = async (path: string, vault: ReturnType<typeof memoryVault>) => {
    const inTree = isVisibleEntry({ kind: 'file', name: '', path: createVaultPath(path) });
    const catalog = await loadTemplateCatalog({ fs: vault.fs, types: [] });
    const onPage = catalog.templates.some((template) => template.path === path);
    return inTree || onPage;
  };

  it('reaches a template kept in a subfolder of the templates folder', async () => {
    const path = '.atlas/templates/Meetings/Standup.md';
    const vault = memoryVault({ [path]: '# Standup\n' }, [
      '.atlas',
      '.atlas/templates',
      '.atlas/templates/Meetings',
    ]);
    expect(await reachable(path, vault)).toBe(true);
  });

  it('reaches a template saved with the .markdown extension', async () => {
    const path = '.atlas/templates/Person.markdown';
    const vault = memoryVault({ [path]: '---\ntype: person\n---\n' }, [
      '.atlas',
      '.atlas/templates',
    ]);
    expect(await reachable(path, vault)).toBe(true);
  });
});

describe('a note made from the longest name a template may have', () => {
  it('has a file name a disk can hold (255 bytes)', () => {
    // templateNameProblem accepts any name whose `<name>.md` fits in 255 bytes.
    const name = 'x'.repeat(252);
    const template = { path: createVaultPath(`.atlas/templates/${name}.md`), name };
    const fileName = `${templateNoteName(template)}.md`;
    expect(new TextEncoder().encode(fileName).length).toBeLessThanOrEqual(255);
  });
});
