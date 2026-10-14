import {
  answeredMeetingOf,
  CLAUDE_STEP_QUESTION,
  claudeAskRefusal,
  claudeAsks,
  claudeNewProposal,
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
  type AnswerVault,
  type CheckedProposal,
  type ClaudeAction,
  type ClaudeRunInfo,
  type DoneAction,
  type DroppedItem,
  type ModelMessage,
  type NewProposal,
  type NoteCut,
  type NoteSkipped,
  type PromptData,
  type RegisteredProposalSchema,
  type VaultPath,
} from '@atlas/domain';
import { ModelProviderError, type ModelProvider, type ProviderStatus } from '../chat/ports.ts';
import { runChatTurn } from '../chat/run-chat-turn.ts';
import type { ChatToolbox, Toolboxes } from '../chat/toolbox.ts';
import { loadLinkDirectory } from '../meeting-links/link-directory.ts';
import type { Clock } from '../ports.ts';
import { loadTerms } from '../terms/terms.ts';
import { loadObjectTypes } from '../types/load-types.ts';
import { planProposals, type ProposalWritePorts } from '../proposals/write-proposals.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { planNote, type PlannedNote } from './claude-writes.ts';

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

  constructor(
    message: string,
    readonly claude: ClaudeRunInfo,
    { made = [], cause }: ClaudeStepAftermath = {},
  ) {
    super(truncated(message));
    this.name = 'ClaudeStepFailed';
    this.made = made;
    this.interruption = cause;
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
 * run (`claudeStepBudget`): an ask past it fails the run with nothing written.
 */
export async function runClaudeStep(args: StepArgs): Promise<ClaudeStepOutcome> {
  const { ports, action } = args;
  const model = claudeStepModel(action, ports.model());
  const budget = claudeStepBudget(action);
  const started = ports.clock.now();
  let cut: readonly NoteCut[] = [];
  let asked = 0;
  const dropped: DroppedItem[] = [];
  const adjusted: DroppedItem[] = [];
  const warnings: string[] = [];
  let alreadyMade = 0;
  const claudeRun = (): ClaudeRunInfo => ({
    model,
    ms: Math.max(0, ports.clock.now() - started),
    ...(cut.length > 0 && { cut }),
    ...(asked > 0 && { asks: asked }),
    ...(dropped.length > 0 && { dropped: [...dropped] }),
    ...(adjusted.length > 0 && { adjusted: [...adjusted] }),
    ...(warnings.length > 0 && { warnings: [...warnings] }),
    ...(alreadyMade > 0 && { alreadyMade }),
  });
  const fail = (message: string): never => {
    throw new ClaudeStepFailed(message, claudeRun());
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
  const plan = claudeAsks(notes, { inParts, asks: budget.asksPerRun });
  cut = plan.cut;
  const signal = ports.deadline(CLAUDE_RUN_TIMEOUT_MS);
  const asking = { ...args, provider, model, prompt, output, fail, signal };
  const counted = () => {
    const refused = claudeAskRefusal(budget, asked);
    if (refused !== null) fail(refused);
    asked += 1;
  };
  if (output.kind === 'proposals')
    warnings.push(...(await missingRelations(args, notes, output.schema)));
  try {
    const { planned, proposed } =
      output.kind === 'note'
        ? await planNoteAnswer({ ...asking, output, notes, counted })
        : await planProposalAnswers({
            ...asking,
            schema: output.schema,
            asks: plan.asks,
            counted,
            dropped,
            adjusted,
          });
    // What it proposed and the writer left out was made before: said, so a re-ask does not read as an empty answer.
    alreadyMade = Math.max(0, proposed - planned.length);
    const done = await writePlanned({ fs: args.fs, planned, claudeRun });
    return { done, left: plan.skipped, claude: claudeRun() };
  } catch (error) {
    if (error instanceof ClaudeStepFailed) throw error;
    // Anything else after the model was asked (the index, the disk) still cost an ask: on record, then raised.
    throw new ClaudeStepFailed(messageWithoutPaths(error), claudeRun(), { cause: error });
  }
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

/**
 * Asks each of the run's asks in turn, reads every answer as the schema's
 * proposals, and plans them all: nothing is written until every answer has
 * read. An answer that does not read fails the run, saying which part it was.
 */
async function planProposalAnswers({
  schema,
  asks,
  counted,
  dropped,
  adjusted,
  ...asking
}: Asking & {
  schema: RegisteredProposalSchema;
  asks: readonly (readonly AnsweredNote[])[];
  /** Told each time the model is asked. */
  counted: () => void;
  /** Gains the items each answer left out. */
  dropped: DroppedItem[];
  /** Gains the items each answer kept with a fault put right. */
  adjusted: DroppedItem[];
}): Promise<AnswerPlanned> {
  const vault = schema.readsVault ? await readVault(asking) : undefined;
  const proposals: CheckedProposal[] = [];
  for (const [at, notes] of asks.entries()) {
    const context = { notes, ...(vault !== undefined && { vault }) };
    const answer = await askModel({ ...asking, notes, data: schema.dataFor(context), counted });
    const read = schema.read(answer, context);
    if (!read.ok) {
      const part = asks.length > 1 ? `Ask ${at + 1} of ${asks.length}: ` : '';
      return asking.fail(unreadWords(`${part}${read.problem}`));
    }
    proposals.push(...read.value);
    dropped.push(...read.dropped);
    adjusted.push(...read.adjusted);
  }
  const drafted = cappedForRun(
    proposals.map((proposal) =>
      claudeNewProposal({ rule: asking.rule, madeBy: asking.madeBy, proposal }),
    ),
    dropped,
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
    planned: planned.map((note) => ({ ...note, made: { kind: 'proposed', path: note.path } })),
    proposed,
  };
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
 * terms from the index, its notes, and its owner's name from their profile.
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
    people,
    notePaths,
    terms: terms.map((term) => term.canonical),
  };
}

/**
 * Writes each planned note in turn. One the disk refuses stops the run, with
 * those already made reported — they stay — so the log names every note the
 * step left behind.
 */
async function writePlanned({
  fs,
  planned,
  claudeRun,
}: {
  fs: Pick<VaultFsPort, 'createNote'>;
  planned: readonly PlannedNote[];
  claudeRun: () => ClaudeRunInfo;
}): Promise<DoneAction[]> {
  const made: DoneAction[] = [];
  for (const note of planned) {
    try {
      await fs.createNote({ path: note.path, contents: note.contents });
    } catch (cause) {
      const said = `Made ${made.length} of ${planned.length} notes, then the write failed: ${messageWithoutPaths(cause)}`;
      throw new ClaudeStepFailed(said, claudeRun(), { made, cause });
    }
    made.push(note.made);
  }
  return made;
}
