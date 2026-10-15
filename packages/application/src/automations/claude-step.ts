import {
  answeredMeetingOf,
  askedTurnsDigest,
  CLAUDE_STEP_QUESTION,
  claudeAskRefusal,
  claudeAsks,
  claudeNewProposal,
  claudeRunAsks,
  claudeStepBudget,
  claudeStepModel,
  claudeStepSystem,
  claudeSystemProblem,
  claudeWriteRefusal,
  createVaultPath,
  isPromptPath,
  MAX_PROPOSALS_PER_ANSWER,
  messageWithoutPaths,
  MEETING_TYPE,
  NOTE_ANSWER_INSTRUCTIONS,
  proposalSchemaNamed,
  readNoteAnswer,
  splitFrontmatter,
  truncated,
  type AnsweredNote,
  type AnswerReading,
  type AnswerVault,
  type CheckedProposal,
  type ClaudeAction,
  type ClaudeRunInfo,
  type DoneAction,
  type DroppedItem,
  type MeetingTally,
  type ModelMessage,
  type NewProposal,
  type NoteCut,
  type NoteSkipped,
  type PromptData,
  type RegisteredProposalSchema,
  type StoredAnswer,
  type StoredAnswerDraft,
  type VaultPath,
} from '@atlas/domain';
import { ModelProviderError, type ModelProvider, type ProviderStatus } from '../chat/ports.ts';
import { runChatTurn } from '../chat/run-chat-turn.ts';
import type { ChatToolbox, Toolboxes } from '../chat/toolbox.ts';
import { loadLinkDirectory } from '../meeting-links/link-directory.ts';
import type { Clock } from '../ports.ts';
import { loadTerms } from '../terms/terms.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { loadObjectTypes } from '../types/load-types.ts';
import type { NoteWritePorts } from '../proposals/proposal-writes.ts';
import { planProposals, type ProposalWritePorts } from '../proposals/write-proposals.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { planNote, type PlannedNote } from './claude-writes.ts';
import { readMadeItems } from '../meetings/made-items.ts';
import { HeldForPullError } from './fresh-pull-hold.ts';
import {
  decideForMeeting,
  makeOwnersTasks,
  OwnersTasksStopped,
  type MeetingDecided,
  type PlannedTask,
} from './owners-tasks.ts';

/**
 * How long a whole run may take, every ask of it together, before it is
 * stopped and failed: one deadline, so a long meeting read in ten parts
 * cannot take ten times as long.
 */
export const CLAUDE_RUN_TIMEOUT_MS = 10 * 60_000;

/** The longest a prompt note may be: a rule's instructions, not a document. */
export const MAX_PROMPT_CHARACTERS = 20_000;

/**
 * The most proposals one run makes however many parts it read. Taken in the
 * order of the transcript; those past it are left out and the log says how
 * many.
 */
export const MAX_PROPOSALS_PER_RUN = MAX_PROPOSALS_PER_ANSWER;

/**
 * What a rule's Claude step reaches (P29-03): the provider and model chosen
 * in Settings → Claude as they are when it runs (the model, unless the rule
 * or its step's default names another), the read tools the chat's
 * toolbox is built from, and the clock and timer it is timed by.
 */
export interface ClaudeStepPorts {
  readonly provider: () => ModelProvider;
  readonly model: () => string;
  readonly toolboxes: Pick<Toolboxes, 'reading'>;
  /**
   * The vault owner's name, from their profile, as it is when the step runs;
   * null when the profile holds none. What an output that tells "mine" from
   * "someone else's" (P29-05) reads; never guessed (ADR-0024).
   */
  readonly selfName: () => string | null;
  /**
   * The vault owner's own addresses, the vault's `selfEmails`, as they are
   * when the step runs; none when it holds none. Never guessed (ADR-0024).
   */
  readonly selfEmails: () => readonly string[];
  readonly clock: Pick<Clock, 'now' | 'today'>;
  /** A signal that aborts once `ms` have passed: the step's time limit. */
  readonly deadline: (ms: number) => AbortSignal;
}

