import {
  isMeetingType,
  MEETING_EXTRACTION_PROMPT,
  splitFrontmatter,
  type ClaudeAction,
  type DroppedItem,
  type NoteSkipped,
  type VaultPath,
} from '@dfai/domain';
import { runClaudeStep, type ClaudeStepPorts } from '../automations/claude-step.ts';
import type { NoteWritePorts } from '../proposals/proposal-writes.ts';
import type { ProposalWritePorts } from '../proposals/write-proposals.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import { VaultAccessError } from '../vault/ports.ts';
import { AssistantEntityError } from './read-entity.ts';

/**
 * What its proposals are for, so asking again proposes nothing twice. The
 * meeting-items schema leaves the rule out of a proposal's id (it is shared
 * across rules), so an item the meeting extraction rule proposed already is
 * not proposed again here either.
 */
export const PROPOSE_TASKS_RULE = 'assistant-propose-tasks';

/**
 * The P29-05 extraction, as one meeting's Claude step: the built-in prompt,
 * no tools, every item a proposal. Never `apply: mine` — on demand, nothing
 * is made without an Accept.
 */
const MEETING_TASKS: ClaudeAction = {
  kind: 'claude',
  prompt: MEETING_EXTRACTION_PROMPT,
  tools: [],
  output: { kind: 'proposals', schema: 'meeting-items' },
};

/** What drafting one meeting's tasks came to. */
export interface ProposedTasks {
  readonly meeting: VaultPath;
  /** The proposals written into `Inbox/Proposals/`. */
  readonly proposed: readonly VaultPath[];
  /** How many the answer held that were proposed before — open or answered — and so were not again. */
  readonly alreadyProposed: number;
  /** Items left out of the answer, each with why: one citing no turn of this meeting, say. */
  readonly dropped: readonly DroppedItem[];
  /** Why the meeting was not asked about at all — a meeting with no transcript to cite. */
  readonly left: readonly NoteSkipped[];
  readonly warnings: readonly string[];
}

/**
 * Drafts the tasks, waiting-fors, decisions and follow-ups of one meeting as
 * proposals (P32-05): the meeting extraction (P29-05) run on demand, its
 * answer checked against the meeting's own turns. Only proposals are
 * written; each waits in the Inbox for Accept.
 *
 * Refuses, writing nothing, a note that is not there or not a meeting
 * (`AssistantEntityError`), and fails as the step fails (`ClaudeStepFailed`):
 * no provider ready, an answer that does not read.
 */
export async function proposeMeetingTasks({
  ports,
  claude,
  meeting,
  madeBy,
}: {
  ports: ProposalWritePorts & Pick<NoteWritePorts, 'editors'> & { markdown: MarkdownPort };
  claude: ClaudeStepPorts;
  meeting: VaultPath;
  /** Who asked, as each proposal's `made_by` says it. */
  madeBy: string;
}): Promise<ProposedTasks> {
  await refuseUnlessMeeting(ports, meeting);
  const outcome = await runClaudeStep({
    ...ports,
    ports: claude,
    action: MEETING_TASKS,
    paths: [meeting],
    notePaths: await listVaultNotes({ fs: ports.fs }),
    rule: PROPOSE_TASKS_RULE,
    madeBy,
  });
  return {
    meeting,
    proposed: outcome.done.flatMap((done) => (done.kind === 'proposed' ? [done.path] : [])),
    alreadyProposed: outcome.claude.alreadyMade ?? 0,
    dropped: outcome.claude.dropped ?? [],
    left: outcome.left,
    warnings: outcome.claude.warnings ?? [],
  };
}

async function refuseUnlessMeeting(
  { fs, markdown }: { fs: ProposalWritePorts['fs']; markdown: MarkdownPort },
  path: VaultPath,
): Promise<void> {
  const text = await fs.readTextFile(path).then(
    (read) => read.text,
    (error: unknown) => {
      if (error instanceof VaultAccessError) {
        throw new AssistantEntityError('not_found', `No note at ${path}`);
      }
      throw error;
    },
  );
  const type = markdown.frontmatterProperties(splitFrontmatter(text).frontmatter)['type'];
  if (!isMeetingType(type)) {
    throw new AssistantEntityError('not_a_page', `${path} is not a meeting note.`);
  }
}
