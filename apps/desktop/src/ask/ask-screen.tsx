import { useMemo } from 'react';
import { createVaultPath } from '@dfai/domain';
import type { VaultFsPort } from '@dfai/application';
import { AskPage, type AskActions } from '@dfai/ui';
import type { PageChrome } from '../page-frame-fallback.tsx';
import type { AskSeat } from './ask-seat.tsx';
import { useAskState } from './use-ask-transcript.ts';
import { useRecentQuestions } from './use-recent-questions.ts';

export interface AskScreenProps extends PageChrome {
  readonly seat: AskSeat;
  /** Where the chats are kept: the open vault. */
  readonly fs: VaultFsPort;
  readonly vault: string | null;
}

/** Pictures in a proposed change are drawn as their alt text, as the sidebar chat draws them. */
const noImages = (): Promise<string | null> => Promise.resolve(null);

/**
 * Ask (#37), in a chunk of its own: the chat's state read for citations, the
 * recent questions read from `Chats/`, and the page that draws them.
 */
export function AskScreen({ seat, fs, vault, onShowSidebar, history }: AskScreenProps) {
  const { chat } = seat;
  const { session } = chat;
  const state = useAskState(chat.state);
  const recent = useRecentQuestions({ fs, vault, chatPath: chat.state.chatPath });
  const actions = useMemo<AskActions>(
    () => ({
      onSend: (text) => void session.send(text),
      onStop: () => session.stop(),
      onRetry: () => void session.retry(),
      onNewChat: () => session.newChat(),
      onAccept: (id) => void session.accept(id),
      onReject: (id) => session.reject(id),
      onUndo: (id) => void session.undo(id),
      onCopy: chat.copy,
      onPickRecent: (path) => void session.open(createVaultPath(path)),
      onFollowCitation: seat.onFollowCitation,
      onOpenWeb: seat.onOpenWeb,
      onFollowLink: seat.onFollowLink,
    }),
    [session, chat.copy, seat.onFollowCitation, seat.onOpenWeb, seat.onFollowLink],
  );
  return (
    <AskPage
      state={state}
      model={chat.model}
      problem={chat.problem}
      recent={recent}
      draft={chat.draft}
      actions={actions}
      loadImage={noImages}
      {...(onShowSidebar !== undefined && { onShowSidebar })}
      {...(history !== undefined && { history })}
    />
  );
}
