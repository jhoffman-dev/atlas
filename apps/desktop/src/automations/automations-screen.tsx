import {
  AFTER_A_MEETING,
  AFTER_A_MEETING_PRESET,
  AUTOMATION_PRESETS,
  automationPathFor,
  CHAT_READ_TOOLS,
  createVaultPath,
  PROPOSAL_SCHEMAS,
  STEPS_ACTION,
  type VaultPath,
} from '@atlas/domain';
import {
  createAutomation,
  type ActivityLog,
  type AutomationPorts,
  type Clock,
  type RuleQueryPorts,
} from '@atlas/application';
import { AutomationEditor, AutomationsPage, QueryComposer, type PageHistory } from '@atlas/ui';
import { automationRows, logViews, meetingAssistantView } from './automation-rows.ts';
import { useAutomationEditor } from './use-automation-editor.ts';
import type { useAutomations } from './use-automations.ts';

/** The ready-made rules "Add" offers: all but the meeting assistant's, which has its own switch. */
const PRESET_NAMES = AUTOMATION_PRESETS.map((preset) => preset.name).filter(
  (name) => name !== AFTER_A_MEETING,
);
const ASSISTANT_PATH = automationPathFor(AFTER_A_MEETING);
const STARTING_STEPS = AFTER_A_MEETING_PRESET.action;
const CLAUDE_OUTPUTS = Object.keys(PROPOSAL_SCHEMAS);

/**
 * The Automations page as a page (P25-03): the list of rules and, above it,
 * the one open in the editor with its dry run and its log. It takes the place
 * of the panes, as the Archive does.
 */
export function AutomationsScreen({
  automations,
  ports,
  clock,
  indexKey,
  activity,
  onOpenNote,
  onShowSidebar,
  history,
}: {
  automations: ReturnType<typeof useAutomations>;
  ports: AutomationPorts & Pick<RuleQueryPorts, 'notePaths'>;
  clock: Pick<Clock, 'today' | 'localNow'>;
  indexKey: string;
  activity: ActivityLog;
  onOpenNote: (path: VaultPath) => void;
  onShowSidebar?: () => void;
  history?: PageHistory;
}) {
  const editor = useAutomationEditor({ automations, ports, clock, indexKey, activity });
  const { listing, watchingSince, pauses } = automations;
  const rows =
    listing === null || watchingSince === null
      ? null
      : automationRows(listing, { watchingSince, now: clock.localNow(), pauses });
  const loadedOf = (id: string) =>
    listing?.automations.find((loaded) => loaded.rule.path === id) ?? null;
  const open = editor.editing?.kind === 'rule' ? loadedOf(editor.editing.rule.path) : null;
  const openNote = (path: string) => onOpenNote(createVaultPath(path));
  const assistant = loadedOf(ASSISTANT_PATH);
  /**
   * The one switch: the "After a meeting" rule's own on and off. Turned on in
   * a vault without the rule, it is made as the ready-made one — its prompts
   * written with it — through the same one-at-a-time door a save goes through.
   */
  const setAssistant = (on: boolean) => {
    if (assistant !== null) return void automations.setEnabled(assistant.rule, on);
    if (!on) return;
    void automations
      .exclusive(
        () =>
          createAutomation({
            fs: ports.fs,
            markdown: ports.markdown,
            clock,
            draft: AFTER_A_MEETING_PRESET,
            takenPaths: ports.notePaths,
          }),
        { wait: true },
      )
      .then((made) => {
        if (made !== null) automations.setNotice('The meeting assistant is on.');
      });
  };

  return (
    <AutomationsPage
      rows={rows}
      error={automations.error}
      openId={open?.rule.path ?? null}
      presets={PRESET_NAMES}
      {...(listing !== null && {
        assistant: meetingAssistantView({
          loaded: assistant,
          broken: listing.broken.find((rule) => rule.path === ASSISTANT_PATH) ?? null,
        }),
        onAssistant: setAssistant,
      })}
      notice={automations.notice}
      busy={automations.busy}
      onNew={editor.newRule}
      onAddPreset={editor.addPreset}
      onOpen={(id) => {
        const loaded = loadedOf(id);
        if (loaded !== null) editor.openRule(loaded.rule);
      }}
      onToggle={(id, enabled) => {
        const loaded = loadedOf(id);
        if (loaded !== null) void automations.setEnabled(loaded.rule, enabled);
      }}
      onRunNow={(id) => {
        const loaded = loadedOf(id);
        if (loaded !== null) void automations.runNow(loaded.rule);
      }}
      editor={
        editor.editing === null ? null : (
          <AutomationEditor
            draft={editor.editing.draft}
            onChange={editor.change}
            isNew={editor.editing.kind === 'new'}
            problem={editor.problem}
            which={<QueryComposer {...editor.composer} />}
            typeNames={ports.types.map((type) => type.name)}
            claudeTools={CHAT_READ_TOOLS}
            claudeOutputs={CLAUDE_OUTPUTS}
            startingSteps={
              STARTING_STEPS.kind === STEPS_ACTION
                ? STARTING_STEPS
                : { kind: STEPS_ACTION, steps: [] }
            }
            busy={automations.busy}
            onSave={editor.save}
            onCancel={editor.close}
            onDryRun={editor.runDry}
            onRunNow={() => {
              editor.forgetDryRun();
              if (open !== null) void automations.runNow(open.rule);
            }}
            onUndo={() => {
              editor.forgetDryRun();
              if (open !== null) void automations.undo(open.rule);
            }}
            canUndo={
              open !== null && rows?.find((row) => row.id === open.rule.path)?.canUndo === true
            }
            dryRun={editor.dryRun}
            log={open === null ? [] : logViews(open.log)}
            onOpenNote={openNote}
          />
        )
      }
      {...(onShowSidebar !== undefined && { onShowSidebar })}
      {...(history !== undefined && { history })}
    />
  );
}
