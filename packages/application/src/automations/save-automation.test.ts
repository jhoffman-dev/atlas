import { describe, expect, it } from 'vitest';
import { AUTOMATION_PRESETS, logPathFor, parseRunLog, type AutomationDraft } from '@atlas/domain';
import { automationVault, jsonNote } from '../testing/automation-vault.ts';
import { loadAutomations } from './load-automations.ts';
import { runAutomation } from './run-automation.ts';
import { AutomationRefusedError, createAutomation, updateAutomation } from './save-automation.ts';
import { recordingActivity } from '../testing/fake-activity.ts';

/** Where the runs say how they went; these tests read the rule's own log instead. */
const ACTIVITY = recordingActivity();

const TODAY = '2026-09-27';
const CLOCK = { today: () => TODAY, localNow: () => `${TODAY}T14:00:00` };
const PRESET = AUTOMATION_PRESETS[0]!;
const PRESET_PATH = '.atlas/automations/Archive done tasks after 30 days.md';

function emptyVault(notes: Record<string, string> = {}) {
  return automationVault({ today: TODAY, notes });
}

async function create(vault: ReturnType<typeof emptyVault>, draft: AutomationDraft = PRESET) {
  const { fs, markdown } = vault.ports;
  return createAutomation({ fs, markdown, clock: CLOCK, draft, takenPaths: vault.ports.notePaths });
}

async function load(vault: ReturnType<typeof emptyVault>) {
  const { fs, markdown, notePaths } = vault.ports;
  return loadAutomations({ fs, markdown, notePaths });
}

describe('createAutomation', () => {
  it('writes the rule as a note that reads back as it, and logs it as turned on', async () => {
    const vault = emptyVault();
    const path = await create(vault);
    expect(path).toBe(PRESET_PATH);
    expect(vault.files.get(path)).toMatch(/\n# Archive done tasks after 30 days\n$/);
    const listing = await load(vault);
    expect(listing.automations.map((loaded) => loaded.rule)).toEqual([
      { ...PRESET, id: PRESET.name, path },
    ]);
    expect(listing.automations[0]?.log).toEqual([{ kind: 'turnedOn', at: `${TODAY}T14:00:00` }]);
  });

  it('logs nothing for a rule that starts out off', async () => {
    const vault = emptyVault();
    await create(vault, { ...PRESET, enabled: false });
    expect(vault.files.has(logPathFor(PRESET.name))).toBe(false);
  });

  it.each<[string, AutomationDraft, RegExp]>([
    ['a taken name', PRESET, /already an automation called/],
    ['no query', { ...PRESET, name: 'Other', which: '' }, /Say which notes/],
    ['a name a file cannot have', { ...PRESET, name: 'a/b' }, /cannot hold/],
  ])('refuses %s, writing nothing', async (_, draft, problem) => {
    const vault = emptyVault({ [PRESET_PATH]: jsonNote({ atlas: 'automation' }) });
    const before = [...vault.log];
    await expect(create(vault, draft)).rejects.toThrow(problem);
    await expect(create(vault, draft)).rejects.toBeInstanceOf(AutomationRefusedError);
    expect(vault.log).toEqual(before);
  });
});

describe('updateAutomation', () => {
  it('rewrites the rule, keeping the note’s own words, and logs turning it back on', async () => {
    const vault = emptyVault();
    const path = await create(vault, { ...PRESET, enabled: false });
    vault.files.set(path, `${vault.files.get(path)}\nMy reasons for this rule.\n`);
    const [{ rule } = { rule: null }] = (await load(vault)).automations;
    const { fs, markdown } = vault.ports;
    await updateAutomation({
      fs,
      markdown,
      clock: CLOCK,
      rule: rule!,
      draft: { ...rule!, enabled: true, olderThanDays: 14, when: { kind: 'hourly', every: 6 } },
    });
    const [after] = (await load(vault)).automations;
    expect(after?.rule).toMatchObject({
      enabled: true,
      olderThanDays: 14,
      when: { kind: 'hourly', every: 6 },
    });
    expect(vault.files.get(path)).toContain('My reasons for this rule.');
    expect(after?.log.map((entry) => entry.kind)).toEqual(['turnedOn']);
  });

  it('refuses a draft that is not a rule, and leaves the file alone', async () => {
    const vault = emptyVault();
    const path = await create(vault);
    const text = vault.files.get(path);
    const [{ rule } = { rule: null }] = (await load(vault)).automations;
    const { fs, markdown } = vault.ports;
    const write = (draft: AutomationDraft) =>
      updateAutomation({ fs, markdown, clock: CLOCK, rule: rule!, draft });
    await expect(write({ ...rule!, name: ' ' })).rejects.toThrow('Name the automation.');
    await expect(write({ ...rule!, which: '' })).rejects.toThrow(/Say which notes/);
    expect(vault.files.get(path)).toBe(text);
  });
});

describe('loadAutomations', () => {
  it('lists rules by name with their logs, broken ones with why, and skips other notes', async () => {
    const vault = emptyVault({
      '.atlas/automations/Zed.md': jsonNote({
        atlas: 'automation',
        when: 'manually',
        which: 'FROM task',
        do: 'archive',
      }),
      '.atlas/automations/Broken.md': jsonNote({
        atlas: 'automation',
        when: 'weekly',
        which: 'FROM task',
        do: 'archive',
      }),
      '.atlas/automations/Readme.md': jsonNote({ title: 'Not a rule' }),
      '.atlas/automations/log/Zed.md': 'not a rule either',
      'Tasks/Old.md': jsonNote({ type: 'task', status: 'done' }),
    });
    await create(vault);
    const listing = await load(vault);
    expect(listing.automations.map((loaded) => loaded.rule.name)).toEqual([
      'Archive done tasks after 30 days',
      'Zed',
    ]);
    expect(listing.broken).toEqual([
      {
        path: '.atlas/automations/Broken.md',
        name: 'Broken',
        problem: expect.stringMatching(/Say when it runs/),
      },
    ]);
  });

  it('reads the log a run writes', async () => {
    const vault = emptyVault({ 'Tasks/Old.md': jsonNote({ type: 'task', status: 'done' }) });
    await create(vault, { ...PRESET, olderThanDays: null });
    const [{ rule } = { rule: null }] = (await load(vault)).automations;
    const guard = { vault: '/v', currentVault: () => '/v' };
    await runAutomation({
      ports: vault.ports,
      rule: rule!,
      clock: CLOCK,
      activity: ACTIVITY,
      guard,
      trigger: 'hand',
    });
    const [loaded] = (await load(vault)).automations;
    expect(loaded?.log.map((entry) => entry.kind)).toEqual(['turnedOn', 'run']);
    expect(parseRunLog(vault.files.get(logPathFor(rule!.id))!)).toEqual(loaded?.log);
  });
});
