import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  findQuickViews,
  parseObjectType,
  parseQueryView,
  sidebarEntry,
  splitFrontmatter,
} from '@atlas/domain';
import { atlasQueryIndex } from '@atlas/application/testing/sqlite';
import { countQuickViews, fakeIndexPort, fakeVaultFs, runAtlasQuery } from '@atlas/application';
import { remarkMarkdown } from './markdown-port.ts';

/*
 * The Inbox this vault ships, read with the YAML reader every note is read
 * with and run as the app runs it, over the Task and Meeting types the vault
 * ships: captured tasks, meetings that arrived and are not yet filed, and
 * meeting files that failed import (P28-04).
 */

const root = new URL('../../../../', import.meta.url);
const shipped = (path: string) => readFileSync(new URL(`vault/${path}`, root), 'utf8');
const frontmatterOf = (text: string) =>
  remarkMarkdown.frontmatterProperties(splitFrontmatter(text).frontmatter);

const INBOX_PATH = '.atlas/views/Inbox.md';
const INBOX = shipped(INBOX_PATH);
const TYPES = ['task', 'meeting'].map((name) =>
  parseObjectType(frontmatterOf(shipped(`.atlas/types/${name}.md`))),
);

const meeting = (more: string) =>
  `---\ntype: meeting\nprovider: gemini\nexternal_id: g-1\n${more}---\n\nBody.\n`;

const NOTES: Record<string, string> = {
  'tasks/Call Mara.md': '---\ntype: task\nstatus: backlog\n---\n',
  'tasks/Ship it.md': '---\ntype: task\nstatus: done\n---\n',
  'Inbox/Meetings/2026-10-06 Standup.md': meeting(''),
  'Projects/Larkspur/2026-10-01 Kickoff.md': meeting(''),
  'Projects/Larkspur/2026-10-02 Broken.md': meeting(`atlas_import_error: title is required\n`),
  'Archive/Inbox/Meetings/2026-10-06 Standup 2.md': meeting(
    `atlas_duplicate_of: '[[2026-10-06 Standup]]'\n`,
  ),
};

const index = fakeIndexPort({
  query: atlasQueryIndex({ files: NOTES, markdown: remarkMarkdown }),
});

describe('the Inbox this vault ships', () => {
  it('lists backlog tasks, meetings in the Inbox, and meetings failing import', async () => {
    const text = parseQueryView(frontmatterOf(INBOX));
    if (text === null) throw new Error('the shipped Inbox is not a query view');

    const answer = await runAtlasQuery({
      index,
      text,
      types: TYPES,
      notePaths: Object.keys(NOTES),
    });

    expect(answer.result.rows.map((row) => row[0]).sort()).toEqual([
      'Inbox/Meetings/2026-10-06 Standup.md',
      'Projects/Larkspur/2026-10-02 Broken.md',
      'tasks/Call Mara.md',
    ]);
    expect(answer.result.columns).toContain('atlas_import_error');
  });

  it('is the quick view the sidebar lifts, and counts what it lists', async () => {
    const entry = sidebarEntry(createVaultPath(INBOX_PATH));
    const quick = findQuickViews([entry]);
    const fs = fakeVaultFs({
      readNotes: async () => [{ path: INBOX_PATH, text: INBOX, modified: 1, size: INBOX.length }],
    });

    const counts = await countQuickViews({
      fs,
      markdown: remarkMarkdown,
      index,
      quick,
      types: TYPES,
      notePaths: Object.keys(NOTES),
    });

    expect(quick.map((view) => view.id)).toEqual(['inbox']);
    expect(counts.get('inbox')).toBe(3);
  });
});
