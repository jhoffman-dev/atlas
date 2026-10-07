/**
 * Adversarial pass on Phase 25's runner and undo (P25-02): the cap across
 * runs, a vault switch in the middle of a run, and a log edited by hand or
 * brought in by a sync tool steering what undo writes. The vault is held in
 * memory with a real-SQL index; the clock is fixed.
 */
import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  logPathFor,
  MAX_ACTIONS_PER_RUN,
  parseRunLog,
  type AutomationRule,
  type VaultPath,
} from '@atlas/domain';
import { automationVault, jsonNote } from '../testing/automation-vault.ts';
import { runAutomation } from './run-automation.ts';
import { loadAutomations } from './load-automations.ts';
import { createAutomation } from './save-automation.ts';
import { undoLastRun } from './undo-last-run.ts';
import type { VaultGuard } from './vault-guard.ts';
import { recordingActivity } from '../testing/fake-activity.ts';

/** Where the runs say how they went; these tests read the rule's own log instead. */
const ACTIVITY = recordingActivity();

const TODAY = '2026-09-27';
const CLOCK = { today: () => TODAY, localNow: () => `${TODAY}T03:00:00` };
const VAULT = '/vaults/home';
const GUARD: VaultGuard = { vault: VAULT, currentVault: () => VAULT };

const ARCHIVE_RULE: AutomationRule = {
  id: 'Tidy',
  path: createVaultPath('.atlas/automations/Tidy.md'),
  name: 'Tidy',
  enabled: true,
  when: { kind: 'daily', at: '03:00' },
  which: 'FROM task WHERE status = done',
  olderThanDays: null,
  action: { kind: 'archive' },
};

const FLAG_RULE: AutomationRule = {
  ...ARCHIVE_RULE,
  which: 'FROM task',
  action: { kind: 'set', values: { flagged: true } },
};

const LOG = logPathFor(ARCHIVE_RULE.id);

/** A log as a hand edit or a sync tool could leave it: one run, with the lines given. */
const handWrittenLog = (lines: string[]) =>
  [
    '---\natlas: automation-log\n---\n\n# Tidy — run log\n',
    '## 2026-09-27 03:00:00 · Ran by hand\n',
    'Archived 1 note.\n',
    ...lines,
    '',
  ].join('\n');

describe('the cap across runs', () => {
  it('reaches every matching note in the end: a second run sets the ones the first left', async () => {
    const notes: Record<string, string> = {};
    const count = MAX_ACTIONS_PER_RUN + 1;
    for (let n = 0; n < count; n += 1) {
      notes[`Tasks/T${String(n).padStart(4, '0')}.md`] = jsonNote({
        type: 'task',
        status: 'doing',
      });
    }
    const vault = automationVault({ today: TODAY, notes });
    const run = {
      ports: vault.ports,
      rule: FLAG_RULE,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
    };

    const first = await runAutomation({ ...run, trigger: 'schedule' });
    expect(first.kind === 'run' && first.capped).toBe(true);
    await runAutomation({ ...run, trigger: 'schedule' });

    const unflagged = Object.keys(notes).filter(
      (path) => vault.properties(path)['flagged'] !== true,
    );
    expect(unflagged).toEqual([]);
  }, 30_000);
});

