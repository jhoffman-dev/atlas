/**
 * What a Claude step's answer may propose (P29-03, ADR-0028), and the one
 * place every kind of answer is checked.
 *
 * A rule's `output:` names a proposal schema. Each schema says what JSON the
 * model is to answer with, how one item of it is read, and what proposal an
 * item makes. Every proposal any schema makes is then held to the same rules
 * here: a payload Accept could write, a confidence, and a source citing a
 * block of a note the run was about. No schema can skip them, so a new one —
 * a meeting's action items (P29-05) — adds its own reading and nothing less.
 *
 * An answer that does not read is refused whole: one bad item and nothing is
 * written.
 */

import { blockIdAtEnd, standaloneBlockAnchor } from '../markdown/block-anchor.ts';
import { readWikiLink } from '../markdown/wikilink-spans.ts';
import {
  PROPOSAL_CONFIDENCES,
  PROPOSAL_TYPE,
  payloadRecord,
  readProposalPayload,
  type NotePayload,
  type NoteProposalKind,
  type ProposalConfidence,
} from '../proposals/proposal.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { shownNotes, type AnsweredNote } from './answered-note.ts';
import {
  lengthProblem,
  MAX_WHY_CHARACTERS,
  noteTextProblem,
  propertiesProblem,
  truncated,
  unknownKeyProblem,
} from './answer-limits.ts';
import { CLAUDE_PROPOSAL_ID_KEY } from './claude-proposal-id.ts';
import { claudeWriteRefusal } from './claude-write-folder.ts';
import { remoteResourceProblem } from './remote-resources.ts';

export type { AnsweredNote };

/** The most proposals one answer may make: more is a model run away, not a meeting. */
export const MAX_PROPOSALS_PER_ANSWER = 25;

/** What an answer is checked against. */
export interface AnswerContext {
  readonly notes: readonly AnsweredNote[];
}

/** What a schema's item proposes, before the shared rules have checked it. */
export interface ProposalDraft {
  readonly kind: NoteProposalKind;
  /** What Accept would write, as a proposal's `payload:` holds it. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** The block it came from, as a link: `[[2026-10-01 Standup#^t0003]]`. */
  readonly source: string;
  readonly confidence: string;
  /** Why it is proposed, in a sentence: the proposal note's body. */
  readonly why: string;
}

/** A proposal that has passed every rule, ready to be written as a note. */
export interface CheckedProposal {
  readonly kind: NoteProposalKind;
  readonly payload: NotePayload;
  readonly source: string;
  readonly confidence: ProposalConfidence;
  readonly why: string;
}

export type Reading<Value> =
  { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly problem: string };

/**
 * A kind of answer a Claude step can give: the extension point for new
 * proposal kinds. `Item` is the schema's own shape; nothing outside sees it.
 */
export interface ProposalSchema<Item> {
  /** What a rule's `output:` calls it. */
  readonly name: string;
  /** The key of the answer's list: `{ "<key>": [ … ] }`. */
  readonly key: string;
  /** What each item is, told to the model after the list's key. */
  readonly itemShape: string;
  /**
   * The keys an item may have. An item with any other is refused, not read
   * with the extra key ignored: it is a guess at what the model meant.
   */
  readonly itemKeys: readonly string[];
  /**
   * How the model is told to cite a block, when the schema cites differently
   * from the default (an item whose `source_block` is its own citation, say).
   * It must still end in a link the shared check can read: `[[Note#^id]]`.
   */
  readonly citation?: string;
  /** One item of the list, or why it is not one. */
  readonly readItem: (value: unknown) => Reading<Item>;
  /**
   * The proposals an item makes, given the notes the run was about: none, one,
   * or several (a meeting's one action item may be a task and a follow-up).
   * Each is held to the shared rules; the answer's total is capped.
   */
  readonly draftsOf: (item: Item, context: AnswerContext) => readonly ProposalDraft[];
}

/** Told to the model so a refusal is rare; the checks hold either way. */
const PLAIN_TEXT = 'Write plain markdown: no images, embeds or HTML. Links are fine.';

const DEFAULT_CITATION =
  'Cite a block of a note you were given, as [[Note title#^blockid]], using an id that note already has.';

