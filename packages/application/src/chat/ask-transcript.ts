import { citeAnswer, uncitedCount, type AnswerBlock } from '@dfai/domain';
import { listChats, type ChatSummary } from './chat-history.ts';
import type { ChatItem, ChatState } from './chat-session.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** An answer as Ask shows it (#37): its blocks, each read for whether it cites. */
export interface AskAnswer {
  readonly kind: 'answer';
  readonly id: string;
  /** The answer as the model wrote it: what Copy copies. */
  readonly text: string;
  readonly blocks: readonly AnswerBlock[];
  readonly uncited: number;
  /**
   * Whether the answer is judged for citations. One still arriving is not: a
   * paragraph whose link is a few words away is not uncited yet. Nor is what
   * the model says on its way to a tool ("Let me read it."): that is the
   * model at work, not a claim.
   */
  readonly checked: boolean;
}

/** One entry of Ask's conversation: the chat's own items, with each answer read for citations. */
export type AskEntry = Exclude<ChatItem, { kind: 'assistant' }> | AskAnswer;

/** How many past questions Ask lists. */
export const RECENT_QUESTIONS = 8;

/**
 * The chat's transcript as Ask draws it. `previous` is the last one made:
 * an answer whose text and state have not moved is handed back as it was, so
 * a streamed word re-reads only the answer it lands in.
 */
export function askTranscript(state: ChatState, previous: readonly AskEntry[] = []): AskEntry[] {
  const kept = new Map(previous.map((entry) => [entry.id, entry]));
  const turnStart = state.busy ? lastQuestionAt(state.items) : state.items.length;
  return state.items.map((item, at) => {
    if (item.kind !== 'assistant') return item;
    const checked = at < turnStart && !leadsToTool(state.items[at + 1]);
    const before = kept.get(item.id);
    if (before?.kind === 'answer' && before.text === item.text && before.checked === checked) {
      return before;
    }
    const blocks = citeAnswer(item.text);
    return {
      kind: 'answer',
      id: item.id,
      text: item.text,
      blocks,
      uncited: uncitedCount(blocks),
      checked,
    };
  });
}

function leadsToTool(next: ChatItem | undefined): boolean {
  return next?.kind === 'tool' || next?.kind === 'proposal';
}

function lastQuestionAt(items: readonly ChatItem[]): number {
  for (let at = items.length - 1; at >= 0; at -= 1) if (items[at]?.kind === 'user') return at;
  return 0;
}

/** The questions asked most recently, newest first: the chats kept in `Chats/`, named for them. */
export async function recentQuestions({ fs }: { fs: VaultFsPort }): Promise<ChatSummary[]> {
  return (await listChats({ fs })).slice(0, RECENT_QUESTIONS);
}
