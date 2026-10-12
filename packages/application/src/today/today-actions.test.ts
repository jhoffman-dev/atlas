import { splitFrontmatter, taskDeferral, TASK_KEYS } from '@atlas/domain';
import { describe, expect, it } from 'vitest';
import { TaskRuleRefusedError } from '../gtd/task-rules.ts';
import { setNoteProperties, type PropertyChanges } from '../query/set-property.ts';
import { archiveTaskChange } from '../review/review-actions.ts';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { ChangedSinceError, undoableChange } from './today-actions.ts';

/** #111: the Today page's actions, written through the one write and taken back. */
const PATH = 'Tasks/Water the beds.md';
const TODAY = '2026-10-13';

function vaultWith(text: string) {
  const memory = memoryVault({ [PATH]: text });
  const markdown = fakeMarkdown();
  const write = (values: PropertyChanges) =>
    setNoteProperties({ fs: fakeVaultFs(memory.fs), markdown, path: PATH, values, today: TODAY });
  const text_ = () => memory.files.get(PATH) ?? '';
  const properties = () =>
    markdown.frontmatterProperties(splitFrontmatter(text_()).frontmatter ?? '');
  return { memory, write, text: text_, properties };
}

const NEXT = '---\ntype: task\nstatus: next-action\n---\n\nBody.\n';

describe('undoableChange', () => {
  it('has nothing to undo until the change has been written', () => {
    expect(undoableChange({ [TASK_KEYS.status]: 'backlog' }).undo()).toBeNull();
  });

  it('takes a deferral back, leaving the file as it was', async () => {
    const vault = vaultWith(NEXT);
    const change = undoableChange(taskDeferral({ today: TODAY, days: 1 }) ?? {});

    await vault.write(change.values);
    expect(vault.properties()).toMatchObject({ defer: '2026-10-14' });

    await vault.write(change.undo() ?? {});
    expect(vault.text()).toBe(NEXT);
  });

  it('puts back the day a task was deferred to before', async () => {
    const vault = vaultWith('---\ntype: task\nstatus: next-action\ndefer: 2026-10-13\n---\n');
    const change = undoableChange(taskDeferral({ today: TODAY, days: 7 }) ?? {});
    await vault.write(change.values);
    expect(vault.properties()).toMatchObject({ defer: '2026-10-20' });
    await vault.write(change.undo() ?? {});
    expect(vault.properties()).toMatchObject({ defer: '2026-10-13' });
  });

  it('takes a move back to the status the task held', async () => {
    const vault = vaultWith(NEXT);
    const change = undoableChange({ [TASK_KEYS.status]: 'someday' });
    await vault.write(change.values);
    expect(vault.properties()).toMatchObject({ status: 'someday' });
    await vault.write(change.undo() ?? {});
    expect(vault.text()).toBe(NEXT);
  });

  it('unfinishes a ticked task: its status back, and the day the rules gave it gone', async () => {
    const vault = vaultWith(NEXT);
    const change = undoableChange(archiveTaskChange());
    await vault.write(change.values);
    expect(vault.properties()).toMatchObject({ status: 'archive', completed: TODAY });

    await vault.write(change.undo() ?? {});
    expect(vault.properties()).toEqual({ type: 'task', status: 'next-action' });
  });

  it('rolls a repeating task back to the date and status it had', async () => {
    const repeating =
      '---\ntype: task\nstatus: in-progress\ndue: 2026-10-13\nrecurrence: every week\n---\n\nBody.\n';
    const vault = vaultWith(repeating);
    const change = undoableChange(archiveTaskChange());
    await vault.write(change.values);
    expect(vault.properties()).toMatchObject({ status: 'next-action', due: '2026-10-20' });

    await vault.write(change.undo() ?? {});
    expect(vault.text()).toBe(repeating);
  });

  it('refuses to undo once the task says something else, and writes nothing', async () => {
    const vault = vaultWith(NEXT);
    const change = undoableChange({ [TASK_KEYS.status]: 'someday' });
    await vault.write(change.values);
    await vault.write({ [TASK_KEYS.status]: 'backlog' });
    const edited = vault.text();

    await expect(vault.write(change.undo() ?? {})).rejects.toThrow(ChangedSinceError);
    expect(vault.text()).toBe(edited);
  });

  it('still undoes when only another key has changed since', async () => {
    const vault = vaultWith(NEXT);
    const change = undoableChange({ [TASK_KEYS.status]: 'someday' });
    await vault.write(change.values);
    await vault.write({ [TASK_KEYS.due]: '2026-11-01' });
    await vault.write(change.undo() ?? {});
    expect(vault.properties()).toMatchObject({ status: 'next-action', due: '2026-11-01' });
  });

  it('remembers nothing of a change the task rules refused', async () => {
    const vault = vaultWith(NEXT);
    const change = undoableChange({ [TASK_KEYS.status]: 'waiting' });
    await expect(vault.write(change.values)).rejects.toThrow(TaskRuleRefusedError);
    expect(vault.text()).toBe(NEXT);
  });
});