/** A schema with its item type closed over: what the registry holds. */
export interface RegisteredProposalSchema {
  readonly name: string;
  /** What the model is told its answer must be. */
  readonly instructions: string;
  readonly read: (answer: string, context: AnswerContext) => Reading<CheckedProposal[]>;
}

/** Closes a schema over its item type, adding the checks every schema's proposals pass. */
export function registerProposalSchema<Item>(
  schema: ProposalSchema<Item>,
): RegisteredProposalSchema {
  return {
    name: schema.name,
    instructions: [
      `Answer with JSON only, and nothing around it: { "${schema.key}": [ … ] }, at most ${MAX_PROPOSALS_PER_ANSWER} items.`,
      `Each item is ${schema.itemShape}`,
      schema.citation ?? DEFAULT_CITATION,
      PLAIN_TEXT,
      `If there is nothing to propose, answer { "${schema.key}": [] }.`,
    ].join('\n'),
    read: (answer, context) => readAnswer({ schema, answer, context }),
  };
}

function readAnswer<Item>({
  schema,
  answer,
  context,
}: {
  schema: ProposalSchema<Item>;
  answer: string;
  context: AnswerContext;
}): Reading<CheckedProposal[]> {
  const parsed = answerJson(answer);
  if (!parsed.ok) return parsed;
  const list = isRecord(parsed.value) ? parsed.value[schema.key] : undefined;
  if (!isRecord(parsed.value) || !Array.isArray(list)) {
    return refused(`It is not { "${schema.key}": [ … ] }.`);
  }
  const extra = unknownKeyProblem(parsed.value, [schema.key], 'The answer');
  if (extra !== null) return refused(extra);
  if (list.length > MAX_PROPOSALS_PER_ANSWER) {
    return refused(
      `It made ${list.length} proposals; one run makes at most ${MAX_PROPOSALS_PER_ANSWER}.`,
    );
  }
  const checked: CheckedProposal[] = [];
  for (const [at, value] of list.entries()) {
    const drafts = draftsOf({ schema, value, context });
    if (!drafts.ok) return refused(`Item ${at + 1}: ${drafts.problem}`);
    for (const draft of drafts.value) {
      const proposal = checkDraft(draft, context);
      if (!proposal.ok) return refused(`Item ${at + 1}: ${proposal.problem}`);
      checked.push(proposal.value);
    }
    if (checked.length > MAX_PROPOSALS_PER_ANSWER) {
      return refused(`It made more than ${MAX_PROPOSALS_PER_ANSWER} proposals in one run.`);
    }
  }
  return { ok: true, value: checked };
}

function draftsOf<Item>({
  schema,
  value,
  context,
}: {
  schema: ProposalSchema<Item>;
  value: unknown;
  context: AnswerContext;
}): Reading<readonly ProposalDraft[]> {
  if (!isRecord(value)) return refused('It is not an object.');
  const extra = unknownKeyProblem(value, schema.itemKeys, 'It');
  if (extra !== null) return refused(extra);
  const item = schema.readItem(value);
  return item.ok ? { ok: true, value: schema.draftsOf(item.value, context) } : item;
}

/** What a payload may hold: a note, and nothing that would edit one. */
const PAYLOAD_KEYS = ['title', 'folder', 'properties', 'body'];

/**
 * The rules every proposal passes, whichever schema made it: new notes only
 * (never a link, which edits a note), a payload Accept could write, held to the
 * sizes and properties a note answer is, loading nothing remote, and citing a
 * block the model was shown.
 */
export function checkDraft(draft: ProposalDraft, context: AnswerContext): Reading<CheckedProposal> {
  // Stated, not left to the payload's shape: "new notes only" is the line between propose and edit.
  if ((draft.kind as string) === 'link') return refused('A Claude step proposes new notes only.');
  const extra = unknownKeyProblem(draft.payload, PAYLOAD_KEYS, 'Its payload');
  if (extra !== null) return refused(extra);
  const payload = readProposalPayload(draft.kind, draft.payload);
  if (!payload.ok) return payload;
  if (!('title' in payload.payload)) return refused('A Claude step proposes new notes only.');
  const note = payload.payload;
  const where = note.folder === null ? null : claudeWriteRefusal(note.folder);
  const content =
    where ??
    noteTextProblem({ title: note.title, body: note.body }) ??
    propertiesProblem(note.properties) ??
    lengthProblem('Its “why”', draft.why, MAX_WHY_CHARACTERS) ??
    remoteResourceProblem(draft.why);
  if (content !== null) return refused(content);
  const confidence = PROPOSAL_CONFIDENCES.find((known) => known === draft.confidence);
  if (confidence === undefined) {
    return refused(`Its confidence is not one of ${PROPOSAL_CONFIDENCES.join(', ')}.`);
  }
  const cited = citedBlockProblem(draft.source, context.notes);
  if (cited !== null) return refused(cited);
  return {
    ok: true,
    value: {
      kind: draft.kind,
      payload: note,
      source: draft.source.trim(),
      confidence,
      why: draft.why.trim(),
    },
  };
}

