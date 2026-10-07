import { describe, expect, it, vi } from 'vitest';
import {
  createVaultPath,
  parentVaultPath,
  vaultPathName,
  type ObjectType,
  type PropertyDef,
  type VaultEntry,
  type VaultPath,
} from '@atlas/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import {
  createTemplate,
  deleteTemplate,
  ensureTypeTemplate,
  loadTemplateCatalog,
  moveTemplateToNotes,
  renameTemplate,
  TemplateRefusedError,
} from './manage-templates.ts';
import { loadTemplates } from './templates.ts';

const property = (key: string): PropertyDef => ({
  key,
  kind: 'text',
  label: key,
  required: false,
  options: [],
  target: null,
  many: false,
});

const PERSON: ObjectType = {
  name: 'person',
  label: 'Person',
  properties: [property('role'), property('email')],
};
const BOOK: ObjectType = { name: 'book', label: 'Book', properties: [] };

/** A vault of files and folders in memory, which moves, trashes and creates as the host does. */
function memoryVault(files: Record<string, string>, folders: readonly string[] = []) {
  const notes = new Map(Object.entries(files));
  const dirs = new Set(folders);
  const trashed: string[] = [];
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
      if (notes.has(path)) throw new Error('exists');
      notes.set(path, contents);
    },
    moveEntry: async ({ from, to }) => {
      const text = notes.get(from);
      if (text === undefined || notes.has(to)) throw new Error('cannot move');
      notes.delete(from);
      notes.set(to, text);
    },
    trashEntry: async ({ path }) => {
      if (!notes.delete(path)) throw new Error('missing');
      trashed.push(path);
    },
  });
  return { fs, notes, trashed };
}

const editors = () => ({ flush: vi.fn(async () => {}), follow: vi.fn(), abandon: vi.fn() });
const path = (raw: string): VaultPath => createVaultPath(raw);

describe('the templates catalog', () => {
  it('lists each template with what uses it, and the types with none', async () => {
    const vault = memoryVault(
      { '.atlas/templates/Person.md': 'p', '.atlas/templates/Daily.md': 'd' },
      ['.atlas', '.atlas/templates'],
    );
    const catalog = await loadTemplateCatalog({ fs: vault.fs, types: [PERSON, BOOK] });
    expect(catalog.templates.map(({ name, uses }) => ({ name, uses }))).toEqual([
      { name: 'Daily', uses: [{ kind: 'daily' }] },
      { name: 'Person', uses: [{ kind: 'type', typeName: 'person', typeLabel: 'Person' }] },
    ]);
    expect(catalog.typesWithout).toEqual([BOOK]);
  });

  it('is empty, with every type wanting one, in a vault with no templates folder', async () => {
    const catalog = await loadTemplateCatalog({ fs: memoryVault({}).fs, types: [BOOK] });
    expect(catalog).toEqual({ templates: [], typesWithout: [BOOK] });
  });
});

describe('a type’s template, made when it has none', () => {
  it('answers the template the type already has, untouched', async () => {
    const vault = memoryVault({ '.atlas/templates/person.md': 'kept' }, [
      '.atlas',
      '.atlas/templates',
    ]);
    const made = await ensureTypeTemplate({ fs: vault.fs, markdown: fakeMarkdown(), type: PERSON });
    expect(made).toEqual({ path: '.atlas/templates/person.md', created: false });
    expect(vault.notes.get('.atlas/templates/person.md')).toBe('kept');
  });

  it('makes one named after the type, holding its type and empty properties', async () => {
    const vault = memoryVault({});
    const made = await ensureTypeTemplate({ fs: vault.fs, markdown: fakeMarkdown(), type: PERSON });
    expect(made).toEqual({ path: '.atlas/templates/Person.md', created: true });
    expect(vault.notes.get('.atlas/templates/Person.md')).toBe(
      '---\ntype: person\nrole:\nemail:\n---\n',
    );
  });
});

