import { describe, expect, it } from 'vitest';
import { parseObjectType } from '../types/property-def.ts';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { isTidyCandidate, tidyPlan, type TidyNote } from './tidy-plan.ts';

const TODAY = '2026-10-14';
const path = createVaultPath;

const note = (at: string, properties: Record<string, unknown> = {}): TidyNote => ({
  path: path(at),
  properties,
});

const IMPORTED = { type: 'meeting', atlas_import: 'meeting/v1', atlas_import_outcome: 'imported' };

/** The plan for these notes, the only ones in the vault unless `others` says more. */
function plan(
  notes: readonly TidyNote[],
  others: readonly string[] = [],
  types: Parameters<typeof tidyPlan>[0]['types'] = [],
) {
  const notePaths: VaultPath[] = [...notes.map((each) => each.path), ...others.map(path)];
  return tidyPlan({ notes, notePaths, types, today: TODAY });
}

describe('isTidyCandidate (#214)', () => {
  it('looks at notes loose at the root, and anything in the older Inbox/Meetings', () => {
    expect(isTidyCandidate(path('Plan.md'))).toBe(true);
    expect(isTidyCandidate(path('Inbox/Meetings/2026-10-01 Sync.md'))).toBe(true);
    expect(isTidyCandidate(path('inbox/meetings/Older/2026-01-01 Sync.md'))).toBe(true);
  });

  it('never looks at a note already in a folder, DFAI’s own, the Archive, or a file that is not a note', () => {
    expect(isTidyCandidate(path('Projects/DFAI.md'))).toBe(false);
    expect(isTidyCandidate(path('Inbox/Call Sam.md'))).toBe(false);
    expect(isTidyCandidate(path('.atlas/views/Board.md'))).toBe(false);
    expect(isTidyCandidate(path('Archive/Inbox/Meetings/Old.md'))).toBe(false);
    expect(isTidyCandidate(path('photo.png'))).toBe(false);
  });
});

describe('tidyPlan', () => {
  it('lists the exact move of each root note to its home, and each let-in meeting to its month', () => {
    const notes = [
      note('Call Sam.md', { type: 'task' }),
      note('Mara Quill.md', { type: 'person' }),
      note('Larkspur Payroll.md', { type: 'company' }),
      note('2026-09-30.md', { type: 'daily' }),
      note('Loose thought.md'),
      note('Inbox/Meetings/2026-09-29 Platform weekly sync.md', {
        ...IMPORTED,
        date: '2026-09-29',
      }),
    ];

    expect(plan(notes)).toEqual({
      moves: [
        { from: 'Call Sam.md', to: 'Tasks/2026/10/Call Sam.md' },
        { from: 'Mara Quill.md', to: 'People/Mara Quill.md' },
        { from: 'Larkspur Payroll.md', to: 'Companies/Larkspur Payroll.md' },
        { from: '2026-09-30.md', to: 'Daily/2026/2026-09-30.md' },
        { from: 'Loose thought.md', to: 'Notes/2026/Loose thought.md' },
        {
          from: 'Inbox/Meetings/2026-09-29 Platform weekly sync.md',
          to: 'Meetings/2026/09/2026-09-29 Platform weekly sync.md',
        },
      ],
      refused: [],
    });
  });

  it('leaves a root note whose type has no home where it is, unlisted', () => {
    expect(plan([note('Ship it.md', { type: 'decision' })])).toEqual({ moves: [], refused: [] });
  });

  it('follows a type file’s own folder, and leaves a type that says it has none', () => {
    const types = [
      parseObjectType({ name: 'task', folder: 'Work/{YYYY}' }),
      parseObjectType({ name: 'person', folder: '' }),
    ];
    const result = plan(
      [note('Call Sam.md', { type: 'task' }), note('Mara.md', { type: 'person' })],
      [],
      types,
    );
    expect(result.moves).toEqual([{ from: 'Call Sam.md', to: 'Work/2026/Call Sam.md' }]);
  });

  it('refuses, rather than renames, a note whose home already holds its name, in any case', () => {
    const result = plan([note('Call Sam.md', { type: 'task' })], ['tasks/2026/10/call sam.md']);
    expect(result.moves).toEqual([]);
    expect(result.refused).toEqual([
      {
        path: 'Call Sam.md',
        to: 'Tasks/2026/10/Call Sam.md',
        reason: 'Tasks/2026/10/Call Sam.md is already a note there: rename one of them first.',
      },
    ]);
  });

  it('refuses both of two notes that would land on the same path, and moves the rest', () => {
    const result = plan([
      note('Standup.md', { type: 'meeting', date: '2026-10-01' }),
      note('Inbox/Meetings/Standup.md', { ...IMPORTED, date: '2026-10-02' }),
      note('Idea.md'),
    ]);
    expect(result.moves).toEqual([{ from: 'Idea.md', to: 'Notes/2026/Idea.md' }]);
    expect(result.refused.map(({ path: at, reason }) => [at, reason])).toEqual([
      [
        'Standup.md',
        'Another note would land at Meetings/2026/10/Standup.md too: rename one of them first.',
      ],
      [
        'Inbox/Meetings/Standup.md',
        'Another note would land at Meetings/2026/10/Standup.md too: rename one of them first.',
      ],
    ]);
  });

  it('leaves a meeting file the import has not let in where it is, saying so', () => {
    const waiting = { type: 'meeting', atlas_import: 'meeting/v1', date: '2026-10-01' };
    const result = plan([
      note('Inbox/Meetings/Arriving.md', waiting),
      note('Inbox/Meetings/Broken.md', { ...waiting, atlas_import_outcome: 'error' }),
      note('Inbox/Meetings/Copy.md', { ...waiting, atlas_import_outcome: 'duplicate' }),
      // From before DFAI imported: moved into a month's folder it would become an arrival.
      note('Old sync.md', waiting),
    ]);
    expect(result.moves).toEqual([]);
    expect(result.refused.map(({ path: at }) => at)).toEqual([
      'Inbox/Meetings/Arriving.md',
      'Inbox/Meetings/Broken.md',
      'Inbox/Meetings/Copy.md',
      'Old sync.md',
    ]);
    expect(result.refused[0]?.reason).toMatch(/import has not let it in/);
  });

  it('moves nothing the second time: a tidied vault has an empty plan', () => {
    const first = plan([note('Call Sam.md', { type: 'task' }), note('Idea.md')]);
    const tidied = first.moves.map(({ to }) => to);
    // After the moves, nothing is at the root: the only candidates left are none.
    expect(plan([], tidied)).toEqual({ moves: [], refused: [] });
    expect(tidied.every((at) => !isTidyCandidate(at))).toBe(true);
  });
});
