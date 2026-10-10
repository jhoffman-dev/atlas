/**
 * P30-03 (adversarial): checklists, through the real markdown reader and
 * writer — the boxes the index counts against the boxes the editor draws,
 * and promoting a line: what a retry does, what the line's own words and
 * links become, and the name a long line's task is given on disk.
 */
import { describe, expect, it } from 'vitest';
import {
  checklistLines,
  checklistProgress,
  createVaultPath,
  TASK_TYPE_FILE,
  utf8Bytes,
  MAX_NAME_BYTES,
} from '@atlas/domain';
import {
  apiFixture,
  bodyOf,
  encoded,
  fakeVaultFs,
  promoteChecklistLine,
  toIndexedNote,
  type PromotionPanes,
} from '@atlas/application';
import { remarkMarkdown } from './markdown-port.ts';

describe('the index counts the boxes the editor draws', () => {
  // Each body holds a box the parser (and so the editor) reads; the index must agree.
  const bodies: Record<string, string> = {
    'a list nested on its parent item’s line': '- - [ ] Order chairs\n',
    'a box under a numbered item on the same line': '1. - [x] Book the hall\n',
    'an item whose words start on the next line': '-\n  [ ] Ring Mara Quill\n',
  };

  for (const [name, body] of Object.entries(bodies)) {
    it(`holds the progress the editor's boxes give, for ${name}`, () => {
      const drawn = checklistProgress(checklistLines(remarkMarkdown.parseBody(body).doc));
      expect(drawn).not.toBeNull();
      const indexed = toIndexedNote({
        file: { path: 'Plan the launch.md', text: body, modified: 1, size: body.length },
        notePaths: [createVaultPath('Plan the launch.md')],
        markdown: remarkMarkdown,
      });
      expect(indexed.progress).toBe(drawn);
      expect(indexed.checks).toHaveLength(1);
    });
  }
});

const source = createVaultPath('plans/Plan the launch.md');
const closed: PromotionPanes = { state: () => 'closed', reload: () => undefined };

function vault(initial: Record<string, string>) {
  let clock = 100;
  const files = new Map(
    Object.entries(initial).map(([path, text]) => [path, { text, modified: (clock += 1) }]),
  );
  const fs = fakeVaultFs({
    readTextFile: async (path) => {
      const file = files.get(path);
      if (file === undefined) throw new Error(`no such file: ${path}`);
      return { ...file };
    },
    writeTextFile: async ({ path, contents, expectedModified }) => {
      if (expectedModified !== null && files.get(path)?.modified !== expectedModified) {
        throw new Error('the note changed on disk since it was opened');
      }
      const modified = (clock += 1);
      files.set(path, { text: contents, modified });
      return modified;
    },
    createNote: async ({ path, contents }) => {
      if (files.has(path)) throw new Error('a note with that name already exists');
      files.set(path, { text: contents, modified: (clock += 1) });
    },
    trashEntry: async ({ path }) => {
      if (!files.delete(path)) throw new Error(`no such entry: ${path}`);
    },
  });
  return { fs, files, text: (path: string) => files.get(path)?.text ?? '' };
}

function promote(fs: ReturnType<typeof vault>['fs'], text: string, line = 0) {
  return promoteChecklistLine({
    fs,
    markdown: remarkMarkdown,
    openNotes: closed,
    rng: { next: () => 0.5 },
    today: '2026-10-08',
    notePaths: [source],
    taskType: TASK_TYPE_FILE.type,
    choice: { source, line, text },
  });
}

describe('promoting a line keeps what the line said', () => {
  it('keeps a link and a tag the line held, in the note or in the task', async () => {
    const { fs, text } = vault({ [source]: '- [ ] Ring [[Mara Quill]] about #launch\n' });
    const promotion = await promote(fs, 'Ring Mara Quill about #launch');
    const kept = text(source) + text(promotion.task);
    expect(kept).toContain('[[Mara Quill]]');
    expect(kept).toContain('#launch');
  });

  it('keeps the words a file name cannot hold, in the note or in the task', async () => {
    const { fs, text } = vault({ [source]: '- [ ] Pay invoice #42: $1,200/month\n' });
    const promotion = await promote(fs, 'Pay invoice #42: $1,200/month');
    expect(text(source) + text(promotion.task)).toContain('#42: $1,200/month');
  });
});

describe('a promoted task’s name fits on disk', () => {
  it('is cut to a name APFS holds when the line is longer than one', async () => {
    const words = 'Book the hall for the Larkspur launch '.repeat(8).trim();
    const { fs } = vault({ [source]: `- [ ] ${words}\n` });
    const promotion = await promote(fs, words);
    const fileName = promotion.task.split('/').pop() ?? '';
    expect(utf8Bytes(fileName)).toBeLessThanOrEqual(MAX_NAME_BYTES);
  });
});

describe('POST /v1/notes/{path}/promote, sent twice', () => {
  const TASK = [
    '---',
    'name: task',
    'properties:',
    '  status:',
    '    kind: select',
    '    options: [inbox, backlog, next-action, in-progress, waiting, someday, longterm, archive]',
    '    done: archive',
    '  completed: date',
    '---',
    '',
  ].join('\n');
  const plan = 'tasks/Plan the launch.md';
  const request = (body: Record<string, unknown>) => ({
    method: 'POST' as const,
    path: `/v1/notes/${encoded(plan)}/promote`,
    body,
  });

  it('makes one task, not a second that takes the line from the first (a retried request)', async () => {
    const api = apiFixture({
      files: { '.atlas/types/task.md': TASK, [plan]: '- [ ] Order chairs\n' },
      markdown: remarkMarkdown,
    });
    const first = await api.send(request({ text: 'Order chairs' }));
    expect(first.status).toBe(201);
    await api.send(request({ text: 'Order chairs' }));
    const tasks = [...api.files.keys()].filter((path) => path.startsWith('tasks/Order chairs'));
    expect(tasks).toEqual(['tasks/Order chairs.md']);
    expect(api.files.get(plan)?.text).toContain('[[Order chairs]]');
  });

  it('finds a line by its words as the note writes them, link brackets and all', async () => {
    const api = apiFixture({
      files: { '.atlas/types/task.md': TASK, [plan]: '- [ ] Ring [[Mara Quill]]\n' },
      markdown: remarkMarkdown,
    });
    const response = await api.send(request({ text: 'Ring [[Mara Quill]]' }));
    expect(response.status, JSON.stringify(bodyOf(response))).toBe(201);
  });
});
