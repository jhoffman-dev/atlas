import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '../icon.tsx';
import { isImeKey } from '../ime.ts';
import type {
  ChatActions,
  ChatHistoryView,
  ChatItemView,
  ChatPanelState,
  ChatProblemView,
} from './chat-view.ts';
import { ProposalCard } from './proposal-card.tsx';

/** The nudge to set a name, and what Claude writes until there is one. */
export interface ChatNameHint {
  readonly placeholder: string;
  readonly onSetName: () => void;
}

/**
 * Claude, beside the work (P27-02): what the chat knows (a chip that can be
 * removed), the conversation with each tool call and proposed change in it,
 * and a box to ask in. It draws; the chat session decides.
 */
export function ChatPanel({
  state,
  model,
  problem,
  history,
  actions,
  loadImage,
  nameHint = null,
}: {
  state: ChatPanelState;
  model: string;
  /** Why the model cannot be reached now, or null when it can. */
  problem: ChatProblemView | null;
  history: ChatHistoryView;
  actions: ChatActions;
  loadImage: (src: string) => Promise<string | null>;
  /** Shown before the first question while Settings → Profile has no name; null otherwise. */
  nameHint?: ChatNameHint | null;
}) {
  const lastAnswer = [...state.items].reverse().find((item) => item.kind === 'assistant');
  return (
    <aside className="chat" aria-label="Claude">
      <ChatBar model={model} history={history} actions={actions} />
      {history.open && <ChatHistory history={history} />}
      {problem !== null && <ProblemNotice problem={problem} onCopy={actions.onCopy} />}
      <div className="chat__log" role="log" aria-label="Conversation">
        {state.items.length === 0 && (
          <p className="chat__empty">
            Ask about what is open, or anything in the vault. Changes are proposed for you to
            accept.
          </p>
        )}
        {state.items.length === 0 && nameHint !== null && <NameHint hint={nameHint} />}
        {state.items.map((item) => (
          <ChatEntry
            key={item.id}
            item={item}
            isLastAnswer={item === lastAnswer && !state.busy}
            actions={actions}
            loadImage={loadImage}
          />
        ))}
        {state.busy && (
          <p className="chat__thinking" role="status">
            Claude is working…
          </p>
        )}
        {state.error !== null && (
          <div className="chat__error" role="alert">
            <p>{state.error.message}</p>
            <button type="button" className="btn btn--sm btn--secondary" onClick={actions.onRetry}>
              <Icon name="retry" size={14} /> Retry
            </button>
          </div>
        )}
        {state.notice !== null && <p className="chat__notice">{state.notice}</p>}
      </div>
      <Composer state={state} actions={actions} />
    </aside>
  );
}

function ChatBar({
  model,
  history,
  actions,
}: {
  model: string;
  history: ChatHistoryView;
  actions: ChatActions;
}) {
  return (
    <header className="chat__bar">
      <Icon name="spark" size={17} className="chat__spark" />
      <span className="chat__name">Claude</span>
      <span className="chat__model" title="The model, set in Settings → Claude">
        {model}
      </span>
      <span className="chat__spacer" />
      <button
        type="button"
        className="icon-button"
        aria-label="Past chats"
        aria-expanded={history.open}
        title="Past chats"
        onClick={() => history.onOpenChange(!history.open)}
      >
        <Icon name="history" size={16} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="New chat"
        title="New chat"
        onClick={actions.onNewChat}
      >
        <Icon name="plus" size={16} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Close Claude"
        title="Close (⌘J)"
        onClick={actions.onClose}
      >
        <Icon name="close" size={15} />
      </button>
    </header>
  );
}