/**
 * Why `source` does not cite a block of one of `notes`, or null when it
 * does: a link `[[Note#^id]]` to a note the run read, naming an id that note
 * holds in the text the model was shown, outside a code fence. A proposal that cites nothing real cannot be checked against what
 * was said, so it is refused.
 */
export function citedBlockProblem(source: string, notes: readonly AnsweredNote[]): string | null {
  const link = readWikiLink(source.trim());
  // The reader keeps the `#` that starts a link's heading: a block's is `#^id`.
  const id = link?.heading?.startsWith('#^') ? link.heading.slice(2) : null;
  if (link === null || link.embed || id === null || id === '') {
    return `Its source ${JSON.stringify(truncated(source, 200))} is not a link to a block, like [[Note#^id]].`;
  }
  // Only what the model was shown: a block past where the note was cut is a guess.
  const note = shownNotes(notes).find((each) => namesNote(link.target, each.path));
  if (note === undefined) {
    return `Its source cites ${JSON.stringify(truncated(link.target, 200))}, which is not a note this run read.`;
  }
  return holdsBlock(note.text, id)
    ? null
    : `${noteTitle(note.path)} has no block ^${truncated(id, 100)}.`;
}

function namesNote(target: string, path: VaultPath): boolean {
  const wanted = target.trim().replace(/\.md$/i, '').toLowerCase();
  const stem = path.replace(/\.md$/i, '').toLowerCase();
  return wanted === stem || wanted === noteTitle(path).toLowerCase();
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** Whether a line of `text` outside any code fence ends in, or is, the block id `id`. */
function holdsBlock(text: string, id: string): boolean {
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const marker = FENCE.exec(line);
    if (fence !== null) {
      // A fence closes on the same mark, at least as long, with nothing after it.
      if (
        marker !== null &&
        marker[1]![0] === fence[0] &&
        marker[1]!.length >= fence.length &&
        marker[2]!.trim() === ''
      ) {
        fence = null;
      }
      continue;
    }
    if (marker !== null) {
      fence = marker[1]!;
      continue;
    }
    if (blockIdAtEnd(line)?.id === id || standaloneBlockAnchor(line.trim()) === id) return true;
  }
  return false;
}

/**
 * A checked proposal as its note's frontmatter (P29-02's format): open, with
 * what made it, so the Inbox can say where it came from.
 */
export function proposalNoteProperties({
  proposal,
  madeBy,
  id,
}: {
  proposal: CheckedProposal;
  madeBy: string;
  /** What it is for: see {@link claudeProposalId}. */
  id: string;
}): Record<string, unknown> {
  return {
    type: PROPOSAL_TYPE,
    kind: proposal.kind,
    state: 'open',
    confidence: proposal.confidence,
    source: proposal.source,
    made_by: madeBy,
    [CLAUDE_PROPOSAL_ID_KEY]: id,
    payload: payloadRecord(proposal.payload),
  };
}

/**
 * The JSON an answer holds: the whole answer, or one fenced block that is
 * all of it — models fence JSON whatever they are told.
 */
export function answerJson(answer: string): Reading<unknown> {
  const text = answer.trim();
  const fenced = /^```(?:json)?[ \t]*\n([\s\S]*?)\n```$/i.exec(text);
  try {
    return { ok: true, value: JSON.parse(fenced === null ? text : fenced[1]!) as unknown };
  } catch {
    // Not JSON is the answer's problem, said as one; the parser's words add nothing.
    return refused('It is not JSON.');
  }
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function refused(problem: string): { readonly ok: false; readonly problem: string } {
  return { ok: false, problem };
}
