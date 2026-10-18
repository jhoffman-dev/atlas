import {
  useLayoutEffect,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { Icon, type IconName } from './icon.tsx';

/** One tab as the strip shows it: the app names the place and picks its glyph. */
export interface TabStripTab {
  readonly id: string;
  readonly title: string;
  readonly icon?: IconName | undefined;
}

/** The middle button, as `MouseEvent.button` numbers it. */
const MIDDLE_BUTTON = 1;

/** What a tab with no title yet is called, so it still has a name to be read by. */
const UNTITLED = 'Untitled';

/**
 * The 36px row of tabs over a pane (docs/design/tab-model.md, FlowSplit.dc.html).
 *
 * Square tabs on the strip's `bg`, the shown one lifted onto the surface with
 * a 2px top border: ink while the pane is the focused one, grey while it is
 * the other pane, so one glance says where the next open lands. Only the shown
 * tab wears a ×, for the mouse alone; any tab closes on a middle click, and
 * the focused one on Delete, which is how the keyboard closes. The tabs are
 * one stop in the Tab order — ← and → walk them, Home and End jump — and
 * Enter or Space shows the one under the focus; walking does not show, so a
 * reader can look along the strip without turning every page. When the tab
 * that holds the focus closes, the focus moves to the tab now shown rather
 * than falling off the page. Tabs shrink to 120px, then the strip scrolls.
 * Nothing here decides anything: every click is handed up.
 */
export function TabStrip({
  label,
  tabs,
  active,
  focused,
  onActivate,
  onClose,
  onNew,
}: {
  /** Names the list: "Pane 1 tabs". */
  label: string;
  tabs: readonly TabStripTab[];
  /** The id of the tab shown. */
  active: string;
  /** Whether the pane is the one the next open lands in. */
  focused: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  /** The tab whose button or × last took the focus, while the focus is in the strip. */
  const holding = useRef<string | null>(null);
  // The one Tab stop: the shown tab, or the first while `active` is a stale id.
  const stop = tabs.some((tab) => tab.id === active) ? active : tabs[0]?.id;

  const focusTab = (id: string | undefined) => {
    if (id === undefined || list.current === null) return;
    for (const item of list.current.querySelectorAll<HTMLElement>('[data-tab]')) {
      if (item.dataset['tab'] === id)
        item.querySelector<HTMLButtonElement>('[role="tab"]')?.focus();
    }
  };

  useLayoutEffect(() => {
    const held = holding.current;
    if (held === null || tabs.some((tab) => tab.id === held)) return;
    holding.current = null;
    // Its tab is gone, and so is whatever held the focus: the browser lets it
    // fall to the body. Only when it did — focus the page took is the page's.
    const now = document.activeElement;
    if (now === null || now === document.body || list.current?.contains(now)) focusTab(stop);
  }, [tabs, stop]);

  const onFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    holding.current =
      (event.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset['tab'] ?? null;
  };
  // Once the focus has left the strip for the page, or for nowhere, a tab
  // closing later is not the strip's cue to take it back. A move within the
  // strip clears and then sets again, since the focus handler above follows.
  const onBlurCapture = () => {
    holding.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, at: number) => {
    if (event.key === 'Delete') {
      event.preventDefault();
      onClose(tabs[at]?.id ?? '');
      return;
    }
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    focusTab(tabs[step(at, tabs.length)]?.id);
  };

  const closeOnMiddle = (id: string) => (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button === MIDDLE_BUTTON) onClose(id);
  };
  // A middle press would otherwise start autoscroll on some platforms.
  const noAutoscroll = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button === MIDDLE_BUTTON) event.preventDefault();
  };

  return (
    <div className={focused ? 'tab-strip tab-strip--focused' : 'tab-strip'}>
      <div
        ref={list}
        role="tablist"
        aria-label={label}
        className="tab-strip__tabs"
        onFocusCapture={onFocusCapture}
        onBlurCapture={onBlurCapture}
      >
        {tabs.map((tab, at) => {
          const shown = tab.id === active;
          const title = tab.title.trim() === '' ? UNTITLED : tab.title;
          return (
            <div
              key={tab.id}
              role="presentation"
              data-tab={tab.id}
              className={shown ? 'tab-strip__item tab-strip__item--active' : 'tab-strip__item'}
            >
              <button
                type="button"
                role="tab"
                aria-selected={shown}
                tabIndex={tab.id === stop ? 0 : -1}
                className="tab-strip__tab"
                title={title}
                onClick={() => onActivate(tab.id)}
                onAuxClick={closeOnMiddle(tab.id)}
                onMouseDown={noAutoscroll}
                onKeyDown={(event) => onKeyDown(event, at)}
              >
                {tab.icon === undefined ? null : (
                  <Icon name={tab.icon} size={13} className="tab-strip__icon" />
                )}
                <span className="tab-strip__title">{title}</span>
              </button>
              {shown ? (
                // Mouse only: it is not in the accessibility tree, since a
                // tablist may hold nothing but tabs, and the keyboard closes
                // with Delete on the tab itself.
                <button
                  type="button"
                  className="tab-strip__close"
                  title={`Close ${title}`}
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={() => onClose(tab.id)}
                  onAuxClick={closeOnMiddle(tab.id)}
                  onMouseDown={noAutoscroll}
                >
                  <Icon name="close" size={13} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <button type="button" className="tab-strip__add" aria-label="New tab" onClick={onNew}>
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}

/** Where each key takes the focus from the tab at `at`, among `count` tabs. */
const STEPS: Readonly<Record<string, ((at: number, count: number) => number) | undefined>> = {
  ArrowRight: (at, count) => (at + 1) % count,
  ArrowLeft: (at, count) => (at - 1 + count) % count,
  Home: () => 0,
  End: (_at, count) => count - 1,
};
