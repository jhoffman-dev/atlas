import { createContext, useContext, type ReactNode } from 'react';
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

/** The chat's switch as handed down, or null where the app offers no chat. */
export function useChatToggle(): ChatToggle | null {
  return useContext(ChatToggleContext);
}

/**
 * The chat's button in a page's bar. Drawn by `PageBarToggles`, as an element
 * rather than a component of its own, so a bar's draw counts one (#238).
 */
export function chatToggleButton(toggle: ChatToggle): ReactNode {
  return (
    <button
      className="icon-button page-bar__button page-bar__chat"
      type="button"
      aria-label="Claude"
      aria-pressed={toggle.open}
      title={toggle.open ? 'Close Claude (⇧⌘J)' : 'Claude beside the page (⇧⌘J)'}
      onClick={toggle.onToggle}
    >
      <Icon name="spark" size={17} />
    </button>
  );
}
