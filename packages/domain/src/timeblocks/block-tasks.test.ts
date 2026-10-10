import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { blockTasksWith, blockTasksWithout, taskLink } from './block-tasks.ts';

/** P31-02: a task dropped on a block joins its tasks; undoing the drop takes it out again. */
const REPORT = createVaultPath('Quarterly report.md');
const CALL = createVaultPath('Call Mara.md');
const NOTES = [REPORT, CALL, createVaultPath('Admin.md')];

describe('a task dropped on a block', () => {
  it('is linked after the tasks the block already holds, which are kept as written', () => {
    const tasks = ['[[Call Mara|the call]]', 'not a link'];

    expect(blockTasksWith({ tasks, task: REPORT, notePaths: NOTES })).toEqual([
      '[[Call Mara|the call]]',
      'not a link',
      '[[Quarterly report]]',
    ]);
  });

  it('is the first task of a block with none, or the second of one holding a single link', () => {
    expect(blockTasksWith({ tasks: undefined, task: REPORT, notePaths: NOTES })).toEqual([
      '[[Quarterly report]]',
    ]);
    expect(blockTasksWith({ tasks: null, task: REPORT, notePaths: NOTES })).toEqual([
      '[[Quarterly report]]',
    ]);
    expect(blockTasksWith({ tasks: '[[Call Mara]]', task: REPORT, notePaths: NOTES })).toEqual([
      '[[Call Mara]]',
      '[[Quarterly report]]',
    ]);
  });

  it('changes nothing when the block already links the task, however the link is written', () => {
    for (const written of [
      '[[Quarterly report]]',
      '[[quarterly report|QR]]',
      '[[Quarterly report.md]]',
    ]) {
      expect(blockTasksWith({ tasks: [written], task: REPORT, notePaths: NOTES })).toBeNull();
    }
  });

  it('is linked by its path where another note shares its name', () => {
    const elsewhere = createVaultPath('Archive/Quarterly report.md');
    const notes = [...NOTES, elsewhere];

    expect(taskLink(elsewhere, notes)).toBe('[[Archive/Quarterly report]]');
    expect(
      blockTasksWith({ tasks: ['[[Quarterly report]]'], task: elsewhere, notePaths: notes }),
    ).toEqual(['[[Quarterly report]]', '[[Archive/Quarterly report]]']);
  });
});

describe('undoing the drop', () => {
  it('takes out the last link to the task and keeps every other in its place', () => {
    const tasks = ['[[Quarterly report]]', '[[Call Mara]]', '[[Quarterly report]]'];

    expect(blockTasksWithout({ tasks, task: REPORT, notePaths: NOTES })).toEqual([
      '[[Quarterly report]]',
      '[[Call Mara]]',
    ]);
  });

  it('leaves an empty list when the task was all the block held', () => {
    expect(
      blockTasksWithout({ tasks: '[[Quarterly report]]', task: REPORT, notePaths: NOTES }),
    ).toEqual([]);
  });

  it('changes nothing when the block no longer links the task', () => {
    expect(
      blockTasksWithout({ tasks: ['[[Call Mara]]'], task: REPORT, notePaths: NOTES }),
    ).toBeNull();
    expect(blockTasksWithout({ tasks: undefined, task: REPORT, notePaths: NOTES })).toBeNull();
  });
});

describe('adversarial (P31-02): a block whose tasks are written in one line', () => {
  // The index reads every link in a property's text as one of its relations
  // (`relationsOf`), so the block below already links the report.
  it('changes nothing when the task is the second link of the line', () => {
    expect(
      blockTasksWith({
        tasks: '[[Call Mara]], [[Quarterly report]]',
        task: REPORT,
        notePaths: NOTES,
      }),
    ).toBeNull();
  });
});

describe('undoing a drop on a block whose tasks are written in one line', () => {
  it('leaves an item that links other tasks too: a drop never wrote it', () => {
    expect(
      blockTasksWithout({
        tasks: ['[[Call Mara]], [[Quarterly report]]'],
        task: REPORT,
        notePaths: NOTES,
      }),
    ).toBeNull();
    expect(
      blockTasksWithout({
        tasks: ['[[Call Mara]], [[Quarterly report]]', '[[Quarterly report]]'],
        task: REPORT,
        notePaths: NOTES,
      }),
    ).toEqual(['[[Call Mara]], [[Quarterly report]]']);
  });
});
