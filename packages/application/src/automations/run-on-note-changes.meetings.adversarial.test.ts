/**
 * #92 attack: a rule a note sets off, dry-run or run by hand, "does what it
 * would have done had each of them just appeared" (`planRuleNow`). Where
 * meeting files land, a file the import has not let in — not stamped yet, or
 * refused — sets no rule off when it appears, so a run by hand must not act
 * on it either: archiving one before the import has looked hides it from the
 * import for good.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath, parseObjectType, type AutomationRule } from '@dfai/domain';
import { recordingActivity } from '../testing/fake-activity.ts';
import { automationVault, jsonNote, TASK_TYPES } from '../testing/automation-vault.ts';
import { dryRunAutomation } from './dry-run-automation.ts';
import { runAutomation } from './run-automation.ts';
import type { VaultGuard } from './vault-guard.ts';

const TODAY = '2026-10-08';
const CLOCK = {
  today: () => TODAY,
  localNow: () => `${TODAY}T09:00:00`,
  now: () => Date.parse(`${TODAY}T09:00:00Z`),
};
const VAULT = '/vaults/home';
const GUARD: VaultGuard = { vault: VAULT, currentVault: () => VAULT };

const TYPES = [
  ...TASK_TYPES,
  parseObjectType({ name: 'meeting', label: 'Meeting', properties: { status: 'text' } }),
];

const LET_IN = 'Inbox/Meetings/2026-10-06 Standup.md';
const NOT_YET = 'Inbox/Meetings/2026-10-07 Kickoff.md';
const REFUSED = 'Inbox/Meetings/2026-10-07 Retro.md';

/** A rule that files each new meeting away. */
const FILE_MEETINGS: AutomationRule = {
  id: 'File',
  path: createVaultPath('.atlas/automations/File.md'),
  name: 'File new meetings',
  enabled: true,
  when: { kind: 'note', type: 'meeting', on: ['created'] },
  which: 'FROM meeting',
  olderThanDays: null,
  action: { kind: 'archive' },
};

function setUp() {
  const vault = automationVault({
    notes: {
      [LET_IN]: jsonNote({ type: 'meeting', atlas_import_outcome: 'imported' }),
      [NOT_YET]: jsonNote({ type: 'meeting' }),
      [REFUSED]: jsonNote({
        type: 'meeting',
        atlas_import_outcome: 'error',
        atlas_import_error: 'It has no date.',
      }),
    },
    today: TODAY,
    types: TYPES,
  });
  return { vault };
}

describe('a rule a note sets off, run now, where meeting files land (#92 attack)', () => {
  it('dry-runs only to meetings the import has let in, as the feed would have set it off', async () => {
    const { vault } = setUp();

    const plan = await dryRunAutomation({
      ports: vault.ports,
      rule: FILE_MEETINGS,
      log: [],
      named: FILE_MEETINGS,
      today: TODAY,
      activity: recordingActivity(),
    });

    expect(plan.paths).toEqual([LET_IN]);
  });

  it('run by hand, leaves a file the import has not let in where it landed', async () => {
    const { vault } = setUp();

    await runAutomation({
      ports: vault.ports,
      rule: FILE_MEETINGS,
      clock: CLOCK,
      guard: GUARD,
      activity: recordingActivity(),
      trigger: 'hand',
    });

    expect(vault.files.has(NOT_YET)).toBe(true);
    expect(vault.files.has(REFUSED)).toBe(true);
  });
});
