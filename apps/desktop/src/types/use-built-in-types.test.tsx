// @vitest-environment jsdom
/**
 * Opening a vault sets it up for PARA through the real markdown writer, so
 * what is asserted is the YAML each type file ends up holding, byte for byte
 * where the vault's own text is concerned.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { fakeVaultFs, memoryVault, recordingActivity } from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import { useBuiltInTypes } from './use-built-in-types.ts';

const TASK = [
  '---',
  'name: task',
  'label: Task',
  'properties:',
  '  status:',
  '    kind: select',
  '    options: [backlog, done]',
  '  # James keeps his estimates in words.',
  '  estimate: text',
  '---',
  '',
  '# Task',
  '',
].join('\n');

function setup(files: Record<string, string>, { strict = false } = {}) {
  const memory = memoryVault(files);
  const fs = fakeVaultFs({
    ...memory.fs,
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const text = memory.files.get(path);
        return text === undefined ? [] : [{ path, text, modified: 1, size: text.length }];
      }),
  });
  const onChanged = vi.fn();
  const activity = recordingActivity();
  const hook = renderHook(
    () =>
      useBuiltInTypes({ fs, markdown: remarkMarkdown, vaultKey: '/vault', activity, onChanged }),
    { reactStrictMode: strict },
  );
  return { files: memory.files, hook, onChanged, activity };
}

/** A Project type with every key PARA ships on it, so opening only adds the types beside it. */
const PROJECT = [
  '---',
  'name: project',
  'label: Project',
  'properties:',
  '  status: select',
  '  area: text',
  '  due: date',
  '  description: text',
  '---',
  '',
  '# Project',
  '',
].join('\n');

/** A Meeting type from before `tasks` and `decisions` (#162), commented as Mara Quill keeps it. */
const OLDER_MEETING = [
  '---',
  'name: meeting',
  'label: Meeting',
  'icon: calendar',
  'properties:',
  '  # Set by the import; Mara reads it on the Inbox page.',
  '  atlas_import_outcome:',
  '    kind: select',
  '    label: How it came in',
  '    options: [imported, error]',
  '  atlas_import_error: text',
  '  atlas_duplicate_of:',
  '    kind: relation',
  '    target: meeting',
  '---',
  '',
  '# Meeting',
  '',
  'Mara’s own words about meetings.',
  '',
].join('\n');

