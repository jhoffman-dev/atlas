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
  proposedWriteRefusal,
  readProposalPayload,
  type NotePayload,
  type NoteProposalKind,
  type ProposalConfidence,
} from '../proposals/proposal.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import type { VaultPath } from '../vault/vault-path.ts';

/** The most proposals one answer may make: more is a model run away, not a meeting. */
export const MAX_PROPOSALS_PER_ANSWER = 25;

/** A note the run was about, as it was read: what a proposal may cite. */
export interface AnsweredNote {
  readonly path: VaultPath;
  readonly text: string;
}

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
  /** One item of the list, or why it is not one. */
  readonly readItem: (value: unknown) => Reading<Item>;
  /** The proposal an item makes, given the notes the run was about. */
  readonly proposalOf: (item: Item, context: AnswerContext) => ProposalDraft;
}

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
      'Cite a block of a note you were given, as [[Note title#^blockid]], using an id that note already has.',
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
  if (!Array.isArray(list)) return refused(`It is not { "${schema.key}": [ … ] }.`);
  if (list.length > MAX_PROPOSALS_PER_ANSWER) {
    return refused(
      `It made ${list.length} proposals; one run makes at most ${MAX_PROPOSALS_PER_ANSWER}.`,
    );
  }
  const checked: CheckedProposal[] = [];
  for (const [at, value] of list.entries()) {
    const item = schema.readItem(value);
    const proposal = item.ok ? checkDraft(schema.proposalOf(item.value, context), context) : item;
    if (!proposal.ok) return refused(`Item ${at + 1}: ${proposal.problem}`);
    checked.push(proposal.value);
  }
  return { ok: true, value: checked };
}

/** The rules every proposal passes, whichever schema made it. */
export function checkDraft(draft: ProposalDraft, context: AnswerContext): Reading<CheckedProposal> {
  const payload = readProposalPayload(draft.kind, draft.payload);
  if (!payload.ok) return payload;
  if ('digest' in payload.payload) return refused('A Claude step proposes new notes only.');
  const { folder } = payload.payload;
  const where = folder === null ? null : proposedWriteRefusal(folder);
  if (where !== null) return refused(where);
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
      payload: payload.payload,
      source: draft.source.trim(),
      confidence,
      why: draft.why.trim(),
    },
  };
}

/**
 * Why `source` does not cite a block of one of `notes`, or null when it
 * does: a link `[[Note#^id]]` to a note the run read, naming an id that note
 * holds. A proposal that cites nothing real cannot be checked against what
 * was said, so it is refused.
 */
export function citedBlockProblem(source: string, notes: readonly AnsweredNote[]): string | null {
  const link = readWikiLink(source.trim());
  // The reader keeps the `#` that starts a link's heading: a block's is `#^id`.
  const id = link?.heading?.startsWith('#^') ? link.heading.slice(2) : null;
  if (link === null || link.embed || id === null || id === '') {
    return `Its source ${JSON.stringify(source)} is not a link to a block, like [[Note#^id]].`;
  }
  const note = notes.find((each) => namesNote(link.target, each.path));
  if (note === undefined) {
    return `Its source cites ${JSON.stringify(link.target)}, which is not a note this run read.`;
  }
  return holdsBlock(note.text, id) ? null : `${noteTitle(note.path)} has no block ^${id}.`;
}

function namesNote(target: string, path: VaultPath): boolean {
  const wanted = target.trim().replace(/\.md$/i, '').toLowerCase();
  const stem = path.replace(/\.md$/i, '').toLowerCase();
  return wanted === stem || wanted === noteTitle(path).toLowerCase();
}

function holdsBlock(text: string, id: string): boolean {
  return text
    .split('\n')
    .some((line) => blockIdAtEnd(line)?.id === id || standaloneBlockAnchor(line.trim()) === id);
}

/**
 * A checked proposal as its note's frontmatter (P29-02's format): open, with
 * what made it, so the Inbox can say where it came from.
 */
export function proposalNoteProperties(
  proposal: CheckedProposal,
  madeBy: string,
): Record<string, unknown> {
  return {
    type: PROPOSAL_TYPE,
    kind: proposal.kind,
    state: 'open',
    confidence: proposal.confidence,
    source: proposal.source,
    made_by: madeBy,
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
