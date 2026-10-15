import { describe, expect, it } from 'vitest';
import { createVaultPath, PROJECT_TYPE_FILE, type PropertyDef } from '@atlas/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { quickAddNote } from './quick-add-note.ts';

function recordingFs() {
  const created: { path: string; contents: string }[] = [];
  const fs = fakeVaultFs({
    createNote: async ({ path, contents }) => {
      created.push({ path, contents });
    },
  });
  return { fs, created };
}

const TASK_TEMPLATE = '---\ntype: task\nstatus: backlog\n---\n\nSteps:\n';
const acme = createVaultPath('Clients/Acme.md');

const field = (key: string, kind: PropertyDef['kind']): PropertyDef => ({
  key,
  kind,
  label: key,
  required: false,
  options: [],
  target: kind === 'relation' ? 'project' : null,
  many: false,
});
const TASK = {
  name: 'task',
  properties: [field('status', 'select'), field('due', 'date'), field('project', 'relation')],
};
const PROJECT = { name: 'project', properties: [] };

describe('quickAddNote', () => {
  it('makes a task from its template, with the fields filled in, in its home folder whatever is in view', async () => {
    const { fs, created } = recordingFs();
    const path = await quickAddNote({
      today: '2026-10-08',
      fs,
      markdown: fakeMarkdown(),
      type: TASK,
      name: 'Renew the passport',
      values: { status: 'doing', due: '2026-10-01', project: '' },
      template: TASK_TEMPLATE,
      beside: acme,
      notePaths: [],
    });

    expect(path).toBe('Tasks/2026/10/Renew the passport.md');
    const contents = created[0]?.contents ?? '';
    expect(contents).toContain('type: task');
    expect(contents).toContain('status: doing');
    expect(contents).toContain('due: 2026-10-01');
    expect(contents).not.toContain('project');
    // The template's body comes along.
    expect(contents).toContain('Steps:');
  });

  it('makes a note of a type with no template, saying what type it is', async () => {
    const { fs, created } = recordingFs();
    await quickAddNote({
      today: '2026-10-08',
      fs,
      markdown: fakeMarkdown(),
      type: PROJECT,
      name: 'Garden',
      values: {},
      template: null,
      beside: acme,
      notePaths: [],
    });

    // A project goes to its type's home folder (#214), whatever is in view.
    expect(created[0]?.path).toBe('Projects/Garden.md');
    expect(created[0]?.contents).toContain('type: project');
  });

  it('numbers a name that is taken rather than refusing', async () => {
    const { fs, created } = recordingFs();
    await quickAddNote({
      today: '2026-10-08',
      fs,
      markdown: fakeMarkdown(),
      type: PROJECT,
      name: 'Garden',
      values: {},
      template: null,
      beside: null,
      notePaths: [createVaultPath('Projects/Garden.md')],
    });
    expect(created[0]?.path).not.toBe('Projects/Garden.md');
    expect(created[0]?.path).toMatch(/^Projects\/Garden.*\.md$/);
  });

  it('passes on a create the host refuses', async () => {
    const fs = fakeVaultFs({ createNote: () => Promise.reject(new Error('disk full')) });
    await expect(
      quickAddNote({
        today: '2026-10-08',
        fs,
        markdown: fakeMarkdown(),
        type: TASK,
        name: 'X',
        values: {},
        template: null,
        beside: null,
        notePaths: [],
      }),
    ).rejects.toThrow('disk full');
  });
});

/** #213: a new Project starts as a project, unless its template or its fields say otherwise. */
describe('quickAddNote, of a Project with PARA', () => {
  async function made({
    values = {},
    template = null,
  }: {
    values?: Record<string, string>;
    template?: string | null;
  }) {
    const { fs, created } = recordingFs();
    await quickAddNote({
      today: '2026-10-08',
      fs,
      markdown: fakeMarkdown(),
      type: PROJECT_TYPE_FILE.type,
      name: 'Garden',
      values,
      template,
      beside: null,
      notePaths: [],
    });
    return created[0]?.contents ?? '';
  }

  it('shows PARA = Project on a new project', async () => {
    expect(await made({})).toContain('para: project');
  });

  it('keeps the PARA the fields give it: New area… makes an area', async () => {
    const contents = await made({ values: { para: 'area' } });
    expect(contents).toContain('para: area');
    expect(contents).not.toContain('para: project');
  });

  it('keeps the PARA its template says', async () => {
    const contents = await made({ template: '---\ntype: project\npara: resource\n---\n\n' });
    expect(contents).toContain('para: resource');
    expect(contents).not.toContain('para: project');
  });

  it('gives no PARA to a Project type that does not declare it', async () => {
    const { fs, created } = recordingFs();
    await quickAddNote({
      today: '2026-10-08',
      fs,
      markdown: fakeMarkdown(),
      type: PROJECT,
      name: 'Garden',
      values: {},
      template: null,
      beside: null,
      notePaths: [],
    });
    expect(created[0]?.contents).not.toContain('para');
  });
});
