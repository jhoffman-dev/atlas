/**
 * Seam attack (#65 x #64 x #60): PARA's plan and the Inbox's plan now share
 * one offer, and `combinedExtensions` folds both plans' changes to the
 * Meeting type into one. `acceptTypeSetup` re-derives the change from the
 * files as they are when accepted, but keeps an extension by its type's
 * name only — so a stale offer that previewed one plan's change to Meeting
 * writes the other plan's change too, which nobody was shown.
 */
import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { acceptTypeSetup, ensureBuiltInTypes } from './ensure-built-in-types.ts';

function jsonFrontmatter(): MarkdownPort {
  const read = (frontmatter: string | null): Record<string, unknown> => {
    const inner = (frontmatter ?? '')
      .replace(/^---\n/, '')
      .replace(/---\n?$/, '')
      .trim();
    return inner === '' ? {} : (JSON.parse(inner) as Record<string, unknown>);
  };
  return {
    ...fakeMarkdown(),
    frontmatterProperties: read,
    updateFrontmatter: (frontmatter, changes) => {
      const next = read(frontmatter);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === undefined) delete next[key];
        else next[key] = value;
      }
      return `---\n${JSON.stringify(next)}\n---\n`;
    },
  };
}

const note = (frontmatter: unknown, body = '\n# Mine\n') =>
  `---\n${JSON.stringify(frontmatter)}\n---\n${body}`;

function vault(files: Record<string, string>) {
  const memory = memoryVault(files);
  const fs = fakeVaultFs({
    ...memory.fs,
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const text = memory.files.get(path);
        return text === undefined ? [] : [{ path, text, modified: 1, size: text.length }];
      }),
  });
  return { fs, files: memory.files, markdown: jsonFrontmatter() };
}

const PROJECT = note({ name: 'project', label: 'Project', properties: { status: 'select' } });
const IMPORT_KEYS = {
  atlas_import_outcome: { kind: 'select', label: 'Import' },
  atlas_import_error: { kind: 'text', label: 'Import error' },
  atlas_duplicate_of: { kind: 'relation', label: 'Duplicate of', target: 'meeting' },
};

const meetingProperties = (text: string, markdown: MarkdownPort) =>
  Object.keys(
    (markdown.frontmatterProperties(splitFrontmatter(text).frontmatter)['properties'] ??
      {}) as Record<string, unknown>,
  );

describe('acceptTypeSetup, with PARA and the Inbox both changing the Meeting type', () => {
  it('does not write PARA’s project onto Meeting when the offer shown only gave it the import keys', async () => {
    // Shown: "Meeting gains Import, Import error and Duplicate of." — it already files by project.
    const v = vault({
      '.atlas/types/project.md': PROJECT,
      '.atlas/types/meeting.md': note({
        name: 'meeting',
        label: 'Meeting',
        properties: { project: { kind: 'relation', target: ['project', 'area'] } },
      }),
    });
    const { offer } = await ensureBuiltInTypes(v);
    expect(offer.extensions.map((e) => e.added.map((p) => p.key))).toEqual([
      ['atlas_import_outcome', 'atlas_import_error', 'atlas_duplicate_of'],
    ]);
    // While the offer waits, Tobias Fenn takes `project` off Meeting on purpose.
    v.files.set('.atlas/types/meeting.md', note({ name: 'meeting', label: 'Meeting' }));

    await acceptTypeSetup({ ...v, offer });

    expect(
      meetingProperties(v.files.get('.atlas/types/meeting.md') ?? '', v.markdown),
    ).not.toContain('project');
  });

  it('does not write the import keys onto Meeting when the offer shown only gave it PARA’s project', async () => {
    // Shown: "Meeting gains Project, linking project or area notes." — it already has the import keys.
    const v = vault({
      '.atlas/types/project.md': PROJECT,
      '.atlas/types/meeting.md': note({
        name: 'meeting',
        label: 'Meeting',
        properties: IMPORT_KEYS,
      }),
    });
    const { offer } = await ensureBuiltInTypes(v);
    expect(offer.extensions.map((e) => e.added.map((p) => p.key))).toEqual([['project']]);
    // While the offer waits, the duplicate key is removed from Meeting on purpose.
    const kept = {
      atlas_import_outcome: IMPORT_KEYS.atlas_import_outcome,
      atlas_import_error: IMPORT_KEYS.atlas_import_error,
    };
    v.files.set(
      '.atlas/types/meeting.md',
      note({ name: 'meeting', label: 'Meeting', properties: kept }),
    );

    await acceptTypeSetup({ ...v, offer });

    expect(
      meetingProperties(v.files.get('.atlas/types/meeting.md') ?? '', v.markdown),
    ).not.toContain('atlas_duplicate_of');
  });
});
