import { describe, expect, it, vi } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { pageArchiveItems } from './archive-menu.ts';
import type { ArchiveCommands } from './use-archive.ts';

/** #213: a page menu's Archive and Unarchive on a PARA note set its value; the file stays. */
function items({
  path,
  properties,
  busy = false,
}: {
  path: string | null;
  properties: Record<string, unknown> | null;
  busy?: boolean;
}) {
  const commands: ArchiveCommands = { archive: vi.fn(), unarchive: vi.fn(), busy };
  const setProperty = vi.fn();
  const menu = pageArchiveItems({
    commands,
    path: path === null ? null : createVaultPath(path),
    properties,
    setProperty,
  });
  return { menu, commands, setProperty };
}

describe('pageArchiveItems', () => {
  it('archives a project by setting PARA to archive, moving nothing', () => {
    const { menu, commands, setProperty } = items({
      path: 'Projects/Atlas.md',
      properties: { type: 'project', para: 'area' },
    });
    expect(menu.onUnarchive).toBeUndefined();
    menu.onArchive?.();
    expect(setProperty).toHaveBeenCalledWith('para', 'archive');
    expect(commands.archive).not.toHaveBeenCalled();
  });

  it('restores an archived project by setting PARA back to project, moving nothing', () => {
    const { menu, commands, setProperty } = items({
      path: 'Projects/Atlas.md',
      properties: { type: 'Project', para: 'archive' },
    });
    expect(menu.onArchive).toBeUndefined();
    menu.onUnarchive?.();
    expect(setProperty).toHaveBeenCalledWith('para', 'project');
    expect(commands.unarchive).not.toHaveBeenCalled();
  });

  it('archives any other note by moving it, as before', () => {
    const { menu, commands, setProperty } = items({
      path: 'Tasks/Call the bank.md',
      properties: { type: 'task' },
    });
    menu.onArchive?.();
    expect(commands.archive).toHaveBeenCalledWith(['Tasks/Call the bank.md']);
    expect(setProperty).not.toHaveBeenCalled();
  });

  it('takes a project already in the Archive folder out as an archived file', () => {
    const { menu, commands, setProperty } = items({
      path: 'Archive/Projects/Atlas.md',
      properties: { type: 'project' },
    });
    menu.onUnarchive?.();
    expect(commands.unarchive).toHaveBeenCalledWith(['Archive/Projects/Atlas.md']);
    expect(setProperty).not.toHaveBeenCalled();
  });

  it('never offers a project template the PARA toggle', () => {
    const { menu } = items({
      path: '.atlas/templates/Project.md',
      properties: { type: 'project' },
    });
    expect(menu).toEqual({});
  });

  it('offers no Archive while the note is still opening: a project must not be moved', () => {
    expect(items({ path: 'Projects/Atlas.md', properties: null }).menu).toEqual({});
  });

  it('offers nothing while the Archive is busy, or with no note', () => {
    expect(items({ path: 'Projects/Atlas.md', properties: {}, busy: true }).menu).toEqual({});
    expect(items({ path: null, properties: null }).menu).toEqual({});
  });
});
