/**
 * #179 (ADR-0036, ADR-0028 addendum "The caps"): the declared step — a
 * Claude step whose rule says `apply: mine` — asks Sonnet unless its rule
 * names a model, asks at most 10 times a run, and has its own allowance of 30
 * asks an hour, apart from the 20 runs an hour every rule has. Over the fake
 * vault whose index answers with real SQL, and a scripted model.
 */
import { describe, expect, it } from 'vitest';
import {
  AFTER_A_MEETING_PROMPT,
  AUTOMATION_PRESETS,
  builtInPromptAt,
  createVaultPath,
  DECLARED_STEP_ASKS_PER_HOUR,
  DECLARED_STEP_MODEL,
  digestOf,
  logPathFor,
  newLogText,
  NOTE_RUNS_PER_HOUR,
  parseObjectType,
  parseRunLog,
  type AutomationDraft,
  type AutomationRule,
  type ClaudeAction,
  type LogEntry,
  type NoteChange,
  type VaultPath,
} from '@atlas/domain';
import type { ModelEvent } from '../chat/ports.ts';
import { automationVault, jsonNote, TASK_TYPES } from '../testing/automation-vault.ts';
import { recordingActivity } from '../testing/fake-activity.ts';
import { fakeClaudeStepPorts } from '../testing/fake-claude-step.ts';
import { MEETING_BODY, MEETING_HEADER } from '../testing/meeting-files.ts';
import { ClaudeStepFailed, runClaudeStep } from './claude-step.ts';
import { loadAutomations } from './load-automations.ts';
import { NoteRunsCappedError } from './note-runs.ts';
import { runAutomation, runOnNoteChanges } from './run-automation.ts';
import { createAutomation, updateAutomation } from './save-automation.ts';
import type { VaultGuard } from './vault-guard.ts';

const TODAY = '2026-10-14';
const CLOCK = {
  today: () => TODAY,
  localNow: () => `${TODAY}T09:00:00`,
  now: () => Date.parse(`${TODAY}T09:00:00Z`),
};
const VAULT = '/vaults/home';
const GUARD: VaultGuard = { vault: VAULT, currentVault: () => VAULT };
const CHAT_MODEL = 'claude-opus-5-5';
const TYPES = [
  ...TASK_TYPES,
  parseObjectType({ name: 'meeting', label: 'Meeting', properties: { date: 'date' } }),
];

const meetingAt = (at: number): string => `Meetings/2026-10-${String(at).padStart(2, '0')} Sync.md`;
const meeting = (at: number) =>
  jsonNote({ ...MEETING_HEADER, external_id: `gemini-${at}` }, MEETING_BODY);

const STEP: ClaudeAction = {
  kind: 'claude',
  prompt: AFTER_A_MEETING_PROMPT,
  tools: [],
  output: { kind: 'proposals', schema: 'meeting-items' },
  apply: 'mine',
};
const RULE: AutomationRule = {
  id: 'After a meeting',
  path: createVaultPath('.atlas/automations/After a meeting.md'),
  name: 'After a meeting',
  enabled: true,
  when: { kind: 'note', type: 'meeting', on: ['created'] },
  which: 'FROM meeting',
  olderThanDays: null,
  action: STEP,
};

const NOTHING: ModelEvent[] = [{ type: 'text', text: JSON.stringify({ items: [] }) }];

function setUp({ meetings = 1, rounds = meetings }: { meetings?: number; rounds?: number } = {}) {
  const claude = fakeClaudeStepPorts({
    rounds: Array.from({ length: rounds }, () => NOTHING),
    model: CHAT_MODEL,
    today: TODAY,
  });
  const notes: Record<string, string> = {
    [AFTER_A_MEETING_PROMPT]: builtInPromptAt(AFTER_A_MEETING_PROMPT)!.contents,
  };
  for (let at = 1; at <= meetings; at += 1) notes[meetingAt(at)] = meeting(at);
  const vault = automationVault({ notes, today: TODAY, types: TYPES, claude });
  const activity = recordingActivity();
  const byHand = (rule: AutomationRule) =>
    runAutomation({
      ports: vault.ports,
      rule,
      clock: CLOCK,
      guard: GUARD,
      activity,
      trigger: 'hand',
    });
  const arrived = (rule: AutomationRule, path: string) => {
    const change: NoteChange = {
      kind: 'added',
      path,
      type: 'meeting',
      digest: digestOf(vault.files.get(path) ?? ''),
    };
    return runOnNoteChanges({
      ports: vault.ports,
      rule,
      clock: CLOCK,
      guard: GUARD,
      activity,
      changes: [change],
    });
  };
  const asked = () => claude.fake.requests;
  return { claude, vault, byHand, arrived, asked };
}

describe('which model the declared step asks', () => {
  it('is Sonnet when its rule names none, whatever the chat uses', async () => {
    const { byHand, asked } = setUp();

    const entry = await byHand(RULE);

    expect(asked().map((request) => request.model)).toEqual([DECLARED_STEP_MODEL]);
    expect(entry).toMatchObject({ kind: 'run', claude: { model: DECLARED_STEP_MODEL, asks: 1 } });
  });

  it('is the model its rule names, reaching the provider’s request', async () => {
    const { byHand, asked } = setUp();

    await byHand({ ...RULE, action: { ...STEP, model: 'claude-haiku-5-5' } });

    expect(asked().map((request) => request.model)).toEqual(['claude-haiku-5-5']);
  });

  it('is the chat’s for a step that does not apply, as before', async () => {
    const { apply: _declared, ...proposalsOnly } = STEP;
    expect(_declared).toBe('mine');
    const { byHand, asked } = setUp();

    await byHand({ ...RULE, action: proposalsOnly });

    expect(asked().map((request) => request.model)).toEqual([CHAT_MODEL]);
  });
});

