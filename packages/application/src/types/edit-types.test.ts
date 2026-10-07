import { describe, expect, it } from 'vitest';
import { parseObjectType, TypeEditError, type VaultPath } from '@atlas/domain';
import { NoteChangedError } from '../notes/note-changed-error.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { addTypeProperty, createObjectType, saveObjectType } from './edit-types.ts';

const TASK = parseObjectType({ name: 'task', label: 'Task' });

describe('createObjectType', () => {
  it('writes .atlas/types/<name>.md with its name, label and icon, and a heading', async () => {
    const created: { path: VaultPath; contents: string }[] = [];
    const fs = fakeVaultFs({ createNote: async (args) => void created.push(args) });

    const type = await createObjectType({
      fs,
      markdown: fakeMarkdown(),
      label: 'Book club',
      icon: 'grid',
      existing: [TASK],
    });

    expect(type).toMatchObject({ name: 'book_club', label: 'Book club', icon: 'grid' });
    expect(type.path).toBe('.atlas/types/book_club.md');
    expect(created).toHaveLength(1);
    expect(created[0]?.path).toBe('.atlas/types/book_club.md');
    expect(created[0]?.contents).toContain('name: book_club');
    expect(created[0]?.contents).toContain('label: Book club');
    expect(created[0]?.contents).toContain('icon: grid');
    expect(created[0]?.contents).toMatch(/\n# Book club\n$/);
  });

  it('refuses a name the vault already has before writing anything', async () => {
    let writes = 0;
    const fs = fakeVaultFs({ createNote: async () => void (writes += 1) });
    await expect(
      createObjectType({ fs, markdown: fakeMarkdown(), label: 'Task', existing: [TASK] }),
    ).rejects.toThrow(TypeEditError);
    expect(writes).toBe(0);
  });

  it('passes on the host refusing to write over a file', async () => {
    const fs = fakeVaultFs({
      createNote: async () => {
        throw new Error('a note with that name already exists');
      },
    });
    await expect(
      createObjectType({ fs, markdown: fakeMarkdown(), label: 'Book', existing: [] }),
    ).rejects.toThrow(/already exists/);
  });
});

describe('saveObjectType', () => {
  const FILE = [
    '---',
    'name: task',
    'label: Task',
    'owner: james',
    '---',
    '',
    '# Task',
    '',
    'Prose.',
    '',
  ].join('\n');

  function vault() {
    const writes: { contents: string; expectedModified: number | null }[] = [];
    const fs = fakeVaultFs({
      readTextFile: async () => ({ text: FILE, modified: 5 }),
      writeTextFile: async ({ contents, expectedModified }) => {
        writes.push({ contents, expectedModified });
        return 6;
      },
    });
    return { fs, writes };
  }

  it('rewrites the label and keeps the name, other keys and the body', async () => {
    const { fs, writes } = vault();
    await saveObjectType({
      fs,
      markdown: fakeMarkdown(),
      path: '.atlas/types/task.md' as VaultPath,
      before: TASK,
      type: { ...TASK, label: 'Chore' },
    });
    expect(writes).toHaveLength(1);
    const written = writes[0]?.contents ?? '';
    expect(written).toContain('label: Chore');
    expect(written).toContain('name: task');
    expect(written).toContain('owner: james');
    expect(written.endsWith('\n# Task\n\nProse.\n')).toBe(true);
    // Against the time it was read at, so a change made elsewhere is not overwritten.
    expect(writes[0]?.expectedModified).toBe(5);
  });

  it('refuses when the file changed since the editor read it', async () => {
    const { fs, writes } = vault();
    await expect(
      saveObjectType({
        fs,
        markdown: fakeMarkdown(),
        path: '.atlas/types/task.md' as VaultPath,
        before: TASK,
        type: TASK,
        ifModified: 4,
      }),
    ).rejects.toThrow(NoteChangedError);
    expect(writes).toHaveLength(0);
  });
});

describe('addTypeProperty', () => {
  const BOOK = {
    ...parseObjectType({ name: 'book', label: 'Book', properties: { author: 'text' } }),
  };
  const FILE = '---\nname: book\nlabel: Book\n---\n\n# Book\n';

  /** The frontmatter changes written, which the real markdown adapter's tests turn into YAML. */
  function vault() {
    const writes: Record<string, unknown>[] = [];
    const base = fakeMarkdown();
    const markdown: MarkdownPort = {
      ...base,
      updateFrontmatter: (frontmatter, changes) => {
        writes.push(changes);
        return base.updateFrontmatter(frontmatter, changes);
      },
    };
    const fs = fakeVaultFs({
      readTextFile: async () => ({ text: FILE, modified: 5 }),
      writeTextFile: async () => 6,
    });
    return { fs, markdown, writes };
  }
  const path = '.atlas/types/book.md' as VaultPath;

  it('writes the property into the type file under a key made from its name', async () => {
    const { fs, markdown, writes } = vault();
    const added = await addTypeProperty({
      fs,
      markdown,
      type: { ...BOOK, path },
      types: ['book'],
      property: { label: 'Pages', kind: 'number' },
    });
    expect(added).toMatchObject({ key: 'pages', kind: 'number', label: 'Pages' });
    expect(writes).toHaveLength(1);
    // Only the new property: the rest of the file is left as it was.
    expect(writes[0]).toEqual({ properties: { author: undefined, pages: 'number' } });
  });

  it('points a relation where it was told, holding several notes when asked', async () => {
    const { fs, markdown, writes } = vault();
    const added = await addTypeProperty({
      fs,
      markdown,
      type: { ...BOOK, path },
      types: ['book', 'task'],
      property: { label: 'Tasks', kind: 'relation', target: 'task', many: true },
    });
    expect(added).toMatchObject({ key: 'tasks', target: 'task', many: true });
    expect(writes[0]).toMatchObject({
      properties: { tasks: { kind: 'relation', target: 'task', many: true } },
    });
  });

  it('points a relation at the type itself, holding one note, when told nothing else', async () => {
    const { fs, markdown } = vault();
    const added = await addTypeProperty({
      fs,
      markdown,
      type: { ...BOOK, path },
      types: ['book'],
      property: { label: 'Sequel', kind: 'relation' },
    });
    expect(added).toMatchObject({ key: 'sequel', target: 'book', many: false });
  });

  it('refuses a relation to a type the vault does not have, writing nothing', async () => {
    const { fs, markdown, writes } = vault();
    await expect(
      addTypeProperty({
        fs,
        markdown,
        type: { ...BOOK, path },
        types: ['book'],
        property: { label: 'Tasks', kind: 'relation', target: 'task', many: true },
      }),
    ).rejects.toThrow(TypeEditError);
    expect(writes).toHaveLength(0);
  });
});