/** What a step that failed had done by then, and what stopped it when that was not the model's answer. */
export interface ClaudeStepAftermath {
  /** What it had made before it stopped: it stays, and the log must say so. */
  readonly made?: readonly DoneAction[];
  /** The error that stopped it, to be raised once the run is on record. */
  readonly cause?: unknown;
  /** The answers it read in full before it stopped, to be kept so its retry asks nothing again (ADR-0036). */
  readonly stored?: readonly StoredAnswerDraft[];
}

/**
 * A step that failed, with why — in words the person can act on, with no
 * path of this machine's in them, and bounded: a model's words can be long —
 * and the model it had asked.
 */
export class ClaudeStepFailed extends Error {
  readonly made: readonly DoneAction[];
  /** Set when an error other than the model's answer stopped it: raised after the log is written. */
  readonly interruption: unknown;
  readonly stored: readonly StoredAnswerDraft[];

  constructor(
    message: string,
    readonly claude: ClaudeRunInfo,
    { made = [], cause, stored = [] }: ClaudeStepAftermath = {},
  ) {
    super(truncated(message));
    this.name = 'ClaudeStepFailed';
    this.made = made;
    this.interruption = cause;
    this.stored = [...stored];
  }
}

/** A called tool the rule does not let the step use: the run fails rather than carry on. */
class ToolOutsideRule extends Error {}

export interface ClaudeStepOutcome {
  /** What it made: a proposal per line, or the one note. */
  readonly done: readonly DoneAction[];
  /** The notes it did not ask about, and why: a meeting with nothing in it to cite. */
  readonly left: readonly NoteSkipped[];
  readonly claude: ClaudeRunInfo;
}

interface StepArgs extends ProposalWritePorts {
  readonly markdown: MarkdownPort;
  /** The panes: a task is never made from a meeting with unsaved typing in one. */
  readonly editors: NoteWritePorts['editors'];
  readonly ports: ClaudeStepPorts;
  readonly action: ClaudeAction;
  /** The notes the run is about. */
  readonly paths: readonly VaultPath[];
  /** Every note in the vault: what a new note's name is numbered past. */
  readonly notePaths: readonly VaultPath[];
  /** The rule's id: what its proposals are for, so a retry makes none twice. */
  readonly rule: string;
  /** The rule and run, as each proposal's `made_by` says it. */
  readonly madeBy: string;
  /**
   * The asks the step's hourly allowance had spent in the hour before the
   * run, when it has one (#179): the run asks no more than is left. 0 if none.
   */
  readonly askedThisHour?: number;
  /**
   * Asked once every answer is read and planned, right before the first
   * write; it rejects to stop the run with nothing written — the gates of
   * ADR-0035 part 4, shut since the model was asked. Its error is raised as
   * it is, not as the step's failure.
   */
  readonly beforeWrite?: () => Promise<void>;
  /**
   * For the declared step: the answers kept for a meeting's words, by the key
   * its schema knows them by, from a run that read them and could not finish
   * (ADR-0036); null when none are. Reused instead of asking again.
   */
  readonly storedAnswer?: (key: string) => Pick<StoredAnswer, 'answers' | 'parts'> | null;
  /**
   * For the declared step: when the rule's own file was last written, which
   * tells a meeting that arrived since from a backfill (ADR-0036); null when
   * it could not be read, and then every meeting is taken for a backfill.
   */
  readonly ruleSince?: number | null;
}

