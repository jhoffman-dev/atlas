import {
  claudeStepQuestion,
  claudeStepSystem,
  createVaultPath,
  joinFrontmatter,
  messageWithoutPaths,
  NOTE_ANSWER_INSTRUCTIONS,
  nextAvailableNotePath,
  PROPOSALS_FOLDER,
  proposalNoteProperties,
  proposalSchemaNamed,
  readNoteAnswer,
  splitFrontmatter,
  type AnsweredNote,
  type CheckedProposal,
  type ClaudeAction,
  type ClaudeRunInfo,
  type DoneAction,
  type ModelMessage,
  type NoteAnswer,
  type RegisteredProposalSchema,
  type VaultPath,
} from '@atlas/domain';
import { ModelProviderError, type ModelProvider, type ProviderStatus } from '../chat/ports.ts';
import { runChatTurn } from '../chat/run-chat-turn.ts';
import type { ChatToolbox, Toolboxes } from '../chat/toolbox.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { Clock } from '../ports.ts';
import { ensureFolder } from '../vault/create-folder.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** How long a step may take before it is stopped and failed. */
export const CLAUDE_STEP_TIMEOUT_MS = 5 * 60_000;

/**
 * What a rule's Claude step reaches (P29-03): the provider and model chosen
 * in Settings → Claude as they are when it runs, the read tools the chat's
 * toolbox is built from, and the clock and timer it is timed by.
 */
export interface ClaudeStepPorts {
  readonly provider: () => ModelProvider;
  readonly model: () => string;
  readonly toolboxes: Pick<Toolboxes, 'reading'>;
  readonly clock: Pick<Clock, 'now' | 'today'>;
  /** A signal that aborts once `ms` have passed: the step's time limit. */
  readonly deadline: (ms: number) => AbortSignal;
}

/**
 * A step that failed, with why — in words the person can act on, with no
 * path of this machine's in them — and the model it had asked.
 */
export class ClaudeStepFailed extends Error {
  constructor(
    message: string,
    readonly claude: ClaudeRunInfo,
  ) {
    super(message);
    this.name = 'ClaudeStepFailed';
  }
}

/** A called tool the rule does not let the step use: the run fails rather than carry on. */
class ToolOutsideRule extends Error {}

export interface ClaudeStepOutcome {
  /** What it made: a proposal per line, or the one note. */
  readonly done: readonly DoneAction[];
  readonly claude: ClaudeRunInfo;
}

interface StepArgs {
  readonly ports: ClaudeStepPorts;
  readonly action: ClaudeAction;
  /** The notes the run is about. */
  readonly paths: readonly VaultPath[];
  /** The rule's vault, guarded: a write after another vault opened is refused. */
  readonly fs: VaultFsPort;
  readonly markdown: Pick<MarkdownPort, 'updateFrontmatter'>;
  /** Every note in the vault: what a new note's name is numbered past. */
  readonly notePaths: readonly VaultPath[];
  /** The rule and run, as each proposal's `made_by` says it. */
  readonly madeBy: string;
}

/**
 * Runs a rule's Claude step once (P29-03, ADR-0028): asks the model the
 * rule's prompt about the notes, through the chat's own turn and only the
 * read tools the rule names, and writes what its answer describes —
 * proposals, or one new note — never an edit.
 *
 * Fails with `ClaudeStepFailed`, writing nothing, when the provider cannot
 * be used (with the chat's fix-it words), the prompt cannot be read, the
 * model calls a tool the rule does not list, it is stopped or runs out of
 * time, or its answer does not read as the rule's output.
 */
export async function runClaudeStep(args: StepArgs): Promise<ClaudeStepOutcome> {
  const { ports, action } = args;
  const model = ports.model();
  const started = ports.clock.now();
  const info = (): ClaudeRunInfo => ({ model, ms: Math.max(0, ports.clock.now() - started) });
  const fail = (message: string): never => {
    throw new ClaudeStepFailed(message, info());
  };
  const output = outputOf(action);
  if (output === null) return fail(`There is no output called ${outputName(action)}.`);
  const provider = ports.provider();
  const status = await provider.status();
  if (!status.ready) return fail(fixIt(status));
  const prompt = await readPrompt(args.fs, createVaultPath(action.prompt));
  if (typeof prompt !== 'string') return fail(prompt.problem);
  const notes = await readAnswered(args.fs, args.paths);
  const { instructions } = output;
  const answer = await askModel({ ...args, provider, model, prompt, instructions, notes, fail });
  const done = await writeAnswer({ ...args, output, answer, notes, fail });
  return { done, claude: info() };
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
  return body === '' ? { problem: `Its prompt ${path} is empty.` } : body;
}

