import { describe, expect, it } from 'vitest';
import { paraMigrationLine, paraMoveLine, paraNoteMove } from './para-migration.ts';

/** #213: moving Area and Resource notes onto the one Project type. */
describe('paraNoteMove', () => {
  it('moves an Area note onto the Project type with PARA area', () => {
    expect(paraNoteMove({ path: 'Areas/Garden.md', properties: { type: 'area' } })).toEqual({
      fromType: 'area',
      fromPara: null,
      to: 'area',
      changes: { type: 'project', para: 'area' },
    });
  });

  it('moves a Resource note, in any spelling of its type, with PARA resource', () => {
    const move = paraNoteMove({ path: 'Manual.md', properties: { type: ' Resource ' } });
    expect(move?.changes).toEqual({ type: 'project', para: 'resource' });
    expect(move?.fromType).toBe(' Resource ');
  });

  it('writes the vault’s own spelling of the Project type', () => {
    const move = paraNoteMove({
      path: 'Garden.md',
      properties: { type: 'area' },
      projectType: 'Project',
    });
    expect(move?.changes).toEqual({ type: 'Project', para: 'area' });
  });

  it('archives by value an Area or Resource note already in the Archive, leaving its path', () => {
    for (const type of ['area', 'resource']) {
      const move = paraNoteMove({ path: 'Archive/Old/Thing.md', properties: { type } });
      expect(move?.changes).toEqual({ type: 'project', para: 'archive' });
    }
  });

  it('gives a Project in the Archive folder PARA archive, and changes only that', () => {
    const move = paraNoteMove({
      path: 'archive/Projects/Plan.md',
      properties: { type: 'project', para: 'project', status: 'done' },
    });
    expect(move).toEqual({
      fromType: 'project',
      fromPara: 'project',
      to: 'archive',
      changes: { para: 'archive' },
    });
  });

  it('is a no-op on a note it has moved: running it again changes nothing', () => {
    expect(
      paraNoteMove({ path: 'Garden.md', properties: { type: 'project', para: 'area' } }),
    ).toBeNull();
    expect(
      paraNoteMove({
        path: 'Archive/Plan.md',
        properties: { type: 'project', para: 'Archive' },
      }),
    ).toBeNull();
  });

  it('leaves every other note alone', () => {
    expect(paraNoteMove({ path: 'Atlas.md', properties: { type: 'project' } })).toBeNull();
    expect(paraNoteMove({ path: 'Archive/Call.md', properties: { type: 'task' } })).toBeNull();
    expect(paraNoteMove({ path: 'Plain.md', properties: {} })).toBeNull();
    expect(paraNoteMove({ path: 'List.md', properties: { type: ['area'] } })).toBeNull();
  });

  it('never moves a note Atlas keeps for itself, such as an Area template', () => {
    expect(
      paraNoteMove({ path: '.atlas/templates/Area.md', properties: { type: 'area' } }),
    ).toBeNull();
  });

  it('says a PARA that is not text as it is written', () => {
    const move = paraNoteMove({
      path: 'Archive/Plan.md',
      properties: { type: 'project', para: ['a', 'b'] },
    });
    expect(move?.fromPara).toBe('["a","b"]');
  });
});

describe('the words the move is shown in', () => {
  it('says what each note was and what it becomes', () => {
    const area = paraNoteMove({ path: 'Garden.md', properties: { type: 'Area' } });
    const archived = paraNoteMove({ path: 'Archive/Plan.md', properties: { type: 'project' } });
    if (area === null || archived === null) throw new Error('both move');
    expect(paraMoveLine({ title: 'Garden', move: area })).toBe('Garden: Area → Project, PARA Area');
    expect(paraMoveLine({ title: 'Plan', move: archived })).toBe(
      'Plan: PARA (none) → PARA Archive',
    );
  });

  it('counts what was moved, and what was left, for Activity', () => {
    expect(paraMigrationLine({ moved: 1, left: 0 })).toBe(
      'Moved 1 note onto the Project type, with PARA set.',
    );
    expect(paraMigrationLine({ moved: 3, left: 2 })).toBe(
      'Moved 3 notes onto the Project type, with PARA set. 2 notes left as they were.',
    );
  });
});