/**
 * Runs a rule's Claude step once (P29-03, ADR-0028): asks the model the
 * rule's prompt about the notes, through the chat's own turn and only the
 * read tools the rule names, and writes what its answer describes —
 * proposals, or one new note — never an edit.
 *
 * Fails with `ClaudeStepFailed` when the provider cannot be used (with the
 * chat's fix-it words), the action is not one a rule's file could have said,
 * the prompt cannot be read, the model calls a tool the rule does not list,
 * it is stopped or runs out of time, or its answer does not read as the
 * rule's output — in each, having written nothing. The answer is read whole,
 * and every note planned, before the first is written; its proposals are
 * planned by the writer every proposal goes through (`planProposals`), which
 * makes none twice. A meeting among the notes is shown by whole turns, and
 * named to the answer's check as the meeting it is, so a proposal may link
 * back to it; a note cut to fit is said in the run's record. A write that then
 * fails part-way fails the run too, with what it had made in `made` (it
 * stays, and the log says so) and the error in `interruption`; run again, the
 * proposals already made are not made twice.
 *
 * An output that reads meetings turn by turn (`meeting-items`, P29-05) is
 * asked about each note alone, and about a long meeting in parts
 * (`claudeAsks`): several asks, one run. Every answer is read before anything
 * is written, so one that does not read fails the run with nothing made. An
 * item such an output leaves out of an answer it keeps is in the run's record,
 * as is how many times it asked.
 *
 * It asks the model its rule names, else its default (`claudeStepModel`: Sonnet
 * for the declared step, #179), and never more often than its budget lets one
 * run, nor than its hourly allowance has left (`claudeRunAsks`): an ask past
 * either fails the run with nothing written. The declared step plans its
 * notes' parts with one ask kept back, for the reduce (#184).
 *
 * The declared step (`apply: mine`, ADR-0036) makes the owner's own action
 * items into tasks, linked both ways, without a click: which ones is decided
 * in the domain (`decideMeetingItems`), per meeting; what the owner should
 * still see is one review proposal per meeting, and the rest is left out
 * (#226). The tasks are made first, then the proposals. A run
 * that read a meeting's answers in full and then failed keeps them
 * (`ClaudeStepFailed.stored`), and its retry reuses them rather than asking
 * again; one it made some tasks in names them in `made`, and the retry finds
 * them by their `atlas_item` and makes only the rest.
 */
export async function runClaudeStep(args: StepArgs): Promise<ClaudeStepOutcome> {
  const { ports, action } = args;
  const model = claudeStepModel(action, ports.model());
  const budget = claudeStepBudget(action);
  const { askedThisHour = 0 } = args;
  const started = ports.clock.now();
  let cut: readonly NoteCut[] = [];
  let asked = 0;
  const dropped: DroppedItem[] = [];
  const adjusted: DroppedItem[] = [];
  const warnings: string[] = [];
  let alreadyMade = 0;
  const toStore: StoredAnswerDraft[] = [];
  let meetings: readonly MeetingTally[] = [];
  const claudeRun = (): ClaudeRunInfo => ({
    model,
    ms: Math.max(0, ports.clock.now() - started),
    ...(cut.length > 0 && { cut }),
    ...(asked > 0 && { asks: asked }),
    ...(dropped.length > 0 && { dropped: [...dropped] }),
    ...(adjusted.length > 0 && { adjusted: [...adjusted] }),
    ...(warnings.length > 0 && { warnings: [...warnings] }),
    ...(alreadyMade > 0 && { alreadyMade }),
    ...(meetings.length > 0 && { meetings }),
  });
  const fail = (message: string): never => {
    throw new ClaudeStepFailed(message, claudeRun(), { stored: toStore });
  };
  // Defence in depth: the action a run is handed is checked as the file that wrote it was.
  const output = outputOf(action);
  if (typeof output === 'string') return fail(output);
  if (!isPromptPath(action.prompt)) {
    return fail(`Its prompt ${JSON.stringify(action.prompt)} is not a note in .atlas/prompts.`);
  }
  const provider = ports.provider();
  const status = await provider.status();
  if (!status.ready) return fail(fixIt(status));
  const prompt = await readPrompt(args.fs, createVaultPath(action.prompt));
  if (typeof prompt !== 'string') return fail(prompt.problem);
  const notes = await readAnswered(args, args.paths);
  const inParts = output.kind === 'proposals' && output.schema.readsInParts;
  const plan = claudeAsks(notes, { inParts, asks: claudeRunAsks(budget, askedThisHour).parts });
  cut = plan.cut;
  const signal = ports.deadline(CLAUDE_RUN_TIMEOUT_MS);
  const asking = { ...args, provider, model, prompt, output, fail, signal };
  const counted = () => {
    const refused = claudeAskRefusal(budget, asked, askedThisHour);
    if (refused !== null) fail(refused);
    asked += 1;
  };
  if (output.kind === 'proposals')
    warnings.push(...(await missingRelations(args, notes, output.schema)));
  try {
    const answered =
      output.kind === 'note'
        ? await planNoteAnswer({ ...asking, output, notes, counted })
        : await planProposalAnswers({
            ...asking,
            schema: output.schema,
            asks: plan.asks,
            read: notes,
            counted,
            dropped,
            adjusted,
            toStore,
          });
    const { planned, proposed, tasks = [] } = answered;
    if (answered.meetings?.some(({ noTasksBecause }) => noTasksBecause === 'owner-unknown')) {
      warnings.push(OWNER_UNKNOWN_WARNING);
    }
    // What it proposed and the writer left out was made before: said, so a re-ask does not read as an empty answer.
    alreadyMade = Math.max(0, proposed - planned.length);
    await args.beforeWrite?.();
    const done = await writeAll({ args, tasks, planned, claudeRun, stored: toStore });
    meetings = (answered.meetings ?? []).map((meeting) => tallyOf(meeting, tasks, planned));
    return { done, left: plan.skipped, claude: claudeRun() };
  } catch (error) {
    if (error instanceof ClaudeStepFailed || error instanceof HeldForPullError) throw error;
    // Anything else after the model was asked (the index, the disk) still cost an ask: on record, then raised.
    throw new ClaudeStepFailed(messageWithoutPaths(error), claudeRun(), {
      cause: error,
      stored: toStore,
    });
  }
}

