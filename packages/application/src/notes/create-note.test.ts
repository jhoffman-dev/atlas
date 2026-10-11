import { describe, expect, it, vi } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { CREATE_ATTEMPTS, createNote, NoteNameTakenError } from './create-note.ts';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { TaskRuleRefusedError } from '../gtd/task-rules.ts';

function fakeFs() {
  const created: { path: string; contents: string }[] = [];
  const fs = fakeVaultFs({
    createNote: async ({ path, contents }) => {
      created.push({ path, contents });
    },
  });
  return { fs, created };
}

const notes = (...paths: string[]) => paths.map(createVaultPath);

describe('createNote', () => {
  it('creates the note at the vault root when nothing is open', async () => {
    const { fs, created } = fakeFs();
    const path = await createNote({
      markdown: fakeMarkdown(),
      today: '2026-10-08',
      fs,
      name: 'Untitled',
      beside: null,
      notePaths: [],
    });

    expect(path).toBe('Untitled.md');
    expect(created[0]?.path).toBe('Untitled.md');
  });

  it('creates it beside the note in view', async () => {
    const { fs, created } = fakeFs();
    const path = await createNote({
      markdown: fakeMarkdown(),
      today: '2026-10-08',
      fs,
      name: 'Untitled',
      beside: createVaultPath('Notes/today.md'),
      notePaths: [],
    });

    expect(path).toBe('Notes/Untitled.md');
    expect(created[0]?.path).toBe('Notes/Untitled.md');
  });

  // Made from the Dashboard template while a view was open, a dashboard landed
  // among the views, where nothing that reads views could read it.
  it('puts a note made from the Dashboard template with the dashboards', async () => {
    const { fs, created } = fakeFs();
    const path = await createNote({
      markdown: fakeMarkdown(),
      today: '2026-10-08',
      fs,
      name: 'New Dashboard',
      beside: createVaultPath('.atlas/views/Board.md'),
      notePaths: [],
      contents: '---\natlas: dashboard\nwidgets: []\n---\n',
      properties: { atlas: 'dashboard', widgets: [] },
    });

    expect(path).toBe('.atlas/dashboards/New Dashboard.md');
    expect(created[0]?.path).toBe('.atlas/dashboards/New Dashboard.md');
  });

  it('numbers the name rather than failing when it is taken', async () => {
    const { fs } = fakeFs();
    const path = await createNote({
      markdown: fakeMarkdown(),
      today: '2026-10-08',
      fs,
      name: 'Untitled',
      beside: null,
      notePaths: notes('Untitled.md', 'Untitled 2.md'),
    });

    expect(path).toBe('Untitled 3.md');
  });

  it('starts the note empty: its name is its filename, not a heading (U-09)', async () => {
    const { fs, created } = fakeFs();
    await createNote({
      markdown: fakeMarkdown(),
      today: '2026-10-08',
      fs,
      name: 'Weekly review',
      beside: null,
      notePaths: [],
    });

    expect(created[0]?.contents).toBe('');
  });

  it('cleans up a name that would not make a filename', async () => {
    const { fs, created } = fakeFs();
    const path = await createNote({
      markdown: fakeMarkdown(),
      today: '2026-10-08',
      fs,
      name: 'Notes/today',
      beside: null,
      notePaths: [],
    });

    expect(path).toBe('Notes today.md');
    expect(created[0]?.contents).toBe('');
  });

  it('propagates a refusal from the host', async () => {
    const { fs } = fakeFs();
    const createSpy = vi
      .spyOn(fs, 'createNote')
      .mockRejectedValue(new Error('a note with that name already exists'));

    await expect(
      createNote({
        markdown: fakeMarkdown(),
        today: '2026-10-08',
        fs,
        name: 'Untitled',
        beside: null,
        notePaths: [],
      }),
    ).rejects.toThrow('already exists');
    expect(createSpy).toHaveBeenCalledOnce();
  });

  it('numbers again when the name was taken between the listing and the create', async () => {
    const attempts: string[] = [];
    const fs = fakeVaultFs({
      listNotes: async () => [listing('Untitled.md')],
      createNote: async ({ path }) => {
        attempts.push(path);
        if (path === 'Untitled.md') throw new Error('a note with that name already exists');
      },
    });

    const path = await createNote({
      markdown: fakeMarkdown(),
      today: '2026-10-08',
      fs,
      name: 'Untitled',
      beside: null,
      notePaths: [],
    });

    expect(path).toBe('Untitled 2.md');
    expect(attempts).toEqual(['Untitled.md', 'Untitled 2.md']);
  });

  it('keeps numbering past names taken by notes made at the same moment, as five "+ New" at once are', async () => {
    const made = new Set<string>();
    const fs = fakeVaultFs({
      listNotes: async () => [...made].map(listing),
      createNote: async ({ path }) => {
        if (made.has(path)) throw new Error('a note with that name already exists');
        made.add(path);
      },
    });

    const paths = await Promise.all(
      [1, 2, 3, 4, 5].map(() =>
        createNote({
          markdown: fakeMarkdown(),
          today: '2026-10-08',
          fs,
          name: 'Untitled',
          beside: null,
          notePaths: [],
        }),
      ),
    );

    expect(new Set(paths).size).toBe(5);
  });

  it('gives up when every name it tries is taken meanwhile', async () => {
    const attempts: string[] = [];
    const fs = fakeVaultFs({
      listNotes: async () => attempts.map(listing),
      createNote: async ({ path }) => {
        attempts.push(path);
        throw new Error('a note with that name already exists');
      },
    });

    // Bounded, and said as a name it could not find rather than the host's bare refusal.
    await expect(
      createNote({
        markdown: fakeMarkdown(),
        today: '2026-10-08',
        fs,
        name: 'Untitled',
        beside: null,
        notePaths: [],
      }),
    ).rejects.toBeInstanceOf(NoteNameTakenError);
    expect(attempts).toHaveLength(CREATE_ATTEMPTS);
    expect(new Set(attempts).size).toBe(CREATE_ATTEMPTS);
  });
});

