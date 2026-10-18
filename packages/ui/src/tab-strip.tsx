import { useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { Icon, type IconName } from './icon.tsx';

/** One tab as the strip shows it: the app names the place and picks its glyph. */
export interface TabStripTab {
  readonly id: string;
  readonly title: string;
  readonly icon?: IconName | undefined;
}

/** The middle button, as `MouseEvent.button` numbers it. */
const MIDDLE_BUTTON = 1;

/**
 * The 36px row of tabs over a pane (docs/design/tab-model.md, FlowSplit.dc.html).
 *
 * Square tabs on the strip's `bg`, the shown one lifted onto the surface with
 * a 2px top border: ink while the pane is the focused one, grey while it is
 * the other pane, so one glance says where the next open lands. Only the shown
 * tab wears a ×, and any tab closes on a middle click. The strip is one stop
 * in the Tab order — ← and → walk the tabs, Home and End jump — and Enter or
 * Space shows the one under the focus; walking does not show, so a reader can
 * look along the strip without turning every page. Tabs shrink to 120px, then
 * the strip scrolls. Nothing here decides anything: every click is handed up.
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
  const strip = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, at: number) => {
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const buttons = strip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[step(at, tabs.length)]?.focus();
  };

  return (
    <div
      ref={strip}
      role="tablist"
      aria-label={label}
      className={focused ? 'tab-strip tab-strip--focused' : 'tab-strip'}
    >
      {tabs.map((tab, at) => {
        const shown = tab.id === active;
        return (
          <div
            key={tab.id}
            className={shown ? 'tab-strip__item tab-strip__item--active' : 'tab-strip__item'}
          >
            <button
              type="button"
              role="tab"
              aria-selected={shown}
              tabIndex={shown ? 0 : -1}
              className="tab-strip__tab"
              title={tab.title}
              onClick={() => onActivate(tab.id)}
              onAuxClick={(event: MouseEvent<HTMLButtonElement>) => {
                if (event.button === MIDDLE_BUTTON) onClose(tab.id);
              }}
              // A middle press would otherwise start autoscroll on some platforms.
              onMouseDown={(event: MouseEvent<HTMLButtonElement>) => {
                if (event.button === MIDDLE_BUTTON) event.preventDefault();
              }}
              onKeyDown={(event) => onKeyDown(event, at)}
            >
              {tab.icon === undefined ? null : (
                <Icon name={tab.icon} size={13} className="tab-strip__icon" />
              )}
              <span className="tab-strip__title">{tab.title}</span>
            </button>
            {shown ? (
              <button
                type="button"
                className="tab-strip__close"
                aria-label={`Close ${tab.title}`}
                onClick={() => onClose(tab.id)}
              >
                <Icon name="close" size={13} />
              </button>
            ) : null}
          </div>
        );
      })}
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
