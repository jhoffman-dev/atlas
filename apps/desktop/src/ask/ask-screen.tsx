import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
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
  /** The pane this Ask is drawn in: only a request for it takes the keys. */
  readonly pane: number;
}

/** Pictures in a proposed change are drawn as their alt text, as the sidebar chat draws them. */
const noImages = (): Promise<string | null> => Promise.resolve(null);

/**
 * Ask (#37), in a chunk of its own: the chat's state read for citations, the
 * recent questions read from `Chats/`, and the page that draws them.
 */
export function AskScreen({ seat, fs, vault, pane, onShowSidebar, history }: AskScreenProps) {
  const { chat, focus } = seat;
  const { session } = chat;
  const state = useAskState(chat.state);
  const recent = useRecentQuestions({ fs, vault, chatPath: chat.state.chatPath });
  const pick = usePickRecent({ open: session.open, refresh: recent.refresh });
  const asked = useSyncExternalStore(focus.subscribe, focus.latest);
  const focusRequest =
    asked !== null && asked.pane === pane && focus.pending(asked) ? asked.serial : null;
  const onFocusTaken = useCallback(() => {
    if (focusRequest !== null) focus.taken(focusRequest);
  }, [focus, focusRequest]);
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
      onPickRecent: pick.onPick,
      onFollowCitation: seat.onFollowCitation,
      onOpenWeb: seat.onOpenWeb,
      onFollowLink: seat.onFollowLink,
    }),
    [session, chat.copy, pick.onPick, seat.onFollowCitation, seat.onOpenWeb, seat.onFollowLink],
  );
  return (
    <AskPage
      state={state}
      model={chat.model}
      problem={chat.problem}
      recent={recent.recent}
      recentProblem={pick.problem ?? recent.problem}
      draft={chat.draft}
      focusRequest={focusRequest}
      onFocusTaken={onFocusTaken}
      actions={actions}
      loadImage={noImages}
      {...(onShowSidebar !== undefined && { onShowSidebar })}
      {...(history !== undefined && { history })}
    />
  );
}

/**
 * Opens a past question's chat. One that cannot be opened — its note deleted
 * underneath — is said, and the list read again so the row goes.
 */
function usePickRecent({
  open,
  refresh,
}: {
  open: (path: ReturnType<typeof createVaultPath>) => Promise<void>;
  refresh: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const onPick = useCallback(
    (path: string) => {
      setProblem(null);
      open(createVaultPath(path)).catch((error: unknown) => {
        const why = error instanceof Error ? error.message : String(error);
        setProblem(`That chat could not be opened: ${why}`);
        refresh();
      });
    },
    [open, refresh],
  );
  return { onPick, problem };
}
