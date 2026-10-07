import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  fabAnchorLabel,
  fabAnchorStep,
  fabDialAlign,
  fabDialDirection,
  FAB_ANCHORS,
  type FabAnchor,
  type FabStep,
} from '@atlas/domain';
import { fabAnchorPoint, type FabArea } from './fab-geometry.ts';
import { useClickAway } from './click-away.ts';
import { useFabDrag } from './fab-drag.ts';
import { FabDial, type FabItem } from './fab-dial.tsx';
import { Icon } from './icon.tsx';

export type { FabItem } from './fab-dial.tsx';

/** Where the add button rests from one run to the next. */
export type FabAnchorStore = {
  read: () => FabAnchor | null;
  write: (anchor: FabAnchor) => void;
};

const STEPS: Readonly<Record<string, FabStep>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/**
 * The floating add button: a round accent button over the content panel.
 *
 * With one type to add, pressing it asks for that type at once; with several,
 * it opens a speed dial of them. It can be dragged to any of eight anchors and
 * snaps to the nearest when let go, or moved from the keyboard with Alt and an
 * arrow. What it adds, and where, is the app's; this only reports the choice.
 */
export function FloatingAddButton({
  items,
  anchor,
  onMove,
  dialOpen,
  onDialOpenChange,
  onPick,
  shortcut,
  popover = null,
  onPopoverClose,
}: {
  items: readonly FabItem[];
  anchor: FabAnchor;
  onMove: (anchor: FabAnchor) => void;
  dialOpen: boolean;
  onDialOpenChange: (open: boolean) => void;
  /** A type was chosen: the button itself with one type, a dial item with several. */
  onPick: (name: string) => void;
  /** The key that does what pressing it does, shown in its tooltip. */
  shortcut: string;
  /** The quick-add popover, placed beside the button as the dial is. */
  popover?: ReactNode;
  /** Closes the popover: a press elsewhere, or on the button again. */
  onPopoverClose?: () => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const area = useLayerArea(layer);
  const [moved, setMoved] = useState('');
  // Only a move animates: a window resizing, or the first measurement, puts it straight there.
  const [snapping, setSnapping] = useState(false);
  const moveTo = (next: FabAnchor) => {
    setSnapping(true);
    onMove(next);
    setMoved(`Add button moved to ${fabAnchorLabel(next)}`);
  };
  const drag = useFabDrag({ anchor, area, layer, onMove: moveTo });
  const only = items.length === 1 ? items[0] : undefined;

  const dismiss = () => {
    if (dialOpen) onDialOpenChange(false);
    if (popover !== null) onPopoverClose?.();
  };
  useClickAway({ inside: wrapper, active: dialOpen || popover !== null, onAway: dismiss });
  useFocusBackAfter({ open: popover !== null, button });

  const press = () => {
    if (drag.endedDrag()) return;
    if (popover !== null) {
      dismiss();
      return;
    }
    if (only !== undefined) onPick(only.name);
    else onDialOpenChange(!dialOpen);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = STEPS[event.key];
    if (!event.altKey || step === undefined) return;
    event.preventDefault();
    moveTo(fabAnchorStep(anchor, step));
  };

  const resting = fabAnchorPoint({ anchor, area });
  const at = drag.point ?? resting;
  const name = only === undefined ? 'Add…' : `New ${only.label}`;

  return (
    <div className="fab-layer" ref={layer}>
      {drag.point !== null &&
        FAB_ANCHORS.map((candidate) => (
          <span
            key={candidate}
            className="fab-layer__preview"
            data-anchor={candidate}
            data-near={candidate === drag.near}
            style={previewStyle(fabAnchorPoint({ anchor: candidate, area }))}
            aria-hidden="true"
          />
        ))}
      <div
        className="fab"
        ref={wrapper}
        data-anchor={anchor}
        data-direction={fabDialDirection(anchor)}
        data-align={fabDialAlign(anchor)}
        data-dragging={drag.point !== null}
        data-snapping={snapping}
        style={{ left: at.x, top: at.y }}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget) setSnapping(false);
        }}
      >
        {dialOpen && only === undefined && (
          <FabDial
            items={items}
            direction={fabDialDirection(anchor)}
            onPick={onPick}
            onClose={(restoreFocus) => {
              onDialOpenChange(false);
              if (restoreFocus) button.current?.focus();
            }}
          />
        )}
        {popover}
        <button
          type="button"
          ref={button}
          className="fab__button"
          aria-label={name}
          aria-haspopup={only === undefined ? 'menu' : 'dialog'}
          aria-expanded={only === undefined ? dialOpen : undefined}
          aria-keyshortcuts="Alt+Meta+N"
          title={`${name} (${shortcut}) · drag, or Alt+arrow, to move`}
          data-open={dialOpen}
          onClick={press}
          onKeyDown={onKeyDown}
          {...drag.handlers}
        >
          <Icon name="plus" size={24} />
        </button>
      </div>
      <span className="visually-hidden" aria-live="polite">
        {moved}
      </span>
    </div>
  );
}

/**
 * Focus back on the button once the popover closes — unless it went somewhere
 * on purpose, as "Add and open" sends it to the new note.
 */
function useFocusBackAfter({
  open,
  button,
}: {
  open: boolean;
  button: RefObject<HTMLButtonElement | null>;
}): void {
  const wasOpen = useRef(open);
  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (closed && lost) button.current?.focus();
  }, [open, button]);
}

function previewStyle(corner: { x: number; y: number }) {
  return { left: corner.x, top: corner.y };
}

/** The layer's size, kept current as the window or the sidebar changes it. */
function useLayerArea(layer: RefObject<HTMLElement | null>): FabArea {
  const [area, setArea] = useState<FabArea>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = layer.current;
    if (element === null) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setArea((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    measure();
    // Where there is no ResizeObserver (jsdom), the window's own resize still reaches it.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [layer]);
  return area;
}
