import type { AnswerBlock } from '@dfai/domain';
import type { OpenHow } from '../open-how.ts';
import type { ChatActions, ChatItemView, ChatProblemView } from './chat-view.ts';

/**
 * What Ask draws (#37), as plain data: the chat's transcript with each
 * answer already read for its citations by the app.
 */
export interface AskAnswerView {
  readonly kind: 'answer';
  readonly id: string;
  readonly text: string;
  readonly blocks: readonly AnswerBlock[];
  readonly uncited: number;
  /** Finished, and so marked where it cites nothing. */
  readonly checked: boolean;
}

export type AskEntryView =
  | Exclude<ChatItemView, { kind: 'user' | 'assistant' }>
  | AskAnswerView
  | {
      readonly kind: 'user';
      readonly id: string;
      readonly text: string;
    };

export interface AskState {
  readonly entries: readonly AskEntryView[];
  readonly busy: boolean;
  readonly error: { readonly message: string } | null;
  readonly notice: string | null;
}

/** The questions asked before, as the chats they were kept in; null while they are read. */
export type AskRecent = readonly { readonly path: string; readonly title: string }[] | null;

/** What a person can do on Ask: the chat's own, and following what an answer cites. */
export interface AskActions extends Pick<
  ChatActions,
  'onSend' | 'onStop' | 'onRetry' | 'onNewChat' | 'onAccept' | 'onReject' | 'onUndo' | 'onCopy'
> {
  /** Opens a past question's chat. */
  readonly onPickRecent: (path: string) => void;
  /** Follows a citation, `[[Note#^id]]`, where the click asked. */
  readonly onFollowCitation: (link: string, how: OpenHow) => void;
  /** Opens a web address in the browser. */
  readonly onOpenWeb: (url: string) => void;
  /** Follows a link in a proposed change, as the chat does. */
  readonly onFollowLink: (target: string) => void;
}

export type { ChatProblemView };
