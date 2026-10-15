export {
  AUTOMATION_MARKER,
  AUTOMATION_MARKER_VALUE,
  automationFrontmatter,
  automationIdFor,
  automationIdKey,
  automationIdProblem,
  automationNameProblem,
  automationPathFor,
  describeAction,
  draftProblem,
  isAutomationNote,
  isAutomationPath,
  MAX_OLDER_THAN_DAYS,
  parseAutomationRule,
  setKeyProblem,
  setValueFromInput,
  wouldChange,
} from './automation-rule.ts';
export type {
  AutomationAction,
  AutomationDraft,
  AutomationRule,
  BrokenAutomation,
  SetValue,
} from './automation-rule.ts';
export { automationQuery, MAX_ACTIONS_PER_RUN, movingDate } from './automation-query.ts';
export { capFor, cappedLine, describePlan, planAutomation, planVerb } from './automation-plan.ts';
export type { AutomationPlan, PassedOver } from './automation-plan.ts';
export {
  describeSchedule,
  isDue,
  localTimeMs,
  localTimeOf,
  MAX_EVERY_HOURS,
  nextRunAfter,
  parseSchedule,
  printSchedule,
} from './schedule.ts';
export type { LocalTime, Schedule } from './schedule.ts';
export {
  appendEntryToLog,
  appendLogEntry,
  futureMarkOf,
  formatLogEntry,
  lastRunOf,
  lastScheduleMark,
  lastUndoableRun,
  logPathFor,
  LOG_MARKER_VALUE,
  MAX_LOG_BYTES,
  MAX_LOG_ENTRIES,
  newLogText,
  parseRunLog,
  stillAsLeft,
  logEntryHeading,
  logEntrySummary,
} from './run-log.ts';
export type {
  ClaudeRunInfo,
  DoneAction,
  LogEntry,
  LoggedVersion,
  PriorValue,
  RunTrigger,
} from './run-log.ts';
export {
  CLAUDE_NOTES_PER_RUN,
  claudeActionFields,
  isPromptPath,
  describeClaudeAction,
  outputHasItems,
  PROMPTS_DIRECTORY,
  readClaudeAction,
  withClaudeChoices,
} from './claude-step.ts';
export type { ClaudeAction, ClaudeApply, ClaudeOutput } from './claude-step.ts';
export {
  claudeAskRefusal,
  claudeRunAsks,
  claudeStepBudget,
  claudeStepDefaultModel,
  claudeStepModel,
  DECLARED_STEP_ASKS_PER_HOUR,
  DECLARED_STEP_ASKS_PER_RUN,
  DECLARED_STEP_MODEL,
  SHARED_STEP_BUDGET,
  sharesAskAllowance,
} from './claude-step-budget.ts';
export type { ClaudeRunAsks, ClaudeStepBudget } from './claude-step-budget.ts';
export {
  answerJson,
  checkDraft,
  citedBlockProblem,
  MAX_PROPOSALS_PER_ANSWER,
  registerProposalSchema,
} from './proposal-schema.ts';
export type {
  AnswerContext,
  AnsweredNote,
  AnswerReading,
  AnswerVault,
  CheckedProposal,
  DroppedItem,
  PromptData,
  ProposalDraft,
  ProposalSchema,
  Reading,
  RegisteredProposalSchema,
} from './proposal-schema.ts';
export { PROPOSAL_SCHEMAS, proposalSchemaNamed } from './proposal-schemas.ts';
export { FOLLOW_UP_TAG, MEETING_ITEMS, MEETING_ITEMS_OUTPUT } from './meeting-items.ts';
export { itemOwner } from './meeting-item-owner.ts';
export type { ItemOwner, OwnerDirectory } from './meeting-item-owner.ts';
export {
  decideMeetingItems,
  TASK_CONFIDENCE_FLOOR,
  vaultNamesItsOwner,
} from './meeting-item-apply.ts';
export type {
  MeetingItemCap,
  MeetingItemClaim,
  MeetingItemDecision,
  MeetingItemsDecision,
  MeetingItemsRun,
  OwnerSettings,
  ProposedBecause,
} from './meeting-item-apply.ts';
export {
  AFTER_A_MEETING_PROMPT,
  BUILT_IN_PROMPTS,
  builtInPromptAt,
  MEETING_EXTRACTION_PROMPT,
} from './built-in-prompts.ts';
export type { BuiltInPrompt } from './built-in-prompts.ts';
export { NOTE_ANSWER_INSTRUCTIONS, readNoteAnswer } from './note-answer.ts';
export {
  CLAUDE_NOTE_CHARACTERS,
  CLAUDE_STEP_QUESTION,
  CLAUDE_SYSTEM_MAX_BYTES,
  claudeSystemProblem,
  CLAUDE_TOTAL_NOTE_CHARACTERS,
  claudeStepSystem,
} from './claude-step-prompt.ts';
export { claudeWriteRefusal } from './claude-write-folder.ts';
export { atlasItemKey, claudeNewProposal, claudeProposalId } from './claude-proposal-id.ts';
export { leading, MAX_LOGGED_CHARACTERS, truncated } from './answer-limits.ts';
export {
  answeredMeetingOf,
  CLAUDE_ASKS_PER_RUN,
  claudeAsks,
  cutNotes,
  shownNotes,
} from './answered-note.ts';
export type { AnsweredMeeting, ClaudeAsks, NoteCut, NoteSkipped } from './answered-note.ts';
export type { NoteAnswer, NoteAnswerValue } from './note-answer.ts';
export {
  asksSpentInHour,
  backoffMinutes,
  dueTrigger,
  nextRunOf,
  NOTE_RUNS_PER_HOUR,
  noteRunsCappedProblem,
  noteRunsHeldUntil,
} from './automation-due.ts';
export {
  emptyLedger,
  isSchemaKey,
  LEDGER_MAX_AGE_DAYS,
  LEDGER_MAX_BYTES,
  MAX_DIGESTS_PER_PATH,
  MAX_LEDGER_RECORDS,
  readHandledLedger,
} from './handled-ledger.ts';
export type { AnsweredRecord, HandledLedger, LedgerMark, PathRecord } from './handled-ledger.ts';
export {
  handledVersions,
  leftHandledNotes,
  missedArrivals,
  noteTriggerHears,
  noteTriggerQueryProblem,
  parseNoteTrigger,
  printNoteTrigger,
  triggeringVersions,
  unhandledVersions,
} from './note-trigger.ts';
export type {
  HandledContext,
  HandledVersions,
  HeldNote,
  NoteEvent,
  NoteTrigger,
  NoteVersionRef,
} from './note-trigger.ts';
export { loggedActionProblem, unarchiveProblem } from './undo-check.ts';
export { AUTOMATION_PRESETS, BLANK_AUTOMATION } from './presets.ts';
