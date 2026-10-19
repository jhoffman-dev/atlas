import {
  useId,
  useLayoutEffect,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Icon } from '../icon.tsx';

/**
 * The aside's tabs, in the order the row draws them. `claude` is the chat's
 * seat (UI v2 plan, open question 4): slice 8a draws the tab and its slot, and
 * slice 8b moves the chat into it.
 */
export type AsideTab = 'properties' | 'backlinks' | 'outline' | 'claude';

const TAB_LABELS: Readonly<Record<AsideTab, string>> = {
  properties: 'Properties',
  backlinks: 'Backlinks',
  outline: 'Outline',
  claude: 'Claude',
};

/** The tabs in the order the row draws them; the app reads it to know which are offered. */
export const ASIDE_TABS: readonly AsideTab[] = ['properties', 'backlinks', 'outline', 'claude'];

/** Where ← → Home and End move the focus along the tabs, as the tab strip's do. */
const STEPS: Readonly<Record<string, (at: number, count: number) => number>> = {
  ArrowLeft: (at, count) => (at - 1 + count) % count,
  ArrowRight: (at, count) => (at + 1) % count,
  Home: () => 0,
  End: (_at, count) => count - 1,
};

/** A chord — ⌘←, ⌥→ — is the app's or the system's, never a walk along the tabs. */
const withModifier = (event: KeyboardEvent) =>
  event.metaKey || event.altKey || event.ctrlKey || event.shiftKey;

/**
 * The right sidebar (brief §5.3, FlowTable.dc.html): a hideable aside on the
 * surface behind a hairline, with a 36px tab row on `bg` — Properties,
 * Backlinks, Outline, and Claude once the chat moves in — then the selected
 * tab's panel. Fixed width, from `--aside-width` (aside.css).
 *
 * A tab is offered only when a panel is given for it, so a surface that has
 * no outline (a table's selected row) shows two tabs rather than an empty
 * third. The tabs are one stop in the Tab order — ← → walk them, Home and End
 * jump — and Enter, Space or a click shows the one under the focus; walking
 * does not show, so a reader can look along the row without turning every
 * page. When the shown tab stops being offered, the first offered one is
 * shown instead, the app is told, and a focus that was on the vanished tab
 * lands on it rather than falling to the page. Escape anywhere inside that
 * nothing inside answered is handed up, for the app to return the focus to
 * the content. Nothing here decides anything: every click is handed up.
 */
export function RightSidebar({
  tab,
  panels,
  onSelectTab,
  onHide,
  onEscape,
}: {
  /** The tab shown; one with no panel falls back to the first offered. */
  tab: AsideTab;
  /** What each tab shows. A tab with no panel — or a null or false one — is not offered. */
  panels: Partial<Record<AsideTab, ReactNode>>;
  onSelectTab: (tab: AsideTab) => void;
  onHide: () => void;
  /** Escape inside the aside that no editor claimed: the app moves the focus back. */
  onEscape?: () => void;
}) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  /** The tab whose button last took the focus, while the focus is in the row. */
  const holding = useRef<AsideTab | null>(null);
  const offered = ASIDE_TABS.filter((each) => Boolean(panels[each]));
  const shown = offered.includes(tab) ? tab : offered[0];

  const focusTab = (at: number) => {
    const tabs = list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[at]?.focus();
  };

  useLayoutEffect(() => {
    if (shown === undefined || shown === tab) return;
    // The shown tab is gone: the app's state catches up, and a focus that was
    // on it — now fallen to the body, since the button is no longer there —
    // lands on the tab shown instead.
    onSelectTab(shown);
    const held = holding.current;
    if (held === null || offered.includes(held)) return;
    holding.current = null;
    const now = document.activeElement;
    if (now === null || now === document.body || list.current?.contains(now))
      focusTab(offered.indexOf(shown));
  });

  const onFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    const held = (event.target as HTMLElement).dataset['tab'];
    holding.current = held === undefined ? null : (held as AsideTab);
  };
  // Once the focus has left the row, a tab going later is not the row's cue to
  // take it back. A move within the row clears, then the focus handler sets.
  const onBlurCapture = () => {
    holding.current = null;
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, at: number) => {
    const step = STEPS[event.key];
    if (step === undefined || withModifier(event)) return;
    event.preventDefault();
    focusTab(step(at, offered.length));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || onEscape === undefined) return;
    event.preventDefault();
    onEscape();
  };

  return (
    <aside className="aside" aria-label="Right sidebar" onKeyDown={onKeyDown}>
      <div className="aside__bar">
        <div
          ref={list}
          role="tablist"
          aria-label="Right sidebar tabs"
          className="aside__tabs"
          onFocusCapture={onFocusCapture}
          onBlurCapture={onBlurCapture}
        >
          {offered.map((each, at) => (
            <button
              key={each}
              type="button"
              role="tab"
              id={`${id}-tab-${each}`}
              data-tab={each}
              aria-selected={each === shown}
              // Only the shown panel is in the page, so only its tab names one.
              aria-controls={each === shown ? `${id}-panel-${each}` : undefined}
              tabIndex={each === shown ? 0 : -1}
              className="aside__tab"
              onClick={() => onSelectTab(each)}
              onKeyDown={(event) => onTabKeyDown(event, at)}
            >
              {TAB_LABELS[each]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-button aside__hide"
          aria-label="Hide right sidebar"
          title="Hide right sidebar (⌥⌘\)"
          onClick={onHide}
        >
          <Icon name="close" size={13} />
        </button>
      </div>
      {shown !== undefined && (
        <div
          role="tabpanel"
          id={`${id}-panel-${shown}`}
          aria-labelledby={`${id}-tab-${shown}`}
          className="aside__panel"
        >
          {panels[shown]}
        </div>
      )}
    </aside>
  );
}