function listing(path: string) {
  return {
    name: path.split('/').at(-1) ?? path,
    path: createVaultPath(path),
    modified: 1,
    size: 1,
  };
}

describe('createNote never writes a template from a note flow (issue #15)', () => {
  it('refuses a note in the templates folder, writing nothing', async () => {
    const { fs, created } = fakeFs();
    await expect(
      createNote({
        markdown: fakeMarkdown(),
        today: '2026-10-08',
        fs,
        name: 'Larkspur Payroll',
        beside: null,
        folder: createVaultPath('.atlas/templates'),
        notePaths: [],
      }),
    ).rejects.toThrow(/template/i);
    expect(created).toEqual([]);
  });
});

/** P30-02: every new note is held to the task rules, whichever path made it (ADR-0029). */
describe('a new task', () => {
  const make = (contents: string) => {
    const { fs, created } = fakeFs();
    const made = createNote({
      fs,
      markdown: fakeMarkdown(),
      today: '2026-10-08',
      name: 'Hear back',
      beside: null,
      notePaths: [],
      contents,
    });
    return { made, created };
  };

  it('is refused, making no file, when it is Waiting with nobody to wait on', async () => {
    const { made, created } = make('---\ntype: task\nstatus: waiting\n---\n\n# x\n');
    await expect(made).rejects.toBeInstanceOf(TaskRuleRefusedError);
    expect(created).toEqual([]);
  });

  it('is dated today when it is made already in Archive', async () => {
    const { made, created } = make('---\ntype: task\nstatus: archive\n---\n\n# x\n');
    await made;
    expect(created[0]?.contents).toBe(
      '---\ntype: task\nstatus: archive\ncompleted: 2026-10-08\n---\n\n# x\n',
    );
  });

  it('is made as it is otherwise, and so is any note that is not a task', async () => {
    for (const contents of [
      '---\ntype: task\nstatus: waiting\nwaiting_on: x\n---\n',
      '---\ntype: project\nstatus: archive\n---\n',
      '# plain\n',
    ]) {
      const { made, created } = make(contents);
      await made;
      expect(created[0]?.contents).toBe(contents);
    }
  });
});
