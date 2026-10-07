import { createContext, useContext } from 'react';
import { Icon } from '../icon.tsx';

/** Whether the chat is open, and the way to open or close it. */
export interface ChatToggle {
  readonly open: boolean;
  readonly onToggle: () => void;
}

const ChatToggleContext = createContext<ChatToggle | null>(null);

/**
 * Hands the chat's switch to every page's bar at once. A context rather than a
 * prop, because every surface draws its own bar and none of them should have
 * to carry the chat through.
 */
export const ChatToggleProvider = ChatToggleContext.Provider;

/** The chat's button in a page's bar; nothing when the app offers no chat. */
export function ChatToggleButton() {
  const toggle = useContext(ChatToggleContext);
  if (toggle === null) return null;
  return (
    <button
      className="icon-button page-bar__button page-bar__chat"
      type="button"
      aria-label="Claude"
      aria-pressed={toggle.open}
      title={toggle.open ? 'Close Claude (⌘J)' : 'Ask Claude (⌘J)'}
      onClick={toggle.onToggle}
    >
      <Icon name="spark" size={17} />
    </button>
  );
}
