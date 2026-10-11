/**
 * A rule's Claude step (P29-03, ADR-0028), as its file writes it:
 *
 * ```yaml
 * do: claude
 * prompt: .atlas/prompts/meeting-actions.md
 * tools: [atlas_read_note, atlas_search]
 * output: proposals
 * ```
 *
 * The prompt is a note in `.atlas/prompts/`; the tools are some of the chat's
 * read tools; the output names a proposal schema, or `note` with the folder
 * the one new note goes in under `folder:`. A Claude step never edits a note
 * — an output that would is refused here, before the rule can be saved.
 */

import { isChatReadTool, CHAT_READ_TOOLS, type ChatReadTool } from '../chat/read-tool-names.ts';
import { proposedWriteRefusal } from '../proposals/proposal.ts';
import { createVaultPath, InvalidVaultPathError, type VaultPath } from '../vault/vault-path.ts';
import { PROPOSAL_SCHEMAS } from './proposal-schemas.ts';

/** Where a rule's prompts live. */
export const PROMPTS_DIRECTORY = '.atlas/prompts';

/** The most notes one Claude step reads: each is a model's reading, not a file move. */
export const CLAUDE_NOTES_PER_RUN = 10;

/**
 * What a Claude step writes: proposals of a schema, or one new note in a
 * folder. The folder, like the prompt, is text as the editor holds it while
 * it is typed; a rule read from its file has both as vault paths.
 */
export type ClaudeOutput =
  | { readonly kind: 'proposals'; readonly schema: string }
  | { readonly kind: 'note'; readonly folder: string };

export interface ClaudeAction {
  readonly kind: 'claude';
  /** The prompt note, in {@link PROMPTS_DIRECTORY}. */
  readonly prompt: string;
  /**
   * The read tools it may call; none, and it reads only the notes it is
   * handed. Each is one of {@link CHAT_READ_TOOLS} once read from its file.
   */
  readonly tools: readonly string[];
  readonly output: ClaudeOutput;
}

/** Outputs that would change a note already there: refused by name, so the reason is plain. */
const EDITING_OUTPUTS = new Set([
  'edit',
  'edits',
  'update',
  'append',
  'replace',
  'rewrite',
  'overwrite',
  'patch',
  'set',
]);

const NEVER_EDITS =
  'A Claude step never edits a note: it writes proposals for you to accept, or one new note.';

/** The Claude step a rule's frontmatter describes, or why it cannot be one. */
export function readClaudeAction(
  frontmatter: Readonly<Record<string, unknown>>,
): ClaudeAction | string {
  const prompt = readPrompt(frontmatter['prompt']);
  if (typeof prompt === 'string') return prompt;
  const tools = readTools(frontmatter['tools']);
  if (typeof tools === 'string') return tools;
  const output = readOutput(frontmatter);
  if (typeof output === 'string') return output;
  return { kind: 'claude', prompt: prompt.path, tools, output };
}

function readPrompt(value: unknown): { path: VaultPath } | string {
  const written = typeof value === 'string' ? value.trim() : '';
  const wanted = 'Name its prompt: prompt: .atlas/prompts/<name>.md.';
  if (written === '') return wanted;
  const full = written.includes('/') ? written : `${PROMPTS_DIRECTORY}/${written}`;
  const path = pathOrNull(/\.md$/i.test(full) ? full : `${full}.md`);
  const inPrompts =
    path !== null &&
    path.startsWith(`${PROMPTS_DIRECTORY}/`) &&
    !path.slice(PROMPTS_DIRECTORY.length + 1).includes('/');
  return inPrompts ? { path } : wanted;
}

function readTools(value: unknown): ChatReadTool[] | string {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return 'Write tools: as a list, like tools: [atlas_read_note].';
  const tools: ChatReadTool[] = [];
  for (const each of value) {
    const name = typeof each === 'string' ? each.trim() : '';
    if (!isChatReadTool(name)) {
      return `A Claude step may use only the read tools (${CHAT_READ_TOOLS.join(', ')}); “${String(each)}” is not one.`;
    }
    if (!tools.includes(name)) tools.push(name);
  }
  return tools;
}

function readOutput(frontmatter: Readonly<Record<string, unknown>>): ClaudeOutput | string {
  const word = String(frontmatter['output'] ?? '')
    .trim()
    .toLowerCase();
  if (EDITING_OUTPUTS.has(word)) return NEVER_EDITS;
  if (word === 'note') return readNoteOutput(frontmatter);
  if (Object.hasOwn(PROPOSAL_SCHEMAS, word)) return { kind: 'proposals', schema: word };
  const named = ['note', ...Object.keys(PROPOSAL_SCHEMAS)].join(', ');
  return `Say what Claude writes: output: one of ${named}.`;
}

function readNoteOutput(frontmatter: Readonly<Record<string, unknown>>): ClaudeOutput | string {
  // A path names a note already there: writing it would be an edit.
  if (frontmatter['path'] !== undefined && frontmatter['path'] !== null) return NEVER_EDITS;
  const written = typeof frontmatter['folder'] === 'string' ? frontmatter['folder'].trim() : '';
  const folder = written === '' ? null : pathOrNull(written.replace(/\/+$/, ''));
  if (folder === null) return 'Say which folder its note goes in: folder: Briefs.';
  const refusal = proposedWriteRefusal(folder);
  return refusal === null
    ? { kind: 'note', folder }
    : refusal.replace('a proposal', 'a Claude step');
}

function pathOrNull(raw: string): VaultPath | null {
  try {
    return createVaultPath(raw);
  } catch (error) {
    if (error instanceof InvalidVaultPathError) return null;
    throw error;
  }
}

/** The step as its rule's file writes it; every key, so a rule that stops being one loses them. */
export function claudeActionFields(action: ClaudeAction | null): Record<string, unknown> {
  return {
    prompt: action?.prompt ?? null,
    tools: action === null ? null : [...action.tools],
    output: action === null ? null : outputName(action.output),
    folder: action?.output.kind === 'note' ? action.output.folder : null,
  };
}

function outputName(output: ClaudeOutput): string {
  return output.kind === 'note' ? 'note' : output.schema;
}

/** The step in a few words: "Ask Claude (meeting-actions) for proposals". */
export function describeClaudeAction(action: ClaudeAction): string {
  const what =
    action.output.kind === 'note' ? `a note in ${action.output.folder}` : action.output.schema;
  const name = action.prompt.slice(action.prompt.lastIndexOf('/') + 1).replace(/\.md$/i, '');
  return `Ask Claude (${name}) for ${what}`;
}
