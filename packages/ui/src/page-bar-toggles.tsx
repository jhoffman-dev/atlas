import { asideToggleButton, useAsideToggle } from './aside/aside-toggle.tsx';
import { chatToggleButton, useChatToggle } from './chat/chat-toggle.tsx';

/**
 * The window's switches at the end of a page's bar — Claude, then the right
 * sidebar — each drawn only where the app offers it. One component for both,
 * reading their contexts here rather than in the bar: a bar is drawn for its
 * page's every change, and these are drawn for a toggle's, which the work
 * budgets count by the component (#238).
 */
export function PageBarToggles() {
  const chat = useChatToggle();
  const aside = useAsideToggle();
  return (
    <>
      {chat !== null && chatToggleButton(chat)}
      {aside !== null && asideToggleButton(aside)}
    </>
  );
}
