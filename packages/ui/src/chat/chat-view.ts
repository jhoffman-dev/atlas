import type { EditorDocument } from '@atlas/domain';

/**
 * What the chat panel draws, as plain data. The app hands its chat session's
 * state straight in; these name only what the panel reads of it.
 */

export type ProposalBlockView =
  | { readonly kind: 'same' | 'added' | 'removed'; readonly doc: EditorDocument }
  | { readonly kind: 'folded'; readonly count: number };

export interface ProposalView {
  readonly kind: 'edit' | 'note';
  readonly title: string;
  /** The vault path Accept writes. */
  readonly path: string;
  readonly blocks: readonly ProposalBlockView[];
  readonly propertyChanges: readonly {
    readonly key: string;
    readonly before: unknown;
    readonly after: unknown;
  }[];
}

export type ChatItemView =
  | { readonly kind: 'user' | 'assistant'; readonly id: string; readonly text: string }
  | {
      readonly kind: 'tool';
      readonly id: string;
      readonly label: string;
      readonly state: 'running' | 'done' | 'failed';
      readonly detail: string | null;
    }
  | {
      readonly kind: 'proposal';
      readonly id: string;
      readonly proposal: ProposalView;
      readonly state: 'pending' | 'accepting' | 'accepted' | 'rejected' | 'undone';
      readonly problem: string | null;
    };

export interface ChatPanelState {
  readonly items: readonly ChatItemView[];
  readonly busy: boolean;
  readonly error: { readonly message: string } | null;
  readonly context: { readonly kind: string; readonly title: string } | null;
  readonly notice: string | null;
}

/** Why the model cannot be reached, and what fixes it. */
export interface ChatProblemView {
  readonly message: string;
  readonly fix: string | null;
}

export interface ChatHistoryView {
  readonly chats: readonly { readonly path: string; readonly title: string }[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPick: (path: string) => void;
}

/** Everything a person can do in the panel. */
export interface ChatActions {
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
  readonly onRetry: () => void;
  readonly onNewChat: () => void;
  readonly onClose: () => void;
  readonly onRemoveContext: () => void;
  readonly onAccept: (id: string) => void;
  readonly onReject: (id: string) => void;
  readonly onUndo: (id: string) => void;
  readonly onCopy: (text: string) => void;
  readonly onFollowLink: (target: string) => void;
}
