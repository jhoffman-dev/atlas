import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import type { DialDirection } from '@atlas/domain';
import { Icon, type IconName } from './icon.tsx';

/** One thing the add button can add: a type, as a person reads it. */
export interface FabItem {
  /** The type's name, which is what is added. */
  readonly name: string;
  readonly label: string;
  readonly icon: IconName;
}

/** The arrow that moves away from the button, for each way the dial opens. */
const AWAY: Readonly<Record<DialDirection, string>> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};

const TOWARD: Readonly<Record<DialDirection, string>> = {
  up: 'ArrowDown',
  down: 'ArrowUp',
  left: 'ArrowRight',
  right: 'ArrowLeft',
};

/** Which item a key moves focus to, or null when the key does not move it. */
function focusTarget({
  key,
  direction,
  at,
  last,
}: {
  key: string;
  direction: DialDirection;
  at: number;
  last: number;
}): number | null {
  if (key === AWAY[direction]) return Math.min(at + 1, last);
  if (key === TOWARD[direction]) return Math.max(at - 1, 0);
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  return null;
}

/**
 * The speed dial: the types to add, as pills sliding out of the button toward
 * the middle of the panel, the first nearest the button. A menu to assistive
 * technology; the arrow keys walk it in the direction it opened, and Escape
 * and Tab close it.
 */
export function FabDial({
  items,
  direction,
  onPick,
  onClose,
}: {
  items: readonly FabItem[];
  direction: DialDirection;
  onPick: (name: string) => void;
  /** `restoreFocus` when focus should go back to the button, as after Escape. */
  onClose: (restoreFocus: boolean) => void;
}) {
  const list = useRef<HTMLUListElement>(null);

  // It opens because the button was pressed: the first type is ready to take.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);

  const move = (event: KeyboardEvent<HTMLButtonElement>, at: number) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const target = focusTarget({ key: event.key, direction, at, last: buttons.length - 1 });
    if (target !== null) {
      event.preventDefault();
      buttons[target]?.focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    }
    if (event.key === 'Tab') onClose(false);
  };

  return (
    <ul className="fab__dial" role="menu" aria-label="Add" ref={list} data-direction={direction}>
      {items.map((item, at) => (
        <li key={item.name} role="none" style={{ '--fab-item': at } as CSSProperties}>
          <button
            type="button"
            role="menuitem"
            className="fab__item"
            tabIndex={at === 0 ? 0 : -1}
            onClick={() => onPick(item.name)}
            onKeyDown={(event) => move(event, at)}
          >
            <Icon name={item.icon} size={16} />
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