/**
 * What the run says, on every run until it is fixed, when the vault does not
 * say who its owner is (#181): no task can be known to be theirs, so none is made.
 */
export const OWNER_UNKNOWN_WARNING =
  'Atlas can’t tell which action items are yours, so it made no tasks: add your name or emails in Settings → Profile.';

/** What the declared step made of one meeting it read: its tasks, its proposals written, and what it left out. */
function tallyOf(
  { path, leftOut }: MeetingRead,
  tasks: readonly PlannedTask[],
  planned: readonly PlannedNote[],
): MeetingTally {
  return {
    path,
    tasks: tasks.filter((task) => task.meeting.path === path).length,
    proposals: planned.filter((note) => note.meeting === path).length,
    ...(leftOut > 0 && { leftOut }),
  };
}

/**
 * What the chat panel shows when the provider cannot be used, in one line.
 * The provider's words may name this machine's paths and are stripped; the
 * fix is Atlas's own command, and a URL in it is no path.
 */
function fixIt(status: Extract<ProviderStatus, { ready: false }>): string {
  const said = messageWithoutPaths(status.message);
  return status.fix === null ? said : `${said} Fix: ${status.fix}`;
}

async function readPrompt(
  fs: Pick<VaultFsPort, 'readTextFile'>,
  path: VaultPath,
): Promise<string | { problem: string }> {
  let text: string;
  try {
    text = (await fs.readTextFile(path)).text;
  } catch {
    // Gone or unreadable is the same to the person: the prompt the rule names is not there.
    return { problem: `Its prompt ${path} could not be read.` };
  }
  const body = splitFrontmatter(text).body.trim();
  if (body === '') return { problem: `Its prompt ${path} is empty.` };
  return body.length > MAX_PROMPT_CHARACTERS
    ? {
        problem: `Its prompt ${path} is ${body.length} characters; a prompt may be at most ${MAX_PROMPT_CHARACTERS}.`,
      }
    : body;
}

/**
 * The notes as they are on disk, each said to be a meeting — and which —
 * when its own frontmatter says so: the run's word, which no answer changes.
 */
async function readAnswered(
  { fs, markdown }: Pick<ProposalWritePorts, 'fs' | 'markdown'>,
  paths: readonly VaultPath[],
): Promise<AnsweredNote[]> {
  const files = await fs.readNotes(paths);
  return files.map((file) => {
    const properties = markdown.frontmatterProperties(splitFrontmatter(file.text).frontmatter);
    const meeting = answeredMeetingOf(properties);
    return {
      path: createVaultPath(file.path),
      text: file.text,
      ...(meeting !== undefined && { meeting }),
    };
  });
}

/** What every ask of one run shares: the step's arguments, and what it read before asking. */
type Asking = StepArgs & {
  provider: ModelProvider;
  model: string;
  prompt: string;
  output: StepOutput;
  fail: (message: string) => never;
  /** Aborts when the run's one deadline passes. */
  signal: AbortSignal;
};

