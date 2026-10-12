// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AFTER_A_MEETING_PRESET,
  AUTOMATION_PRESETS,
  BLANK_AUTOMATION,
  type AutomationDraft,
  type StepsAction,
} from '@atlas/domain';
import { AutomationEditor, type AutomationEditorProps } from './automation-editor.tsx';
import { AutomationsPage, type AutomationsPageProps } from './automations-page.tsx';
import type { AutomationRow, LogEntryView } from './automation-views.ts';

const AFTER_A_MEETING_STEPS = AFTER_A_MEETING_PRESET.action as StepsAction;

const ROW: AutomationRow = {
  id: '.atlas/automations/Tidy.md',
  name: 'Tidy',
  enabled: true,
  schedule: 'Every day at 03:00',
  action: 'Archive',
  lastRun: '27 Sep 2026, 03:00 · Archived 2 notes.',
  nextRun: '28 Sep 2026, 03:00',
  canUndo: true,
  problem: null,
  notice: null,
};

function page(props: Partial<AutomationsPageProps> = {}) {
  const handlers = {
    onNew: vi.fn(),
    onAddPreset: vi.fn(),
    onOpen: vi.fn(),
    onToggle: vi.fn(),
    onRunNow: vi.fn(),
  };
  render(
    <AutomationsPage
      rows={[ROW]}
      error={null}
      openId={null}
      editor={null}
      presets={['Archive done tasks after 30 days']}
      notice={null}
      busy={false}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('AutomationsPage', () => {
  it('lists each rule with what it does, when it last ran and runs next', () => {
    page();
    const list = screen.getByRole('list', { name: 'All automations' });
    expect(within(list).getByText('Archive · Every day at 03:00')).toBeTruthy();
    expect(within(list).getByText('27 Sep 2026, 03:00 · Archived 2 notes.')).toBeTruthy();
    expect(within(list).getByText('28 Sep 2026, 03:00')).toBeTruthy();
    expect(
      screen.getByText('1 automation, 1 on · rules that tidy the vault while you work'),
    ).toBeTruthy();
  });

  it('turns a rule off, runs it now, and opens it, by its id', async () => {
    const handlers = page();
    await userEvent.click(screen.getByRole('switch', { name: 'Run Tidy on its schedule' }));
    expect(handlers.onToggle).toHaveBeenCalledWith(ROW.id, false);
    await userEvent.click(screen.getByRole('button', { name: 'Run Tidy now' }));
    expect(handlers.onRunNow).toHaveBeenCalledWith(ROW.id);
    await userEvent.click(screen.getByRole('button', { name: 'Tidy' }));
    expect(handlers.onOpen).toHaveBeenCalledWith(ROW.id);
  });

  it('offers the preset and a blank rule', async () => {
    const handlers = page({ rows: [] });
    expect(screen.getByText(/No automations yet/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Archive done tasks after 30 days' }));
    expect(handlers.onAddPreset).toHaveBeenCalledWith('Archive done tasks after 30 days');
    await userEvent.click(screen.getByRole('button', { name: 'New automation' }));
    expect(handlers.onNew).toHaveBeenCalled();
  });

  it('says why a broken rule cannot run, and will not run or turn it on', () => {
    page({
      rows: [
        { ...ROW, enabled: false, problem: 'This rule’s file cannot be read: Say when it runs.' },
      ],
    });
    expect(screen.getByText(/cannot be read: Say when it runs/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Run Tidy now' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('switch', { name: 'Run Tidy on its schedule' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('shows reading, an error and a notice', () => {
    const { unmount } = render(
      <AutomationsPage
        rows={null}
        error={null}
        openId={null}
        editor={null}
        presets={[]}
        notice="Saved “Tidy”."
        busy={false}
        onNew={() => {}}
        onAddPreset={() => {}}
        onOpen={() => {}}
        onToggle={() => {}}
        onRunNow={() => {}}
      />,
    );
    expect(screen.getByText('Reading the automations…')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Saved “Tidy”.');
    unmount();
    page({ error: 'The disk is gone.' });
    expect(screen.getByRole('alert').textContent).toBe('The disk is gone.');
  });
});

const LOG: LogEntryView[] = [
  {
    id: '1',
    heading: '27 Sep 2026, 09:00:00 · Undid the run of 2026-09-27 03:00:00',
    summary: 'Put back 1 note.',
    lines: [{ kind: 'done', text: 'Put back Old (Tasks/Old.md)' }],
  },
  {
    id: '0',
    heading: '27 Sep 2026, 03:00:00 · Ran on schedule',
    summary: 'Archived 1 note. Left 1 alone.',
    lines: [
      { kind: 'done', text: 'Archived Old (Tasks/Old.md)' },
      { kind: 'left', text: 'Left Busy: It is open in Atlas with unsaved typing.' },
    ],
  },
];

/** The editor holding its draft as the page does. */
function Editor({
  start,
  onChange,
  ...props
}: Partial<AutomationEditorProps> & { start?: AutomationDraft }) {
  const [draft, setDraft] = useState<AutomationDraft>(start ?? AUTOMATION_PRESETS[0]!);
  return (
    <AutomationEditor
      draft={draft}
      onChange={(next) => {
        setDraft(next);
        onChange?.(next);
      }}
      isNew={false}
      problem={null}
      which={<p>query builder here</p>}
      typeNames={['task', 'meeting']}
      claudeTools={['atlas_search', 'atlas_read_note', 'atlas_backlinks']}
      claudeOutputs={['proposals']}
      startingSteps={AFTER_A_MEETING_STEPS}
      busy={false}
      onSave={() => {}}
      onCancel={() => {}}
      onDryRun={() => {}}
      onRunNow={() => {}}
      onUndo={() => {}}
      canUndo
      dryRun={null}
      log={LOG}
      onOpenNote={() => {}}
      {...props}
    />
  );
}

describe('AutomationEditor', () => {
  it('edits when it runs: a time of day, a gap in hours, on opening', async () => {
    const onChange = vi.fn();
    render(<Editor onChange={onChange} />);
    expect((screen.getByLabelText('Time of day') as HTMLInputElement).value).toBe('03:00');
    await userEvent.click(screen.getByRole('radio', { name: 'Every few hours' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ when: { kind: 'hourly', every: 6 } }),
    );
    expect(screen.queryByLabelText('Time of day')).toBeNull();
    expect(screen.getByLabelText('Hours between runs')).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: 'When Atlas opens' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ when: { kind: 'open' } }));
  });

  it('shows the note trigger: a type, and whether a note being created or changed sets it off', async () => {
    const onChange = vi.fn();
    render(<Editor onChange={onChange} />);
    expect(screen.queryByLabelText('Type of note')).toBeNull();

    expect(screen.getByLabelText('Days unchanged')).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: 'When a note appears' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        when: { kind: 'note', type: 'task', on: ['created'] },
        olderThanDays: null,
      }),
    );
    // The note that sets it off has just changed: there is no age to filter by.
    expect(screen.queryByLabelText('Days unchanged')).toBeNull();
    expect(screen.queryByLabelText('Time of day')).toBeNull();
    const type = screen.getByLabelText('Type of note') as HTMLSelectElement;
    expect(type.value).toBe('task');

    await userEvent.selectOptions(type, 'meeting');
    await userEvent.click(screen.getByRole('checkbox', { name: 'is changed' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        when: { kind: 'note', type: 'meeting', on: ['created', 'changed'] },
      }),
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'is created' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ when: { kind: 'note', type: 'meeting', on: ['changed'] } }),
    );
  });

  it('keeps one event on: the last cannot be turned off', async () => {
    const onChange = vi.fn();
    const start: AutomationDraft = {
      ...BLANK_AUTOMATION,
      when: { kind: 'note', type: 'meeting', on: ['changed'] },
    };
    render(<Editor start={start} onChange={onChange} />);
    const changed = screen.getByRole('checkbox', { name: 'is changed' }) as HTMLInputElement;
    expect(changed.checked).toBe(true);
    await userEvent.click(changed);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ when: { kind: 'note', type: 'meeting', on: ['changed'] } }),
    );
  });

  it('shows a type the rule names that the vault does not have, as the rule says it', () => {
    const start: AutomationDraft = {
      ...BLANK_AUTOMATION,
      when: { kind: 'note', type: 'interview', on: ['created'] },
    };
    render(<Editor start={start} />);
    expect((screen.getByLabelText('Type of note') as HTMLSelectElement).value).toBe('interview');
  });

  it('turns the age filter off and on', async () => {
    const onChange = vi.fn();
    render(<Editor onChange={onChange} />);
    const age = screen.getByLabelText('Days unchanged') as HTMLInputElement;
    expect(age.value).toBe('30');
    await userEvent.click(screen.getByRole('checkbox', { name: /Only notes not changed/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ olderThanDays: null }));
    expect(age.disabled).toBe(true);
  });

  it('sets a property instead of archiving, from a key and a value', async () => {
    const onChange = vi.fn();
    render(<Editor onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Set a property' }));
    await userEvent.type(screen.getByLabelText('Value'), 'done');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: { kind: 'set', values: { status: 'done' } } }),
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Archive' }));
    expect(screen.queryByLabelText('Value')).toBeNull();
  });

  it('asks Claude instead: a prompt, what it writes and the read tools it may use (P29-03)', async () => {
    const onChange = vi.fn();
    render(<Editor onChange={onChange} />);
    expect(screen.queryByLabelText('Prompt')).toBeNull();

    await userEvent.click(screen.getByRole('radio', { name: 'Ask Claude' }));
    await userEvent.type(screen.getByLabelText('Prompt'), 'meeting-actions');
    await userEvent.click(screen.getByRole('checkbox', { name: 'atlas_search' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: {
          kind: 'claude',
          prompt: 'meeting-actions',
          tools: ['atlas_read_note', 'atlas_search'],
          output: { kind: 'proposals', schema: 'proposals' },
        },
      }),
    );
    const tools = screen.getByRole('group', { name: 'Tools Claude may use' });
    expect(within(tools).getAllByRole('checkbox')).toHaveLength(3);
    await userEvent.click(within(tools).getByRole('checkbox', { name: 'atlas_read_note' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: expect.objectContaining({ tools: ['atlas_search'] }) }),
    );
  });

  it('offers proposals or one new note, and asks for the note’s folder', async () => {
    const onChange = vi.fn();
    render(<Editor onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Ask Claude' }));
    const writes = screen.getByLabelText('What Claude writes') as HTMLSelectElement;
    expect([...writes.options].map((option) => option.textContent)).toEqual([
      'Proposals in the Inbox',
      'One new note',
    ]);
    expect(screen.queryByLabelText('Folder')).toBeNull();

    await userEvent.selectOptions(writes, 'note');
    await userEvent.type(screen.getByLabelText('Folder'), 'Briefs');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ output: { kind: 'note', folder: 'Briefs' } }),
      }),
    );
    await userEvent.selectOptions(writes, 'proposals');
    expect(screen.queryByLabelText('Folder')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Archive' }));
    expect(screen.queryByLabelText('Prompt')).toBeNull();
  });

  it('will not save while the draft has a problem, and says it', () => {
    render(<Editor isNew start={BLANK_AUTOMATION} problem="Name the automation." />);
    expect(screen.getByRole('alert').textContent).toBe('Name the automation.');
    expect(
      (screen.getByRole('button', { name: 'Create automation' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    // A rule not yet written has no run to undo, and no log.
    expect(screen.queryByRole('button', { name: 'Undo last run' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Run log' })).toBeNull();
  });

  it('runs the commands it is given', async () => {
    const commands = {
      onSave: vi.fn(),
      onDryRun: vi.fn(),
      onRunNow: vi.fn(),
      onUndo: vi.fn(),
      onCancel: vi.fn(),
    };
    render(<Editor {...commands} />);
    for (const [name, handler] of [
      ['Save', commands.onSave],
      ['Dry run', commands.onDryRun],
      ['Run now', commands.onRunNow],
      ['Undo last run', commands.onUndo],
      ['Close', commands.onCancel],
    ] as const) {
      await userEvent.click(screen.getByRole('button', { name }));
      expect(handler).toHaveBeenCalledTimes(1);
    }
  });

  it('cannot undo when there is no run to undo', () => {
    render(<Editor canUndo={false} />);
    expect(
      (screen.getByRole('button', { name: 'Undo last run' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('lists the dry run’s notes, each a click from opening, and what it would leave', async () => {
    const onOpenNote = vi.fn();
    render(
      <Editor
        onOpenNote={onOpenNote}
        dryRun={{
          kind: 'plan',
          summary: 'Would archive 2 notes.',
          notes: [
            { path: 'Tasks/A.md', title: 'A' },
            { path: 'Tasks/B.md', title: 'B' },
          ],
          passedOver: [{ title: 'Gone', reason: 'It is already archived.' }],
        }}
      />,
    );
    const dryRun = screen.getByRole('region', { name: 'Dry run' });
    expect(within(dryRun).getByRole('heading').textContent).toBe('Would archive 2 notes.');
    const notes = within(dryRun).getByRole('list', { name: 'Notes it would take' });
    expect(
      within(notes)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['A', 'B']);
    await userEvent.click(within(notes).getByRole('button', { name: 'B' }));
    expect(onOpenNote).toHaveBeenCalledWith('Tasks/B.md');
    expect(within(dryRun).getByText('Gone: It is already archived.')).toBeTruthy();
  });

  it('shows a dry run that could not read its query', () => {
    render(<Editor dryRun={{ kind: 'error', message: 'A task has no field called due.' }} />);
    const dryRun = screen.getByRole('region', { name: 'Dry run' });
    expect(within(dryRun).getByRole('alert').textContent).toBe('A task has no field called due.');
  });

  it('shows the log newest first, with each thing done and each note left', () => {
    render(<Editor />);
    const log = screen.getByRole('region', { name: 'Run log' });
    const entries = within(log)
      .getAllByRole('listitem')
      .filter((item) => item.className === 'automation-log__entry');
    expect(
      entries.map((entry) => entry.querySelector('.automation-log__heading')?.textContent),
    ).toEqual([
      '27 Sep 2026, 09:00:00 · Undid the run of 2026-09-27 03:00:00',
      '27 Sep 2026, 03:00:00 · Ran on schedule',
    ]);
    expect(
      within(log).getByText('Left Busy: It is open in Atlas with unsaved typing.').className,
    ).toContain('automation-log__line--left');
  });

  it('says a rule that has not run has not', () => {
    render(<Editor log={[]} />);
    expect(screen.getByText('It has not run yet.')).toBeTruthy();
  });
});

/** P29-06: the meeting assistant's one switch, and a rule of several steps in the editor. */
describe('the meeting assistant’s switch', () => {
  const ASSISTANT = {
    on: false,
    steps: ['Correct its terms', 'Link its people and companies', 'Ask Claude for its actions'],
    lastRun: null,
    problem: null,
  };

  it('says what it does, in order, and what it never does, and turns on with one click', async () => {
    const onAssistant = vi.fn();
    page({ assistant: ASSISTANT, onAssistant });
    const card = screen.getByRole('region', { name: 'Meeting assistant' });
    const steps = within(within(card).getByRole('list', { name: 'What it does, in order' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(steps).toEqual(ASSISTANT.steps);
    expect(card.textContent).toContain('Claude only ever proposes');
    const toggle = within(card).getByRole('switch', {
      name: 'Run the meeting assistant after each meeting',
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    await userEvent.click(toggle);

    expect(onAssistant).toHaveBeenCalledWith(true);
  });

  it('shows on, says when it last ran, and turns off', async () => {
    const onAssistant = vi.fn();
    page({
      assistant: { ...ASSISTANT, on: true, lastRun: '8 Oct 2026, 09:00 · Standup: ran.' },
      onAssistant,
    });
    const card = screen.getByRole('region', { name: 'Meeting assistant' });
    expect(card.textContent).toContain('Last run: 8 Oct 2026, 09:00 · Standup: ran.');
    const toggle = within(card).getByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    await userEvent.click(toggle);

    expect(onAssistant).toHaveBeenCalledWith(false);
  });

  it('is held, saying why, when its rule’s file cannot be read, and while a command runs', () => {
    page({ assistant: { ...ASSISTANT, problem: 'Its rule’s file cannot be read.' } });
    const card = screen.getByRole('region', { name: 'Meeting assistant' });
    expect(card.textContent).toContain('Its rule’s file cannot be read.');
    expect(within(card).getByRole('switch').hasAttribute('disabled')).toBe(true);
  });

  it('is held while another command is under way', () => {
    page({ assistant: ASSISTANT, busy: true });
    const card = screen.getByRole('region', { name: 'Meeting assistant' });
    expect(within(card).getByRole('switch').hasAttribute('disabled')).toBe(true);
  });

  it('is not shown where the page was given none', () => {
    page();
    expect(screen.queryByRole('region', { name: 'Meeting assistant' })).toBeNull();
  });
});

describe('a rule of several steps in the editor', () => {
  it('lists its steps in order, read and not edited, and no Claude fields of its own', () => {
    render(<Editor start={AFTER_A_MEETING_PRESET} />);
    const steps = within(screen.getByRole('list', { name: 'Steps, in order' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(steps).toEqual([
      'Correct its terms',
      'Link its people and companies',
      'Ask Claude (meeting-extraction) for meeting-items',
      'Ask Claude (term-suggestions) for term-suggestions',
    ]);
    expect(screen.queryByLabelText('Prompt')).toBeNull();
    expect(screen.getByText(/To\s+change the steps, edit the rule’s file/)).toBeTruthy();
  });

  it('starts from the ready-made steps when "Several steps" is picked, and leaves them when another is', async () => {
    const onChange = vi.fn();
    render(<Editor onChange={onChange} />);
    expect(screen.queryByRole('list', { name: 'Steps, in order' })).toBeNull();

    await userEvent.click(screen.getByRole('radio', { name: 'Several steps' }));

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: AFTER_A_MEETING_STEPS }),
    );
    expect(screen.getByRole('list', { name: 'Steps, in order' })).toBeTruthy();

    await userEvent.click(screen.getByRole('radio', { name: 'Archive' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: { kind: 'archive' } }),
    );
    expect(screen.queryByRole('list', { name: 'Steps, in order' })).toBeNull();
  });
});