async function readAnswered(
  fs: Pick<VaultFsPort, 'readNotes'>,
  paths: readonly VaultPath[],
): Promise<AnsweredNote[]> {
  const files = await fs.readNotes(paths);
  return files.map((file) => ({ path: createVaultPath(file.path), text: file.text }));
}

/** The model's last word, after any tools it called. */
async function askModel({
  ports,
  action,
  provider,
  model,
  prompt,
  instructions,
  notes,
  fail,
}: StepArgs & {
  provider: ModelProvider;
  model: string;
  prompt: string;
  /** What the rule's output needs the answer to be. */
  instructions: string;
  notes: readonly AnsweredNote[];
  fail: (message: string) => never;
}): Promise<string> {
  const signal = ports.deadline(CLAUDE_STEP_TIMEOUT_MS);
  const question: ModelMessage = { role: 'user', text: claudeStepQuestion(notes) };
  try {
    const outcome = await runChatTurn({
      provider,
      toolbox: onlyRuleTools(ports.toolboxes.reading(action.tools), action.tools),
      model,
      system: claudeStepSystem({ today: ports.clock.today(), prompt, answer: instructions }),
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
    ? `Claude did not answer within ${CLAUDE_STEP_TIMEOUT_MS / 60_000} minutes.`
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

/** The rule's output as a run reads it; null for a schema no longer registered. */
function outputOf({ output }: ClaudeAction): StepOutput | null {
  if (output.kind === 'note') {
    const folder = createVaultPath(output.folder);
    return { kind: 'note', instructions: NOTE_ANSWER_INSTRUCTIONS, folder };
  }
  const schema = proposalSchemaNamed(output.schema);
  return schema === null ? null : { kind: 'proposals', instructions: schema.instructions, schema };
}

function outputName(action: ClaudeAction): string {
  return action.output.kind === 'note' ? 'note' : action.output.schema;
}

/** Reads the answer as the rule's output, then writes it: nothing at all when it does not read. */
async function writeAnswer({
  output,
  answer,
  notes,
  fail,
  ...args
}: StepArgs & {
  output: StepOutput;
  answer: string;
  notes: readonly AnsweredNote[];
  fail: (message: string) => never;
}): Promise<DoneAction[]> {
  const unread = (problem: string) =>
    fail(`Claude’s answer is not what the rule asks for. ${problem}`);
  if (output.kind === 'note') {
    const note = readNoteAnswer(answer);
    if (!note.ok) return unread(note.problem);
    return [await writeNote({ ...args, folder: output.folder, note: note.value })];
  }
  const proposals = output.schema.read(answer, { notes });
  if (!proposals.ok) return unread(proposals.problem);
  return writeProposals({ ...args, proposals: proposals.value });
}

type WriteArgs = Pick<StepArgs, 'fs' | 'markdown' | 'notePaths' | 'madeBy'>;

/** Each proposal as a note in `Inbox/Proposals/`, numbered past every name taken. */
async function writeProposals({
  fs,
  markdown,
  notePaths,
  madeBy,
  proposals,
}: WriteArgs & { proposals: readonly CheckedProposal[] }): Promise<DoneAction[]> {
  if (proposals.length === 0) return [];
  const folder = await ensureFolder({ fs, folder: createVaultPath(PROPOSALS_FOLDER) });
  const taken = new Set<string>(notePaths);
  const done: DoneAction[] = [];
  for (const proposal of proposals) {
    const path = nextAvailableNotePath({ folder, name: proposal.payload.title, taken });
    taken.add(path);
    const frontmatter = markdown.updateFrontmatter(null, proposalNoteProperties(proposal, madeBy));
    const body = proposal.why === '' ? '' : `${proposal.why}\n`;
    await fs.createNote({ path, contents: joinFrontmatter(frontmatter, body) });
    done.push({ kind: 'proposed', path });
  }
  return done;
}

/** The one new note, in the rule's folder; a name already taken is numbered past, never written over. */
async function writeNote({
  fs,
  markdown,
  notePaths,
  folder,
  note,
}: WriteArgs & { folder: VaultPath; note: NoteAnswer }): Promise<DoneAction> {
  const at = await ensureFolder({ fs, folder });
  const path = nextAvailableNotePath({ folder: at, name: note.title, taken: new Set(notePaths) });
  const frontmatter =
    Object.keys(note.properties).length === 0
      ? null
      : markdown.updateFrontmatter(null, note.properties);
  await fs.createNote({ path, contents: joinFrontmatter(frontmatter, note.body) });
  return { kind: 'created', path };
}
