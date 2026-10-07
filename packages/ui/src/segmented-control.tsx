import { useRef, type KeyboardEvent } from 'react';
import { Icon, type IconName } from './icon.tsx';

export type SegmentedOption<Value extends string> = {
  value: Value;
  label: string;
  /** Drawn instead of the label, which then becomes the option's accessible name. */
  icon?: IconName;
};

/**
 * A pill track with one option filled — the app's tabs and mode switches.
 *
 * Built as a radio group rather than a row of buttons, because that is what it
 * is: exactly one is chosen, the arrow keys move between them, and only the
 * chosen one is in the tab order (a roving tabindex), so tabbing past the
 * control takes one press rather than one per option.
 */
export function SegmentedControl<Value extends string>({
  label,
  options,
  value,
  onChange,
  tone = 'accent',
}: {
  /** Names the group for a screen reader; the options are only their labels. */
  label: string;
  options: readonly SegmentedOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  /**
   * `accent` fills the chosen option with the accent — a mode that changes what
   * is shown. `quiet` lifts it as a plain raised pill, for a preference.
   */
  tone?: 'accent' | 'quiet';
}) {
  const group = useRef<HTMLDivElement>(null);

  const moveTo = (index: number) => {
    const option = options[index];
    if (option === undefined) return;
    onChange(option.value);
    // Selection follows focus, so the newly chosen option must take it too.
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = options.findIndex((option) => option.value === value);
    if (at < 0) return;
    const last = options.length - 1;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        moveTo(at === last ? 0 : at + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        moveTo(at === 0 ? last : at - 1);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(last);
        break;
      default:
        return;
    }
    // Only reached when a key above was handled; the arrows would otherwise
    // scroll the pane behind the control.
    event.preventDefault();
  };

  return (
    <div
      ref={group}
      className={tone === 'quiet' ? 'segmented segmented--quiet' : 'segmented'}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            className={on ? 'segmented__option segmented__option--on' : 'segmented__option'}
            aria-checked={on}
            aria-label={option.icon === undefined ? undefined : option.label}
            title={option.icon === undefined ? undefined : option.label}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(option.value)}
          >
            {option.icon === undefined ? option.label : <Icon name={option.icon} size={15} />}
          </button>
        );
      })}
    </div>
  );
}
