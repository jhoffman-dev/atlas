/**
 * The chat finding a day's meetings without guessing a path (#211): the
 * model's tool calls run through the real toolbox and API router, and the
 * `date` property is asked of a real SQLite index of the vault's notes.
 */

import { describe, expect, it } from 'vitest';
import { apiFixture } from '../testing/api-fixture.ts';
import { blockMarkdown } from '../testing/block-markdown.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { createChatToolbox } from './toolbox.ts';

/** A meeting as the importer files it: its day in its name and in its `date` property. */
const meeting = (title: string, day: string) =>
  `---\ntype: meeting\ntitle: ${title}\ndate: ${day}\n---\n\n## Notes\n\nTalked it over.\n`;

const FILES: Record<string, string> = {
  'Inbox/Meetings/2026-10-14 Mara Tobias 1-1.md': meeting('Mara / Tobias 1-1', '2026-10-14'),
  'Inbox/Meetings/2026-10-14 Larkspur Standup.md': meeting('Larkspur Standup', '2026-10-14'),
  'Inbox/Meetings/2026-10-13 Larkspur Standup.md': meeting('Larkspur Standup', '2026-10-13'),
  // Dated by its property alone: its name says nothing of the day.
  'Projects/Kickoff.md': meeting('Kickoff', '2026-10-14'),
  // Named for the day, with no property: a daily note.
  'Daily/2026-10-14.md': '# Wednesday\n',
  // A different day that starts with the same digits is not that day.
  'Daily/2026-10-140.md': 'not a day\n',
  'People/Mara Quill.md': '---\ntype: person\n---\n\nMara, 1-1 on Tuesdays.\n',
};

function chat(files: Record<string, string> = FILES) {
  const markdown = blockMarkdown();
  const fixture = apiFixture({
    files,
    markdown,
    index: { query: atlasQueryIndex({ files, markdown }) },
  });
  const box = createChatToolbox({ api: fixture.deps, fs: fixture.fs, markdown, newId: () => 'id' });
  return (name: string, input: Record<string, unknown>) =>
    box.run({ id: 'call', name, input }).then(({ result }) => result);
}

const pathsIn = (content: string) =>
  (JSON.parse(content) as { notes: { path: string }[] }).notes.map((note) => note.path);

describe('atlas_list_notes with a date', () => {
  it("lists the day's notes: named for it or dated it by their date property", async () => {
    const result = await chat()('atlas_list_notes', { date: '2026-10-14' });

    expect(result.isError).toBe(false);
    expect(pathsIn(result.content)).toEqual([
      'Daily/2026-10-14.md',
      'Inbox/Meetings/2026-10-14 Larkspur Standup.md',
      'Inbox/Meetings/2026-10-14 Mara Tobias 1-1.md',
      'Projects/Kickoff.md',
    ]);
  });

  it('narrows to a folder as well', async () => {
    const result = await chat()('atlas_list_notes', {
      folder: 'Inbox/Meetings',
      date: '2026-10-14',
    });

    expect(pathsIn(result.content)).toEqual([
      'Inbox/Meetings/2026-10-14 Larkspur Standup.md',
      'Inbox/Meetings/2026-10-14 Mara Tobias 1-1.md',
    ]);
  });

  it('refuses a day that is not one, saying how to write it', async () => {
    for (const date of ['2026-02-30', '14/10/2026', '2026-10-14 09:00', 'today']) {
      const result = await chat()('atlas_list_notes', { date });

      expect(result.isError).toBe(true);
      expect(result.content).toBe('invalid: date must be a real day, written YYYY-MM-DD');
    }
  });

  it('answers a day with no notes with none', async () => {
    const result = await chat()('atlas_list_notes', { date: '2026-01-01' });

    expect(pathsIn(result.content)).toEqual([]);
  });
});

describe('atlas_read_note on a guessed path', () => {
  it('answers not_found with the real path of the note it meant, first', async () => {
    const result = await chat()('atlas_read_note', {
      path: 'Meeting Notes/2026-10-14 Mara Tobias 1-1.md',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(
      /^not_found: No note at Meeting Notes\/2026-10-14 Mara Tobias 1-1\.md\. Notes with a name like it: "Inbox\/Meetings\/2026-10-14 Mara Tobias 1-1\.md", /,
    );
  });

  it('then reads the path it was handed', async () => {
    const run = chat();
    const missed = await run('atlas_read_note', {
      path: 'Meeting Notes/2026-10-14 Mara Tobias.md',
    });
    const suggested = /"([^"]+)"/.exec(missed.content)?.[1];

    const read = await run('atlas_read_note', { path: suggested });

    expect(suggested).toBe('Inbox/Meetings/2026-10-14 Mara Tobias 1-1.md');
    expect(read.isError).toBe(false);
    expect(JSON.parse(read.content)).toMatchObject({
      note: { properties: { title: 'Mara / Tobias 1-1', date: '2026-10-14' } },
    });
  });

  it('says only not_found when no note has a name like it', async () => {
    const result = await chat()('atlas_read_note', { path: 'Elsewhere/Quarterly plan.md' });

    expect(result.content).toBe('not_found: No note at Elsewhere/Quarterly plan.md');
  });
});

describe('writing up tasks from a meeting (#211, after #207)', () => {
  it('proposes a task Waiting on nobody instead of refusing it', async () => {
    const markdown = blockMarkdown();
    const fixture = apiFixture({ files: FILES, markdown });
    const box = createChatToolbox({
      api: fixture.deps,
      fs: fixture.fs,
      markdown,
      newId: () => 'p',
    });

    const { result, proposal } = await box.run({
      id: 'call',
      name: 'propose_note',
      input: {
        title: 'Send the vendor list to Tobias',
        properties: { type: 'task', status: 'waiting' },
        body: 'From [[2026-10-14 Mara Tobias 1-1]].',
      },
    });

    expect(result.isError).toBe(false);
    expect(proposal).toMatchObject({ kind: 'note', title: 'Send the vendor list to Tobias' });
    expect(proposal?.contents).toContain('status: waiting');
  });
});
