import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { tasksJoined, tasksParted } from './meeting-task-links.ts';

const ROLLOUT = createVaultPath('Tasks/Write the rollout note.md');
const CACHE = createVaultPath('Tasks/Flag the cache.md');
const OLD = createVaultPath('Archive/Tasks/Old task.md');
const NOTES = [ROLLOUT, CACHE, OLD];

describe('tasksJoined', () => {
  it('adds each task once, after what the relation holds', () => {
    expect(
      tasksJoined({
        value: ['[[Old task]]'],
        tasks: [ROLLOUT, CACHE, ROLLOUT],
        notePaths: NOTES,
        many: true,
      }),
    ).toEqual(['[[Old task]]', '[[Write the rollout note]]', '[[Flag the cache]]']);
    expect(
      tasksJoined({ value: undefined, tasks: [ROLLOUT], notePaths: NOTES, many: true }),
    ).toEqual(['[[Write the rollout note]]']);
  });

  it('adds nothing it links already, however that link is spelt', () => {
    expect(
      tasksJoined({
        value: ['[[Tasks/Write the rollout note|the note]]'],
        tasks: [ROLLOUT],
        notePaths: NOTES,
        many: true,
      }),
    ).toBeNull();
    expect(
      tasksJoined({
        value: '[[write the rollout note]]',
        tasks: [ROLLOUT],
        notePaths: NOTES,
        many: true,
      }),
    ).toBeNull();
    expect(tasksJoined({ value: [], tasks: [], notePaths: NOTES, many: true })).toBeNull();
  });

  it('never writes over a value that holds something other than links', () => {
    expect(
      tasksJoined({ value: [{ a: 1 }], tasks: [ROLLOUT], notePaths: NOTES, many: true }),
    ).toBeNull();
    expect(tasksJoined({ value: 3, tasks: [ROLLOUT], notePaths: NOTES, many: true })).toBeNull();
  });

  it('fills a one-note relation only when it is empty and there is one task', () => {
    expect(tasksJoined({ value: undefined, tasks: [ROLLOUT], notePaths: NOTES, many: false })).toBe(
      '[[Write the rollout note]]',
    );
    expect(
      tasksJoined({ value: '[[Old task]]', tasks: [ROLLOUT], notePaths: NOTES, many: false }),
    ).toBeNull();
    expect(
      tasksJoined({ value: undefined, tasks: [ROLLOUT, CACHE], notePaths: NOTES, many: false }),
    ).toBeNull();
  });
});

describe('tasksParted', () => {
  it('takes out the links to the tasks, however spelt, and keeps the rest', () => {
    expect(
      tasksParted({
        value: ['[[Old task]]', '[[Tasks/Write the rollout note|the note]]', '[[Flag the cache]]'],
        tasks: [ROLLOUT, CACHE],
        notePaths: NOTES,
      }),
    ).toEqual(['[[Old task]]']);
  });

  it('clears the key once nothing is left, and leaves a value with none of them alone', () => {
    expect(
      tasksParted({ value: ['[[Write the rollout note]]'], tasks: [ROLLOUT], notePaths: NOTES }),
    ).toBeNull();
    expect(
      tasksParted({ value: ['[[Old task]]'], tasks: [ROLLOUT], notePaths: NOTES }),
    ).toBeUndefined();
    expect(tasksParted({ value: undefined, tasks: [ROLLOUT], notePaths: NOTES })).toBeUndefined();
    expect(tasksParted({ value: [{ a: 1 }], tasks: [ROLLOUT], notePaths: NOTES })).toBeUndefined();
  });
});