describe('a vault switch in the middle of a run', () => {
  it('logs every change the run made before it was cut off, so it can be undone', async () => {
    const vault = automationVault({
      today: TODAY,
      notes: {
        'Tasks/A.md': jsonNote({ type: 'task', status: 'doing' }),
        'Tasks/B.md': jsonNote({ type: 'task', status: 'doing' }),
      },
    });
    let open: string = VAULT;
    const fs = vault.ports.fs;
    // The person opens another vault just after the first note is written.
    const switching = {
      ...fs,
      writeTextFile: async (args: Parameters<typeof fs.writeTextFile>[0]) => {
        const written = await fs.writeTextFile(args);
        open = '/vaults/work';
        return written;
      },
    };
    const guard: VaultGuard = { vault: VAULT, currentVault: () => open };
    await runAutomation({
      ports: { ...vault.ports, fs: switching },
      rule: FLAG_RULE,
      clock: CLOCK,
      activity: ACTIVITY,
      guard,
      trigger: 'schedule',
    }).catch(() => null);

    const changed = ['Tasks/A.md', 'Tasks/B.md'].filter(
      (path) => vault.properties(path)['flagged'] === true,
    );
    expect(changed.length).toBeGreaterThan(0);
    const logged = parseRunLog(vault.files.get(logPathFor(FLAG_RULE.id)) ?? '').flatMap((entry) =>
      'done' in entry ? entry.done : [],
    );
    const loggedPaths = logged.flatMap((action) => ('path' in action ? [action.path] : []));
    expect(loggedPaths).toEqual(changed);
  });
});

describe('undo reads a log a person or a sync tool can write', () => {
  it('never writes a key a rule may not set — a note’s type — because a log line says so', async () => {
    const vault = automationVault({
      today: TODAY,
      notes: {
        'Notes/Plain.md': jsonNote({ type: 'note' }),
        [LOG]: handWrittenLog(['- set `"Notes/Plain.md"` `"type"`: `"secret"` → `"note"`']),
      },
    });
    await undoLastRun({
      ports: vault.ports,
      rule: ARCHIVE_RULE,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
    });
    expect(vault.properties('Notes/Plain.md')['type']).toBe('note');
  });

  it('never marks an ordinary note as an automation because a log line says so', async () => {
    const vault = automationVault({
      today: TODAY,
      notes: {
        'Notes/Plain.md': jsonNote({ title: 'Plain' }),
        [LOG]: handWrittenLog(['- set `"Notes/Plain.md"` `"atlas"`: `"automation"` → nothing']),
      },
    });
    await undoLastRun({
      ports: vault.ports,
      rule: ARCHIVE_RULE,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
    });
    expect(vault.properties('Notes/Plain.md')).not.toHaveProperty('atlas');
  });

  it('leaves archived a note the person archived by hand months before the run', async () => {
    const archived: VaultPath = createVaultPath('Archive/Private/Diary.md');
    const vault = automationVault({
      today: TODAY,
      notes: {
        [archived]: jsonNote({ archived: '2026-01-05', archivedFrom: 'Private/Diary.md' }),
        [LOG]: handWrittenLog(['- archived `"Private/Diary.md"` → `"Archive/Private/Diary.md"`']),
      },
    });
    await undoLastRun({
      ports: vault.ports,
      rule: ARCHIVE_RULE,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
    });
    expect(vault.files.has(archived)).toBe(true);
  });
});

describe('a new rule under a name an old one had', () => {
  it('has nothing to undo: the deleted rule’s last run is not the new rule’s', async () => {
    const vault = automationVault({
      today: TODAY,
      notes: {
        'Archive/Tasks/Old.md': jsonNote({ archived: '2026-09-20', archivedFrom: 'Tasks/Old.md' }),
        // The log a deleted rule called Tidy left behind.
        [LOG]: handWrittenLog(['- archived `"Tasks/Old.md"` → `"Archive/Tasks/Old.md"`']),
      },
    });
    const path = await createAutomation({
      fs: vault.ports.fs,
      markdown: vault.ports.markdown,
      clock: CLOCK,
      draft: { ...FLAG_RULE, name: 'Tidy' },
      takenPaths: vault.ports.notePaths,
    });
    // The rule as Atlas reads it back from the file just written: its id is the file's, not the old rule's.
    const { fs, markdown, notePaths } = vault.ports;
    const listing = await loadAutomations({ fs, markdown, notePaths });
    const rule = listing.automations.find((loaded) => loaded.rule.path === path)!.rule;
    const undo = await undoLastRun({
      ports: vault.ports,
      rule,
      clock: CLOCK,
      activity: ACTIVITY,
      guard: GUARD,
    });
    expect(undo).toBeNull();
  });
});