describe('useBuiltInTypes', () => {
  it('writes the PARA types a vault that files by project lacks, and says the vault changed', async () => {
    const { files, onChanged } = setup({ '.atlas/types/project.md': PROJECT });
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect([...files.keys()].sort()).toEqual([
      '.atlas/types/area.md',
      '.atlas/types/project.md',
      '.atlas/types/resource.md',
    ]);
    expect(files.get('.atlas/types/resource.md')).toContain(
      '  project:\n    kind: relation\n    target:\n      - project\n      - area\n',
    );
    expect(files.get('.atlas/types/project.md')).toBe(PROJECT);
  });

  it('says in Activity which types it wrote without asking', async () => {
    const { activity } = setup({ '.atlas/types/project.md': PROJECT });
    await waitFor(() => expect(activity.reports).toHaveLength(2));
    expect(activity.reports.map(({ level, kind, subject }) => ({ level, kind, subject }))).toEqual([
      { level: 'info', kind: 'app', subject: { kind: 'note', path: '.atlas/types/area.md' } },
      { level: 'info', kind: 'app', subject: { kind: 'note', path: '.atlas/types/resource.md' } },
    ]);
    expect(activity.reports[0]?.message).toContain('Added the area type');
  });

  it('says nothing in Activity when it only offers', async () => {
    const { hook, activity } = setup({ '.atlas/types/task.md': TASK });
    await waitFor(() => expect(hook.result.current).not.toBeNull());
    expect(activity.reports).toEqual([]);
  });

  it('offers PARA, the Inbox’s types and Daily to a vault without them, and writes them only when accepted', async () => {
    const { files, hook, onChanged } = setup({ '.atlas/types/task.md': TASK });
    await waitFor(() =>
      expect(hook.result.current?.lines).toEqual([
        'Adds the Project, Area, Resource, Proposal, Decision and Daily types.',
        'Task gains Project, linking project or area notes.',
      ]),
    );
    expect([...files.keys()]).toEqual(['.atlas/types/task.md']);
    expect(onChanged).not.toHaveBeenCalled();

    await act(() => hook.result.current?.accept() ?? Promise.resolve());

    expect([...files.keys()].sort()).toEqual([
      '.atlas/types/area.md',
      '.atlas/types/daily.md',
      '.atlas/types/decision.md',
      '.atlas/types/project.md',
      '.atlas/types/proposal.md',
      '.atlas/types/resource.md',
      '.atlas/types/task.md',
    ]);
    // Everything James wrote is still there, as he wrote it; Project is added after it.
    expect(files.get('.atlas/types/task.md')).toBe(
      TASK.replace(
        '  estimate: text\n',
        '  estimate: text\n  project:\n    kind: relation\n    target:\n      - project\n      - area\n',
      ),
    );
    expect(hook.result.current).toBeNull();
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('accepts against the type as it is now: a property removed since the offer stays removed', async () => {
    const { files, hook } = setup({ '.atlas/types/task.md': TASK });
    await waitFor(() => expect(hook.result.current).not.toBeNull());
    // While the offer waits, James removes `estimate` in the type editor.
    const edited = TASK.replace('  # James keeps his estimates in words.\n  estimate: text\n', '');
    files.set('.atlas/types/task.md', edited);

    await act(() => hook.result.current?.accept() ?? Promise.resolve());

    const task = files.get('.atlas/types/task.md') ?? '';
    expect(task).not.toContain('estimate');
    expect(task).toBe(
      edited.replace(
        '    options: [backlog, done]\n',
        '    options: [backlog, done]\n  project:\n    kind: relation\n    target:\n      - project\n      - area\n',
      ),
    );
  });

  it('puts the offer away for now when dismissed, writing nothing', async () => {
    const { files, hook } = setup({ '.atlas/types/task.md': TASK });
    await waitFor(() => expect(hook.result.current).not.toBeNull());
    act(() => hook.result.current?.dismiss());
    expect(hook.result.current).toBeNull();
    expect([...files.keys()]).toEqual(['.atlas/types/task.md']);
    expect(files.get('.atlas/types/task.md')).toBe(TASK);
  });

  it('records a type it could not write when the offer is accepted, and writes the rest', async () => {
    const broken = '---\n: : not yaml\n---\n';
    const { files, hook, activity } = setup({
      '.atlas/types/task.md': TASK,
      '.atlas/types/area.md': broken,
    });
    await waitFor(() => expect(hook.result.current).not.toBeNull());

    await act(() => hook.result.current?.accept() ?? Promise.resolve());

    expect(activity.reports.map((report) => report.message)).toEqual([
      'The Area type could not be set up for PARA: already there',
    ]);
    expect(files.get('.atlas/types/area.md')).toBe(broken);
    expect(files.has('.atlas/types/resource.md')).toBe(true);
  });

  it('records a type it could not write in the Activity log', async () => {
    const { activity } = setup({
      '.atlas/types/project.md': PROJECT,
      '.atlas/types/area.md': '---\n: : not yaml\n---\n',
    });
    // The failure is a warning; the Resource type it did write is the info line beside it.
    await waitFor(() =>
      expect(activity.reports.map(({ level, message }) => [level, message])).toEqual([
        ['warning', 'The Area type could not be set up for PARA: already there'],
        ['info', 'Added the resource type: this vault files by project, and PARA needs it.'],
      ]),
    );
  });

  it('gives an older Meeting type tasks and decisions on opening, keeping every byte it had', async () => {
    const { files, onChanged } = setup({ '.atlas/types/meeting.md': OLDER_MEETING });
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(files.get('.atlas/types/meeting.md')).toBe(
      OLDER_MEETING.replace(
        '    target: meeting\n',
        [
          '    target: meeting',
          '  tasks:',
          '    kind: relation',
          '    target: task',
          '    many: true',
          '  decisions:',
          '    kind: relation',
          '    target: decision',
          '    many: true',
          '',
        ].join('\n'),
      ),
    );
  });

  it('says in Activity which properties a type gained, and writes nothing on the next open', async () => {
    const first = setup({ '.atlas/types/meeting.md': OLDER_MEETING });
    await waitFor(() => expect(first.activity.reports).toHaveLength(1));
    expect(first.activity.reports[0]).toMatchObject({
      level: 'info',
      kind: 'app',
      message:
        'Added Tasks and Decisions to the Meeting type, which was written before Atlas shipped them.',
      subject: { kind: 'note', path: '.atlas/types/meeting.md' },
    });

    const again = setup(Object.fromEntries(first.files));
    await waitFor(() => expect(again.hook.result.current).not.toBeNull());
    expect(again.files).toEqual(first.files);
    expect(again.activity.reports).toEqual([]);
    expect(again.onChanged).not.toHaveBeenCalled();
  });

  it('warns in Activity, and writes nothing, when the record of what it added cannot be read', async () => {
    const record = '---\natlas: migration\n---\n\nNot a record any more.\n';
    const { files, activity } = setup({
      '.atlas/types/meeting.md': OLDER_MEETING,
      '.atlas/migrations/type-properties.md': record,
    });
    await waitFor(() => expect(activity.reports).toHaveLength(1));
    expect(activity.reports[0]?.level).toBe('warning');
    expect(activity.reports[0]?.message).toMatch(
      /^Atlas could not add its built-in properties to any type: .*cannot be read/,
    );
    expect(files.get('.atlas/types/meeting.md')).toBe(OLDER_MEETING);
  });

  it('reports the properties added once, and no failure, when StrictMode runs the effect twice', async () => {
    const { files, activity } = setup(
      { '.atlas/types/meeting.md': OLDER_MEETING },
      { strict: true },
    );
    await waitFor(() => expect(activity.reports).toHaveLength(1));
    expect(activity.reports[0]).toMatchObject({
      level: 'info',
      message:
        'Added Tasks and Decisions to the Meeting type, which was written before Atlas shipped them.',
    });
    expect(files.get('.atlas/types/meeting.md')).toContain('  decisions:\n');
  });

  it('warns in Activity, and writes nothing, on a Meeting type whose properties are a list', async () => {
    const listed = '---\nname: meeting\nproperties:\n  - title\n  - attendees\n---\n';
    const { files, activity } = setup({ '.atlas/types/meeting.md': listed });
    await waitFor(() => expect(activity.reports).toHaveLength(1));
    expect(activity.reports[0]).toMatchObject({
      level: 'warning',
      message: expect.stringMatching(
        /^Atlas did not add its built-in properties to the Meeting type: its `properties` is not a map/,
      ),
      subject: { kind: 'note', path: '.atlas/types/meeting.md' },
    });
    expect(files.get('.atlas/types/meeting.md')).toBe(listed);
    expect(files.has('.atlas/migrations/type-properties.md')).toBe(false);
  });
});