function ChatHistory({ history }: { history: ChatHistoryView }) {
  return (
    <nav className="chat__history" aria-label="Past chats">
      {history.chats.length === 0 ? (
        <p className="chat__history-empty">No chats yet. Each one is kept as a note in Chats/.</p>
      ) : (
        <ul>
          {history.chats.map((chat) => (
            <li key={chat.path}>
              <button type="button" onClick={() => history.onPick(chat.path)}>
                {chat.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

function ProblemNotice({
  problem,
  onCopy,
}: {
  problem: ChatProblemView;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="chat__problem" role="alert">
      <p>{problem.message}</p>
      {problem.fix !== null && (
        <div className="chat__fix">
          <code>{problem.fix}</code>
          <button
            type="button"
            className="icon-button"
            aria-label="Copy the fix"
            title="Copy"
            onClick={() => onCopy(problem.fix ?? '')}
          >
            <Icon name="copy" size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function ChatEntry({
  item,
  isLastAnswer,
  actions,
  loadImage,
}: {
  item: ChatItemView;
  isLastAnswer: boolean;
  actions: ChatActions;
  loadImage: (src: string) => Promise<string | null>;
}) {
  switch (item.kind) {
    case 'user':
      return <p className="chat__you">{item.text}</p>;
    case 'assistant':
      return (
        <div className="chat__claude">
          <p className="chat__text">{item.text}</p>
          <div className="chat__actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Copy answer"
              title="Copy"
              onClick={() => actions.onCopy(item.text)}
            >
              <Icon name="copy" size={14} />
            </button>
            {isLastAnswer && (
              <button
                type="button"
                className="icon-button"
                aria-label="Retry"
                title="Ask again"
                onClick={actions.onRetry}
              >
                <Icon name="retry" size={14} />
              </button>
            )}
          </div>
        </div>
      );
    case 'tool':
      return (
        <div className="chat__tool" data-state={item.state}>
          <Icon name={item.state === 'failed' ? 'close' : 'check'} size={13} />
          <span>{item.label}</span>
          {item.detail !== null && <span className="chat__tool-detail">{item.detail}</span>}
        </div>
      );
    case 'proposal':
      return (
        <ProposalCard
          item={item}
          onAccept={() => actions.onAccept(item.id)}
          onReject={() => actions.onReject(item.id)}
          onUndo={() => actions.onUndo(item.id)}
          onFollowLink={actions.onFollowLink}
          loadImage={loadImage}
        />
      );
  }
}

function Composer({ state, actions }: { state: ChatPanelState; actions: ChatActions }) {
  const [draft, setDraft] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => box.current?.focus(), []);

  const send = () => {
    if (draft.trim() === '' || state.busy) return;
    actions.onSend(draft);
    setDraft('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || isImeKey(event)) return;
    event.preventDefault();
    send();
  };

  return (
    <footer className="chat__composer">
      {state.context !== null && (
        <span className="chat__context">
          <Icon name={state.context.kind === 'note' ? 'doc' : 'table'} size={13} />
          <span className="chat__context-title">{state.context.title}</span>
          <button
            type="button"
            className="chat__context-remove"
            aria-label={`Remove ${state.context.title} from the chat`}
            title="Leave this out"
            onClick={actions.onRemoveContext}
          >
            <Icon name="close" size={11} />
          </button>
        </span>
      )}
      <div className="chat__ask">
        <textarea
          ref={box}
          value={draft}
          rows={2}
          aria-label="Ask Claude"
          placeholder="Ask Claude…"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        {state.busy ? (
          <button
            type="button"
            className="chat__send"
            aria-label="Stop"
            title="Stop"
            onClick={actions.onStop}
          >
            <Icon name="stop" size={14} />
          </button>
        ) : (
          <button
            type="button"
            className="chat__send"
            aria-label="Send"
            title="Send (Enter)"
            disabled={draft.trim() === ''}
            onClick={send}
          >
            <Icon name="up" size={15} />
          </button>
        )}
      </div>
    </footer>
  );
}

function NameHint({ hint }: { hint: ChatNameHint }) {
  return (
    <div className="chat__name-hint">
      <p>
        Claude doesn’t know your name, so where a note needs it, it writes “{hint.placeholder}”
        rather than guess.
      </p>
      <button type="button" className="btn btn--sm btn--secondary" onClick={hint.onSetName}>
        Set your name
      </button>
    </div>
  );
}