describe('creating a template', () => {
  it('writes a blank one when it is for no type', async () => {
    const vault = memoryVault({});
    const made = await createTemplate({
      fs: vault.fs,
      markdown: fakeMarkdown(),
      name: ' Meeting ',
      type: null,
      templates: [],
    });
    expect(made).toBe('.atlas/templates/Meeting.md');
    expect(vault.notes.get(made)).toBe('');
  });

  it('refuses a name another template has, writing nothing', async () => {
    const vault = memoryVault({ '.atlas/templates/Meeting.md': 'x' }, [
      '.atlas',
      '.atlas/templates',
    ]);
    const templates = await loadTemplates({ fs: vault.fs });
    await expect(
      createTemplate({
        fs: vault.fs,
        markdown: fakeMarkdown(),
        name: 'meeting',
        type: null,
        templates,
      }),
    ).rejects.toThrow(new TemplateRefusedError('There is already a template called “meeting”.'));
    expect([...vault.notes.keys()]).toEqual(['.atlas/templates/Meeting.md']);
  });
});

describe('renaming a template', () => {
  it('moves the file in its folder and the panes showing it follow, after saving their typing', async () => {
    const vault = memoryVault({ '.atlas/templates/Person.md': 'body' }, [
      '.atlas',
      '.atlas/templates',
    ]);
    const templates = await loadTemplates({ fs: vault.fs });
    const panes = editors();
    const to = await renameTemplate({
      fs: vault.fs,
      editors: panes,
      template: templates[0]!,
      name: 'Contact',
      templates,
    });
    expect(to).toBe('.atlas/templates/Contact.md');
    expect(vault.notes.get(to)).toBe('body');
    expect(panes.flush).toHaveBeenCalledWith(['.atlas/templates/Person.md']);
    expect(panes.follow).toHaveBeenCalledWith({ from: '.atlas/templates/Person.md', to });
  });

  it('does nothing when the name is the one it has', async () => {
    const vault = memoryVault({ '.atlas/templates/Person.md': 'body' }, [
      '.atlas',
      '.atlas/templates',
    ]);
    const templates = await loadTemplates({ fs: vault.fs });
    const panes = editors();
    await renameTemplate({
      fs: vault.fs,
      editors: panes,
      template: templates[0]!,
      name: 'Person',
      templates,
    });
    expect(panes.flush).not.toHaveBeenCalled();
  });

  it('refuses a clash, and anything that is not a template', async () => {
    const vault = memoryVault(
      { '.atlas/templates/Person.md': 'p', '.atlas/templates/Task.md': 't' },
      ['.atlas', '.atlas/templates'],
    );
    const templates = await loadTemplates({ fs: vault.fs });
    await expect(
      renameTemplate({
        fs: vault.fs,
        editors: editors(),
        template: templates[0]!,
        name: 'TASK',
        templates,
      }),
    ).rejects.toThrow(TemplateRefusedError);
    const note = { name: 'Ada', path: path('People/Ada.md') };
    await expect(
      renameTemplate({ fs: vault.fs, editors: editors(), template: note, name: 'Bea', templates }),
    ).rejects.toThrow('That is not a template.');
    expect([...vault.notes.keys()].sort()).toEqual([
      '.atlas/templates/Person.md',
      '.atlas/templates/Task.md',
    ]);
  });
});

describe('renaming a template kept off the top of the folder', () => {
  it('keeps it in its subfolder, clashing only with what is beside it', async () => {
    const vault = memoryVault(
      { '.atlas/templates/Meetings/Standup.md': 's', '.atlas/templates/Daily.md': 'd' },
      ['.atlas', '.atlas/templates', '.atlas/templates/Meetings'],
    );
    const templates = await loadTemplates({ fs: vault.fs });
    const standup = templates.find((template) => template.name === 'Standup')!;
    const to = await renameTemplate({
      fs: vault.fs,
      editors: editors(),
      template: standup,
      name: 'Daily',
      templates,
    });
    expect(to).toBe('.atlas/templates/Meetings/Daily.md');
    expect(vault.notes.get(to)).toBe('s');
  });

  it('keeps the .markdown extension it was saved with', async () => {
    const vault = memoryVault({ '.atlas/templates/Person.markdown': 'p' }, [
      '.atlas',
      '.atlas/templates',
    ]);
    const templates = await loadTemplates({ fs: vault.fs });
    const to = await renameTemplate({
      fs: vault.fs,
      editors: editors(),
      template: templates[0]!,
      name: 'Contact',
      templates,
    });
    expect(to).toBe('.atlas/templates/Contact.markdown');
  });

  it('refuses a name a template beside it has under the other extension', async () => {
    const vault = memoryVault(
      { '.atlas/templates/Person.markdown': 'p', '.atlas/templates/Task.md': 't' },
      ['.atlas', '.atlas/templates'],
    );
    const templates = await loadTemplates({ fs: vault.fs });
    const task = templates.find((template) => template.name === 'Task')!;
    await expect(
      renameTemplate({
        fs: vault.fs,
        editors: editors(),
        template: task,
        name: 'person',
        templates,
      }),
    ).rejects.toThrow(TemplateRefusedError);
  });
});

