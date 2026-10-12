import { describe, expect, it, vi } from 'vitest';
import { createVaultPath, type VaultPath } from '@atlas/domain';
import { createMeetingImporter } from '../meetings/meeting-importer.ts';
import { automationVault, jsonNote } from '../testing/automation-vault.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { meetingFile } from '../testing/meeting-files.ts';
import { jsonLinesMarkdown, jsonLinesNote, proposalVault } from '../testing/proposal-vault.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { createMeetingLinker } from './link-imported-meetings.ts';

const VAULT = '/Users/someone/Vault';
const p = (path: string) => createVaultPath(path);

describe('linking as the import lets a meeting in', () => {
  const MEETING = 'Inbox/Meetings/2026-10-06 Standup.md';
  const notes = () => ({
    [MEETING]: meetingFile(),
    'People/Mara Quill.md': jsonNote({ type: 'person', email: 'mara.quill@example.com' }),
  });

  function importerLinking(vault: ReturnType<typeof automationVault>, { link = true } = {}) {
    const activity = recordingActivity();
    const linker = createMeetingLinker({
      ports: () => vault.ports,
      clock: { today: () => '2026-10-06' },
      activity,
      openVault: () => VAULT,
      selfName: () => null,
      onWritten: () => undefined,
    });
    const importer = createMeetingImporter({
      ports: () => vault.ports,
      clock: { today: () => '2026-10-06' },
      activity,
      openVault: () => VAULT,
      active: () => true,
      onWritten: () => undefined,
      ...(link && {
        beforeLetIn: async (vaultKey: string, path: VaultPath) =>
          void (await linker(vaultKey, [path])),
      }),
    });
    return { importer, activity };
  }

  /** Every text written to the meeting, in order: what a rule watching the vault can ever see of it. */
  function versionsWritten(vault: ReturnType<typeof automationVault>): string[] {
    const versions: string[] = [];
    const write = vault.ports.fs.writeTextFile;
    vault.ports.fs.writeTextFile = async (args) => {
      if (args.path === MEETING) versions.push(args.contents);
      return write(args);
    };
    return versions;
  }

  it('links the meeting before it stamps it imported, so no write follows the stamp', async () => {
    const vault = automationVault({ notes: notes(), today: '2026-10-06' });
    const versions = versionsWritten(vault);
    const { importer } = importerLinking(vault);

    await importer.catchUp(VAULT);

    const stamped = versions.findIndex((text) =>
      text.includes('"atlas_import_outcome":"imported"'),
    );
    expect(versions).toHaveLength(2);
    // The version that arrives as `imported` already has its people; the links were before it.
    expect(stamped).toBe(1);
    expect(versions[0]).not.toContain('atlas_import_outcome');
    expect(versions[0]).toContain('[[Mara Quill]]');
    expect(versions[1]).toContain('[[Mara Quill]]');
    expect(vault.properties(MEETING)['people']).toEqual(['[[Mara Quill]]']);
  });

  it('still lets the meeting in when linking wrote nothing, stamping it alone', async () => {
    const vault = automationVault({
      notes: { [MEETING]: meetingFile() },
      today: '2026-10-06',
    });
    const versions = versionsWritten(vault);
    const { importer } = importerLinking(vault);

    await importer.catchUp(VAULT);

    expect(versions).toHaveLength(1);
    expect(vault.properties(MEETING)['atlas_import_outcome']).toBe('imported');
  });

  it('does not link a meeting the import refused', async () => {
    const vault = automationVault({
      notes: { ...notes(), [MEETING]: jsonNote({ type: 'meeting', atlas_import: 'meeting/v1' }) },
      today: '2026-10-06',
    });
    const { importer } = importerLinking(vault);

    await importer.catchUp(VAULT);

    expect(vault.properties(MEETING)['atlas_import_outcome']).toBe('error');
    expect(vault.properties(MEETING)['people']).toBeUndefined();
  });

  it('does not link a copy it archives, only the original it lets in', async () => {
    const copy = 'Inbox/Meetings/2026-10-06 Standup (gemini 1a2b3c4d).md';
    const vault = automationVault({
      notes: { ...notes(), [copy]: meetingFile() },
      today: '2026-10-06',
    });
    const { importer } = importerLinking(vault);

    await importer.catchUp(VAULT);

    expect(vault.properties(MEETING)['people']).toEqual(['[[Mara Quill]]']);
    expect(vault.files.has(copy)).toBe(false);
  });
});