/** The model's last word, after any tools it called. */
async function askModel({
  ports,
  action,
  provider,
  model,
  prompt,
  output,
  notes,
  data = [],
  fail,
  signal,
  counted,
}: Asking & {
  notes: readonly AnsweredNote[];
  /** What the output has Atlas say beside the notes. */
  data?: readonly PromptData[];
  /** Told as the model is asked: not before the system prompt was found to fit. */
  counted: () => void;
}): Promise<string> {
  const question: ModelMessage = { role: 'user', text: CLAUDE_STEP_QUESTION };
  const system = claudeStepSystem({
    today: ports.clock.today(),
    prompt,
    answer: output.instructions,
    notes,
    data,
  });
  const tooLong = claudeSystemProblem(system);
  if (tooLong !== null) return fail(tooLong);
  counted();
  try {
    const outcome = await runChatTurn({
      provider,
      toolbox: onlyRuleTools(ports.toolboxes.reading(action.tools), action.tools),
      model,
      system,
      history: [question],
      signal,
      onEvent: () => {
        // Nobody is watching a rule's run: only its last word counts.
      },
    });
    if (outcome.stopped) return fail(stoppedWords(signal));
    const last = outcome.added.findLast((message) => message.role === 'assistant');
    return last?.role === 'assistant' ? last.text : '';
  } catch (error) {
    if (error instanceof ToolOutsideRule) return fail(error.message);
    // Claude Code's own words can quote its stderr, paths and all.
    if (error instanceof ModelProviderError) return fail(messageWithoutPaths(error));
    throw error;
  }
}

function stoppedWords(signal: AbortSignal): string {
  return signal.aborted
    ? `Claude did not finish within ${CLAUDE_RUN_TIMEOUT_MS / 60_000} minutes.`
    : 'Claude’s run was stopped before it answered.';
}

/**
 * The rule's read tools, as the toolbox runs them. A call to any other —
 * one the chat has, or one that does not exist — fails the run: the model
 * reached past what the rule allows, and nothing it then says is trusted.
 */
function onlyRuleTools(toolbox: ChatToolbox, tools: readonly string[]): ChatToolbox {
  return {
    specs: toolbox.specs,
    run: async (call) => {
      if (!tools.includes(call.name)) {
        throw new ToolOutsideRule(
          `Claude called ${call.name}, which this rule does not let it use.`,
        );
      }
      return toolbox.run(call);
    },
  };
}

/** What a step's answer must be, and how it is read: one new note, or a schema's proposals. */
type StepOutput =
  | { readonly kind: 'note'; readonly instructions: string; readonly folder: VaultPath }
  | {
      readonly kind: 'proposals';
      readonly instructions: string;
      readonly schema: RegisteredProposalSchema;
    };

/** The rule's output as a run reads it, or why it cannot be run: a schema no longer registered, a folder no step writes in. */
function outputOf({ output }: ClaudeAction): StepOutput | string {
  if (output.kind === 'note') {
    const refusal = claudeWriteRefusal(output.folder);
    if (refusal !== null) return refusal;
    return {
      kind: 'note',
      instructions: NOTE_ANSWER_INSTRUCTIONS,
      folder: createVaultPath(output.folder),
    };
  }
  const schema = proposalSchemaNamed(output.schema);
  return schema === null
    ? `There is no output called ${output.schema}.`
    : { kind: 'proposals', instructions: schema.instructions, schema };
}

const unreadWords = (problem: string): string =>
  `Claude’s answer is not what the rule asks for. ${problem}`;

/** The notes an answer makes, and how many proposals it held — more than are planned when some were made before. */
interface AnswerPlanned {
  readonly planned: readonly PlannedNote[];
  readonly proposed: number;
  /** For the declared step: the owner's tasks to make, before the proposals are written. */
  readonly tasks?: readonly PlannedTask[];
  /** For the declared step: each meeting it read, in order, for the log to say what it made of each. */
  readonly meetings?: readonly MeetingRead[];
}

/** A meeting the declared step read: how many of its items it left out, and why it could make no task, if it could not. */
interface MeetingRead {
  readonly path: VaultPath;
  readonly leftOut: number;
  readonly noTasksBecause: MeetingDecided['noTasksBecause'];
}

/** Asks once for the rule's one new note, and plans it: nothing is written yet. */
async function planNoteAnswer({
  notes,
  counted,
  ...asking
}: Asking & {
  output: Extract<StepOutput, { kind: 'note' }>;
  notes: readonly AnsweredNote[];
  counted: () => void;
}): Promise<AnswerPlanned> {
  const note = readNoteAnswer(await askModel({ ...asking, notes, counted }));
  if (!note.ok) return asking.fail(unreadWords(note.problem));
  const planned = await planNote({
    ports: asking,
    notePaths: asking.notePaths,
    folder: asking.output.folder,
    note: note.value,
  });
  return { planned: [planned], proposed: 0 };
}

