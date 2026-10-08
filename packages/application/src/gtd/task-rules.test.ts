import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { doneChange } from '../query/tick-done.ts';
import { setNoteProperties } from '../query/set-property.ts';
import { TaskRuleRefusedError, withTaskRules } from './task-rules.ts';

/** P30-02: a write to a task is held to its rules, against what the file says as it is written. */
const TODAY = '2026-10-08';
const STATUS = {
  key: 'status',
  done: 'archive',
  options: [
    'inbox',
    'backlog',
    'next-action',
    'in-progress',
    'waiting',
    'someday',
    'longterm',
    'archive',
  ],
};

function taskFile(frontmatter: string) {
  const memory = memoryVault({ 'tasks/Call.md': `---\n${frontmatter}\n---\n\n# Call\n` });
  return { fs: fakeVaultFs(memory.fs), files: memory.files, markdown: fakeMarkdown() };
}

const write = (
  vault: ReturnType<typeof taskFile>,
  values: Parameters<typeof withTaskRules>[0]['values'],
) =>
  setNoteProperties({
    fs: vault.fs,
    markdown: vault.markdown,
    path: createVaultPath('tasks/Call.md'),
    values: withTaskRules({ values, today: TODAY }),
  });

describe('withTaskRules', () => {
  it('refuses Waiting with nobody to wait on, writing nothing', async () => {
    const vault = taskFile('type: task\nstatus: next-action');
    const before = vault.files.get('tasks/Call.md');
    await expect(write(vault, { status: 'waiting' })).rejects.toThrow(TaskRuleRefusedError);
    await expect(write(vault, { status: 'waiting' })).rejects.toThrow(/set Waiting on first/);
    expect(vault.files.get('tasks/Call.md')).toBe(before);
  });

  it('lets Waiting through when the file already says who', async () => {
    const vault = taskFile('type: task\nstatus: next-action\nwaiting_on: [[Mara Quill]]');
    await write(vault, { status: 'waiting' });
    expect(vault.files.get('tasks/Call.md')).toContain('status: waiting');
  });

  it('ticking a task sets Archive and today as completed; unticking puts the status back and the day away', async () => {
    const vault = taskFile('type: task\nstatus: in-progress');
    await write(vault, doneChange({ status: STATUS, done: true, previous: null }));
    expect(vault.files.get('tasks/Call.md')).toBe(
      '---\ntype: task\nstatus: archive\ncompleted: 2026-10-08\n---\n\n# Call\n',
    );
    await write(vault, doneChange({ status: STATUS, done: false, previous: 'in-progress' }));
    expect(vault.files.get('tasks/Call.md')).toBe(
      '---\ntype: task\nstatus: in-progress\n---\n\n# Call\n',
    );
  });
});