describe('createMeetingLinker', () => {
  const MEETING = 'Inbox/Meetings/2026-10-06 Standup.md';
  const FILES: Record<string, string> = {
    [MEETING]: jsonLinesNote({ type: 'meeting', attendees: [{ name: 'Mara Quill' }] }),
    'People/Mara Quill.md': jsonLinesNote({ type: 'person' }),
    'Tasks/Not a meeting.md': jsonLinesNote({ type: 'task' }),
  };

  function linkerOver(openVault: () => string | null, files = FILES) {
    const setup = proposalVault(files);
    const query = atlasQueryIndex({ files, markdown: jsonLinesMarkdown() });
    const activity = recordingActivity();
    const onWritten = vi.fn();
    const linker = createMeetingLinker({
      ports: () => ({ ...setup.ports, index: { ...setup.ports.index, query } }),
      clock: { today: () => '2026-10-06' },
      activity,
      openVault,
      selfName: () => null,
      onWritten,
    });
    return { setup, activity, onWritten, linker };
  }

  it('links each meeting, says so in Activity, and says when one could not be', async () => {
    const { setup, activity, onWritten, linker } = linkerOver(() => VAULT);
    const runs = await linker(VAULT, [p(MEETING), p('Tasks/Not a meeting.md')]);
    expect(runs.map(({ meeting }) => meeting)).toEqual([MEETING]);
    expect(setup.propertiesOf(MEETING)?.['people']).toEqual(['[[Mara Quill]]']);
    expect(activity.reports.map(({ level, message }) => [level, message])).toEqual([
      ['info', '2026-10-06 Standup: linked Mara Quill.'],
      ['error', 'Could not link the meeting: Tasks/Not a meeting.md is not a meeting.'],
    ]);
    expect(onWritten).toHaveBeenCalledTimes(1);
  });

  it('keeps the run and says who it linked when its proposals then cannot be written', async () => {
    // Ines Abara is no one the vault knows, so there is a proposal to write.
    const attendees = [{ name: 'Mara Quill' }, { name: 'Ines Abara', email: 'ines@example.net' }];
    const { setup, activity, linker } = linkerOver(() => VAULT, {
      ...FILES,
      [MEETING]: jsonLinesNote({ type: 'meeting', attendees }),
    });
    const list = setup.ports.fs.listDirectory;
    setup.ports.fs.listDirectory = async (folder) => {
      if (folder === 'Inbox/Proposals') throw new Error('permission denied');
      return list(folder);
    };

    const runs = await linker(VAULT, [p(MEETING)]);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      linked: ['People/Mara Quill.md'],
      proposed: [],
      unproposed: 'permission denied',
    });
    // What an undo puts back is on the run: the links were written.
    expect(runs[0]?.done).toHaveLength(1);
    expect(activity.reports.map(({ level, message }) => [level, message])).toEqual([
      [
        'warning',
        '2026-10-06 Standup: linked Mara Quill; its proposals could not be written: permission denied.',
      ],
    ]);
  });

  it('links nothing once another vault is open', async () => {
    const { setup, activity, onWritten, linker } = linkerOver(() => '/Users/someone/Other');
    expect(await linker(VAULT, [p(MEETING)])).toEqual([]);
    expect(setup.propertiesOf(MEETING)?.['people']).toBeUndefined();
    expect(activity.reports).toEqual([]);
    expect(onWritten).not.toHaveBeenCalled();
  });

  it('does not ask for a re-read when it wrote nothing', async () => {
    const { onWritten, linker } = linkerOver(() => VAULT);
    await linker(VAULT, [p(MEETING)]);
    await linker(VAULT, [p(MEETING)]);
    expect(onWritten).toHaveBeenCalledTimes(1);
  });
});