/** What every proposal answer of a run is read with. */
type ProposalAsking = Asking & {
  schema: RegisteredProposalSchema;
  asks: readonly (readonly AnsweredNote[])[];
  /** Every note the run read, whole: what a meeting's stored answers are read against. */
  read: readonly AnsweredNote[];
  /** Told each time the model is asked. */
  counted: () => void;
  /** Gains the items each answer left out. */
  dropped: DroppedItem[];
  /** Gains the items each answer kept with a fault put right. */
  adjusted: DroppedItem[];
  /** Gains the answers about each meeting the declared step read in full, to be kept if the run fails. */
  toStore: StoredAnswerDraft[];
};

/**
 * Reads every answer of the run as the schema's proposals, and plans them
 * all: nothing is written until every answer has read. An answer that does
 * not read fails the run, saying which part it was. The declared step then
 * decides, meeting by meeting, which of the owner's items are made tasks;
 * the rest are planned as proposals.
 */
async function planProposalAnswers(asking: ProposalAsking): Promise<AnswerPlanned> {
  const vault = asking.schema.readsVault ? await readVault(asking) : undefined;
  const answered = await readAnswers(asking, vault);
  const declared = asking.action.apply === 'mine';
  const decided: readonly MeetingDecided[] = declared
    ? await decideOwnersItems(asking, answered, vault)
    : answered.map(({ path, proposals }) => ({
        meeting: path,
        tasks: [],
        proposals,
        leftOut: 0,
        noTasksBecause: null,
      }));
  const meetingOf = new Map<string, VaultPath>();
  const drafted = cappedForRun(
    decided.flatMap(({ meeting, proposals }) =>
      proposals.map((proposal) => {
        const drafted = claudeNewProposal({ rule: asking.rule, madeBy: asking.madeBy, proposal });
        meetingOf.set(drafted.id, meeting);
        return drafted;
      }),
    ),
    asking.dropped,
  );
  const { planned, left } = await planProposals({
    fs: asking.fs,
    index: asking.index,
    markdown: asking.markdown,
    proposals: drafted,
  });
  // One that cannot be made a note of fails the run before anything is written.
  if (left.length > 0) return asking.fail(`A proposal could not be written: ${left[0]!.reason}`);
  // An id given twice in one answer is one proposal: only those made before this run are "already made".
  const proposed = new Set(drafted.map(({ id }) => id)).size;
  return {
    planned: planned.map(({ path, contents, id }) => ({
      path,
      contents,
      made: { kind: 'proposed', path },
      ...(declared && { meeting: meetingOf.get(id)! }),
    })),
    proposed,
    ...(declared && {
      tasks: decided.flatMap(({ tasks }) => tasks),
      meetings: decided.map(({ meeting, leftOut, noTasksBecause }) => ({
        path: meeting,
        leftOut,
        noTasksBecause,
      })),
    }),
  };
}

/** The proposals the answers about one note hold. */
interface NoteAnswered {
  readonly path: VaultPath;
  readonly proposals: readonly CheckedProposal[];
}

/**
 * Asks each of the run's asks in turn and reads every answer, note by note.
 * The declared step first looks for the answers kept for a meeting's words
 * (`storedAnswer`): when this run would ask about the very turns they
 * answered, they are read again as the domain reads them now and nothing is
 * asked. Kept answers to other turns — the meeting is cut differently now —
 * or that no longer read are asked again. The answers about each meeting it
 * asked are added to `toStore`, with the turns each part showed.
 */
