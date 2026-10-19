/**
 * #394: the writes that give a key back as the text it was read as, run
 * through their use-cases against the real markdown adapter, on a note whose
 * frontmatter keys are indented. `frontmatterKeyTexts` reads such a key with
 * the block's indent; that text must be written back, never taken as a
 * removal — which once deleted a task's `status` on the Today page's undo, and
 * a note's own `archived` on unarchive.
 */
import { describe, expect, it } from 'vitest';
import {
  changeUndoably,
  fakeIndexPort,
  fakeVaultFs,
  memoryVault,
  setNoteProperties,
  unarchiveNotes,
  type ArchivePorts,
  type PropertyChanges,
} from '@atlas/application';
import { createVaultPath } from '@atlas/domain';
import { remarkMarkdown } from './markdown-port.ts';

const markdown = remarkMarkdown;

describe('today-actions: an undo on an indented task (#394)', () => {
  it('gives the task back byte for byte, its comments and inline comment kept', async () => {
    const path = 'Tasks/Repot the fern.md';
    const task = [
      '---',
      '   type: task',
      '   # Mara moves this one',
      '   status: next-action # by hand',
      '   due: 2026-10-20',
      '---',
      '',
      'Use the big pot.',
      '',
    ].join('\n');
    const memory = memoryVault({ [path]: task });
    const fs = fakeVaultFs(memory.fs);
    const write = (values: PropertyChanges, ifModified?: number) =>
      setNoteProperties({
        fs,
        markdown,
        path,
        values,
        today: '2026-10-19',
        ...(ifModified !== undefined && { ifModified }),
      });
    const made = await changeUndoably({
      fs,
      markdown,
      path,
      write: (readAt) => write({ status: 'someday' }, readAt),
    });
    expect(memory.files.get(path)).toContain('\n   status: someday # by hand\n');
    expect(made.undo).not.toBeNull();
    await write(made.undo!);
    expect(memory.files.get(path)).toBe(task);
  });
});

describe('archive-notes: unarchiving a note archived from an indented block (#394)', () => {
  const editors: ArchivePorts['editors'] = {
    state: () => 'closed',
    flush: async () => {},
    follow: () => {},
    abandon: () => {},
    reload: () => {},
  };

  it('gives back the note’s own key from the indented text its stamp recorded', async () => {
    // As a vault already holds it: `archivedPrior` keeps the key's text with
    // the block's indent, which the writer once refused and removed instead.
    const archived = createVaultPath('Archive/Projects/Plan.md');
    const memory = memoryVault({
      [archived]: [
        '---',
        '  title: Plan',
        '  archived: 2026-10-19 # mine',
        '  status: open',
        '  archivedFrom: Projects/Plan.md',
        '  archivedPrior:',
        '    archived: |2',
        '        archived: false # mine',
        '---',
        '',
        'Body.',
        '',
      ].join('\n'),
    });
    const ports: ArchivePorts = {
      fs: fakeVaultFs(memory.fs),
      markdown,
      index: fakeIndexPort(),
      editors,
    };
    const restored = await unarchiveNotes({ ports, paths: [archived], notePaths: [archived] });
    expect(restored.failed).toEqual([]);
    expect(memory.files.get('Projects/Plan.md')).toBe(
      '---\n  title: Plan\n  archived: false # mine\n  status: open\n---\n\nBody.\n',
    );
  });
});