describe('moving a template to the notes', () => {
  it('puts it at the top of the vault, its bytes untouched, and the panes follow', async () => {
    const text = '---\ntype: company\nindustry: Payroll\n---\nOur biggest client.\n';
    const vault = memoryVault({ '.atlas/templates/Larkspur Payroll.md': text }, [
      '.atlas',
      '.atlas/templates',
    ]);
    const panes = editors();
    const from = path('.atlas/templates/Larkspur Payroll.md');
    const to = await moveTemplateToNotes({ fs: vault.fs, editors: panes, path: from });
    expect(to).toBe('Larkspur Payroll.md');
    expect(vault.notes.get(to)).toBe(text);
    expect(vault.notes.has(from)).toBe(false);
    expect(panes.flush).toHaveBeenCalledWith([from]);
    expect(panes.follow).toHaveBeenCalledWith({ from, to });
  });

  it('numbers it when a note of that name is already there, in any case', async () => {
    const vault = memoryVault(
      { '.atlas/templates/Acme.markdown': 'template', 'ACME.markdown': 'note' },
      ['.atlas', '.atlas/templates'],
    );
    const to = await moveTemplateToNotes({
      fs: vault.fs,
      editors: editors(),
      path: path('.atlas/templates/Acme.markdown'),
    });
    expect(to).toBe('Acme 2.markdown');
    expect(vault.notes.get('ACME.markdown')).toBe('note');
  });

  it('refuses a note that is not a template, moving nothing', async () => {
    const vault = memoryVault({ 'People/Ada.md': 'a' }, ['People']);
    await expect(
      moveTemplateToNotes({ fs: vault.fs, editors: editors(), path: path('People/Ada.md') }),
    ).rejects.toThrow(TemplateRefusedError);
    expect([...vault.notes.keys()]).toEqual(['People/Ada.md']);
  });
});

describe('deleting a template', () => {
  it('puts it in the Trash and lets go of any unsaved typing in it', async () => {
    const vault = memoryVault({ '.atlas/templates/Person.md': 'p' }, [
      '.atlas',
      '.atlas/templates',
    ]);
    const panes = editors();
    await deleteTemplate({
      fs: vault.fs,
      editors: panes,
      path: path('.atlas/templates/Person.md'),
    });
    expect(vault.trashed).toEqual(['.atlas/templates/Person.md']);
    expect(panes.abandon).toHaveBeenCalledWith(['.atlas/templates/Person.md']);
  });

  it('refuses a note that is not a template, trashing nothing', async () => {
    const vault = memoryVault({ 'People/Ada.md': 'a' }, ['People']);
    await expect(
      deleteTemplate({ fs: vault.fs, editors: editors(), path: path('People/Ada.md') }),
    ).rejects.toThrow(TemplateRefusedError);
    expect(vault.trashed).toEqual([]);
  });

  it('passes on a refusal from the disk, leaving the panes alone', async () => {
    const vault = memoryVault({}, ['.atlas', '.atlas/templates']);
    const panes = editors();
    await expect(
      deleteTemplate({ fs: vault.fs, editors: panes, path: path('.atlas/templates/Gone.md') }),
    ).rejects.toThrow('missing');
    expect(panes.abandon).not.toHaveBeenCalled();
  });
});