async function readAnswers(
  asking: ProposalAsking,
  vault: AnswerVault | undefined,
): Promise<NoteAnswered[]> {
  const answered: NoteAnswered[] = [];
  const total = asking.asks.length;
  let at = 0;
  for (const group of asksByNote(asking.asks)) {
    const note = asking.read.find((each) => each.path === group.path);
    const key = asking.action.apply === 'mine' && note !== undefined ? keyOf(asking, note) : null;
    const kept = key === null ? null : (asking.storedAnswer?.(key) ?? null);
    const reused = kept === null ? null : rereadKept(asking, group.asks, kept, vault);
    if (reused !== null) {
      answered.push({ path: group.path, proposals: reused });
      continue;
    }
    const answers: string[] = [];
    const proposals: CheckedProposal[] = [];
    for (const notes of group.asks) {
      at += 1;
      const context = { notes, ...(vault !== undefined && { vault }) };
      const data = asking.schema.dataFor(context);
      const answer = await askModel({ ...asking, notes, data, counted: asking.counted });
      const reading = asking.schema.read(answer, context);
      if (!reading.ok) {
        const part = total > 1 ? `Ask ${at} of ${total}: ` : '';
        return asking.fail(unreadWords(`${part}${reading.problem}`));
      }
      proposals.push(...keptItems(asking, reading));
      answers.push(answer);
    }
    if (key !== null) {
      asking.toStore.push({
        key,
        answers,
        parts: group.asks.map((notes) => askedTurnsDigest(notes)),
      });
    }
    answered.push({ path: group.path, proposals });
  }
  return answered;
}

/** The key a meeting's words are known by, as the schema names them; null for a note it names none. */
function keyOf({ schema }: ProposalAsking, note: AnsweredNote): string | null {
  return schema.handledKeyOf?.(note) ?? null;
}

/**
 * A meeting's kept answers read again, each against the part this run would
 * ask it about, with the vault as it is now — only when those parts show the
 * very turns the answers were given about. Null otherwise, or when one no
 * longer reads, so the meeting is asked again rather than read in part.
 */
function rereadKept(
  asking: ProposalAsking,
  asks: readonly (readonly AnsweredNote[])[],
  kept: Pick<StoredAnswer, 'answers' | 'parts'>,
  vault: AnswerVault | undefined,
): CheckedProposal[] | null {
  const sameTurns =
    kept.parts.length === asks.length &&
    kept.answers.length === asks.length &&
    asks.every((notes, at) => askedTurnsDigest(notes) === kept.parts[at]);
  if (!sameTurns) return null;
  const readings = asks.map((notes, at) =>
    asking.schema.read(kept.answers[at]!, { notes, ...(vault !== undefined && { vault }) }),
  );
  if (readings.some((reading) => !reading.ok)) return null;
  return readings.flatMap((reading) => (reading.ok ? keptItems(asking, reading) : []));
}

/** An answer's proposals, with what it left out and put right added to the run's record. */
function keptItems(
  { dropped, adjusted }: ProposalAsking,
  reading: Extract<AnswerReading, { ok: true }>,
): readonly CheckedProposal[] {
  dropped.push(...reading.dropped);
  adjusted.push(...reading.adjusted);
  return reading.value;
}

/** The asks grouped by the note each is about, in order: a long meeting's parts are one group. */
function asksByNote(
  asks: readonly (readonly AnsweredNote[])[],
): { path: VaultPath; asks: (readonly AnsweredNote[])[] }[] {
  const groups: { path: VaultPath; asks: (readonly AnsweredNote[])[] }[] = [];
  for (const notes of asks) {
    const path = notes[0]?.path;
    if (path === undefined) continue;
    const last = groups.at(-1);
    if (last?.path === path) last.asks.push(notes);
    else groups.push({ path, asks: [notes] });
  }
  return groups;
}

/**
 * Decides, meeting by meeting, which of the owner's items become tasks
 * (`decideForMeeting`): the tasks already made are read once for them all.
 */
async function decideOwnersItems(
  asking: ProposalAsking,
  answered: readonly NoteAnswered[],
  vault: AnswerVault | undefined,
): Promise<MeetingDecided[]> {
  const made = await readMadeItems(asking);
  const owner = {
    selfName: vault?.selfName ?? null,
    selfEmails: vault?.selfEmails ?? [],
    people: vault?.people ?? [],
  };
  const decided: MeetingDecided[] = [];
  for (const { path, proposals } of answered) {
    decided.push(
      await decideForMeeting({
        ports: asking,
        meeting: path,
        proposals,
        owner,
        made,
        ruleSince: asking.ruleSince ?? null,
        notePaths: asking.notePaths,
        today: asking.ports.clock.today(),
      }),
    );
  }
  return decided;
}