describe('the declared step’s asks in one run', () => {
  /** Every note is asked about alone: eleven meetings would be eleven asks. */
  const eleven = () => {
    const set = setUp({ meetings: 11 });
    const step = (action: ClaudeAction) =>
      runClaudeStep({
        ports: set.claude,
        action,
        paths: Array.from({ length: 11 }, (_, at) => createVaultPath(meetingAt(at + 1))),
        fs: set.vault.ports.fs,
        index: set.vault.ports.index,
        markdown: set.vault.ports.markdown,
        notePaths: set.vault.ports.notePaths as readonly VaultPath[],
        rule: RULE.id,
        madeBy: 'After a meeting · 2026-10-14 09:00:00',
      });
    return { ...set, step };
  };

  it('refuses the 11th: the run fails having asked ten times and written nothing', async () => {
    const { step, asked, vault } = eleven();
    const before = [...vault.files.keys()];

    const failed = await step(STEP).catch((cause: unknown) => cause);

    expect(failed).toBeInstanceOf(ClaudeStepFailed);
    expect((failed as ClaudeStepFailed).message).toBe(
      'It would ask Claude more than 10 times; one run asks at most 10.',
    );
    expect((failed as ClaudeStepFailed).claude.asks).toBe(10);
    expect(asked()).toHaveLength(10);
    expect([...vault.files.keys()]).toEqual(before);
  });
});

describe('the declared step’s hourly allowance', () => {
  /** A rule's log holding `count` runs this hour that each asked Claude `asks` times. */
  const askedBefore = (rule: AutomationRule, count: number, asks = 1) => {
    const entries = Array.from({ length: count }, (_, at): LogEntry => ({
      kind: 'run',
      at: `${TODAY}T08:${String(10 + at).padStart(2, '0')}:00`,
      trigger: 'note',
      done: [],
      left: [],
      capped: false,
      claude: { model: DECLARED_STEP_MODEL, ms: 10, asks },
    }));
    return [logPathFor(rule.id), newLogText(rule.name, entries)] as const;
  };

  it('is not spent by the shared cap: a backlog of 20 asks still lets it ask', async () => {
    const { vault, arrived, asked } = setUp();
    vault.files.set(...askedBefore(RULE, NOTE_RUNS_PER_HOUR));

    const entry = await arrived(RULE, meetingAt(1));

    expect(entry).toMatchObject({ kind: 'run', claude: { asks: 1 } });
    expect(asked()).toHaveLength(1);
  });

  it('holds the same backlog for a rule without its own allowance, as before', async () => {
    const { apply: _declared, ...proposalsOnly } = STEP;
    expect(_declared).toBe('mine');
    const plain: AutomationRule = { ...RULE, action: proposalsOnly };
    const { vault, arrived, asked } = setUp();
    vault.files.set(...askedBefore(plain, NOTE_RUNS_PER_HOUR));

    await expect(arrived(plain, meetingAt(1))).rejects.toBeInstanceOf(NoteRunsCappedError);
    expect(asked()).toHaveLength(0);
  });

  it('refuses the 31st ask of the hour, says why, and asks nothing', async () => {
    const { vault, arrived, asked } = setUp();
    vault.files.set(...askedBefore(RULE, DECLARED_STEP_ASKS_PER_HOUR));
    const logged = vault.files.get(logPathFor(RULE.id));

    const held = await arrived(RULE, meetingAt(1)).catch((cause: unknown) => cause);

    expect(held).toBeInstanceOf(NoteRunsCappedError);
    expect((held as NoteRunsCappedError).until).toBe(`${TODAY}T09:10:00`);
    expect((held as NoteRunsCappedError).message).toContain(
      `It has asked Claude ${DECLARED_STEP_ASKS_PER_HOUR} times`,
    );
    expect(asked()).toHaveLength(0);
    expect(vault.files.get(logPathFor(RULE.id))).toBe(logged);
    expect(parseRunLog(logged!)).toHaveLength(DECLARED_STEP_ASKS_PER_HOUR);
  });
});

describe('the "After a meeting" preset saved into a fresh vault', () => {
  const PRESET: AutomationDraft = AUTOMATION_PRESETS.find(
    (each) => each.name === 'After a meeting',
  )!;
  const SHIPPED = builtInPromptAt(AFTER_A_MEETING_PROMPT)!.contents;

  it('writes its prompt once, and the rule reads back as the preset', async () => {
    const vault = automationVault({ today: TODAY, notes: {} });
    const { fs, markdown } = vault.ports;
    const draft = { fs, markdown, clock: CLOCK };

    await createAutomation({ ...draft, draft: PRESET, takenPaths: vault.ports.notePaths });
    const loaded = await loadAutomations({ fs, markdown, notePaths: vault.ports.notePaths });
    const [rule] = loaded.automations.map((each) => each.rule);
    await updateAutomation({ ...draft, rule: rule!, draft: PRESET });

    expect(vault.files.get(AFTER_A_MEETING_PROMPT)).toBe(SHIPPED);
    expect(vault.log.filter((line) => line.includes(AFTER_A_MEETING_PROMPT))).toHaveLength(1);
    expect(rule).toMatchObject({
      name: 'After a meeting',
      which: PRESET.which,
      action: PRESET.action,
    });
    expect(loaded.broken).toEqual([]);
  });
});