/**
 * The first {@link MAX_PROPOSALS_PER_RUN} different proposals, in the order
 * they were read (the transcript's, part by part); the count left out is
 * added to `dropped`, so the log says it.
 */
function cappedForRun(proposals: readonly NewProposal[], dropped: DroppedItem[]): NewProposal[] {
  const unique = [...new Map(proposals.map((proposal) => [proposal.id, proposal])).values()];
  if (unique.length <= MAX_PROPOSALS_PER_RUN) return proposals as NewProposal[];
  const left = unique.length - MAX_PROPOSALS_PER_RUN;
  dropped.push({
    title: `${left} more ${left === 1 ? 'proposal' : 'proposals'}`,
    reason: `one run makes at most ${MAX_PROPOSALS_PER_RUN}, across all the parts it read; run again for the rest.`,
  });
  const kept = new Set(unique.slice(0, MAX_PROPOSALS_PER_RUN).map(({ id }) => id));
  return proposals.filter(({ id }) => kept.has(id));
}

/**
 * What the run says to the person when proposals could not be joined to
 * their meetings on Accept: the vault's Meeting type lacks a relation the
 * output links through. Said once for the run; the proposals are still made.
 */
async function missingRelations(
  { fs, markdown }: Pick<ProposalWritePorts, 'fs' | 'markdown'>,
  notes: readonly AnsweredNote[],
  schema: RegisteredProposalSchema,
): Promise<string[]> {
  if (schema.meetingRelations.length === 0 || !notes.some((note) => note.meeting?.identity)) {
    return [];
  }
  const types = await loadObjectTypes({ fs, markdown });
  const meetingType = types.find((type) => type.name.trim().toLowerCase() === MEETING_TYPE);
  const have = new Set(
    (meetingType?.properties ?? [])
      .filter((property) => property.kind === 'relation')
      .map((property) => property.key),
  );
  const missing = schema.meetingRelations.filter((relation) => !have.has(relation));
  if (missing.length === 0) return [];
  return [
    `The Meeting type has no ${missing.map((key) => `“${key}”`).join(' or ')} relation, so Accept cannot add what these proposals make to their meeting (and refuses them until it does).`,
  ];
}

/**
 * What the run knows of the vault for an output that reads it: its people and
 * terms from the index, its notes, and its owner's name and addresses from
 * the vault's settings.
 */
async function readVault({
  ports,
  index,
  notePaths,
}: Pick<StepArgs, 'ports' | 'index' | 'notePaths'>): Promise<AnswerVault> {
  const { people } = await loadLinkDirectory({ index });
  const { terms } = await loadTerms({ index });
  return {
    selfName: ports.selfName(),
    selfEmails: ports.selfEmails(),
    people,
    notePaths,
    terms: terms.map((term) => term.canonical),
  };
}

/**
 * Makes the owner's tasks, then writes each planned note. A task that cannot
 * be made, or a note the disk refuses, stops the run with those already made
 * reported — they stay — so the log names everything the step left behind. A
 * task refused in words (the meeting was edited, or is being typed in) fails
 * the run plainly; any other fault is raised once the run is on record.
 */
async function writeAll({
  args,
  tasks,
  planned,
  claudeRun,
  stored,
}: {
  args: StepArgs;
  tasks: readonly PlannedTask[];
  planned: readonly PlannedNote[];
  claudeRun: () => ClaudeRunInfo;
  stored: readonly StoredAnswerDraft[];
}): Promise<DoneAction[]> {
  let made: DoneAction[];
  try {
    made = await makeOwnersTasks({
      ports: args,
      tasks,
      notePaths: args.notePaths,
      today: args.ports.clock.today(),
    });
  } catch (error) {
    if (!(error instanceof OwnersTasksStopped)) throw error;
    const cause = error.refused ? {} : { cause: error.reason };
    throw new ClaudeStepFailed(error.message, claudeRun(), { made: error.made, stored, ...cause });
  }
  for (const note of planned) {
    try {
      await args.fs.createNote({ path: note.path, contents: note.contents });
    } catch (cause) {
      const notes = made.length - tasks.length;
      const said = `Made ${notes} of ${planned.length} notes, then the write failed: ${messageWithoutPaths(cause)}`;
      throw new ClaudeStepFailed(said, claudeRun(), { made, cause, stored });
    }
    made = [...made, note.made];
  }
  return made;
}
