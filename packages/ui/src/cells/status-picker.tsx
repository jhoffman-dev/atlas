import { useId, useState, type RefObject } from 'react';
import { Popover } from '@base-ui/react/popover';
import { optionLabel, type StatusTone } from '@atlas/domain';
import { Icon } from '../icon.tsx';
import { StatusPill } from '../status-pill.tsx';
import { NUMBER_KEYS, optionPickedByNumber } from './cell-keys.ts';

/**
 * The picker a status or select cell opens (FlowTable.dc.html): a 220px
 * popover under the cell with a filter field, then a row per option — its
 * dot, its label, a tick on the one the cell holds, and the number key that
 * picks it. ↑ ↓ move, ↵ picks, 1–8 pick outright, Esc leaves the cell as it
 * was, Tab and ⇧Tab move on to the next cell. Open state, Esc and the
 * outside press are Base UI's (ADR-0015).
 */
export function StatusPicker({
  open,
  anchor,
  label,
  options,
  tones = {},
  value,
  onPick,
  onCancel,
  onStep,
}: {
  open: boolean;
  /** The cell the picker hangs from. */
  anchor: RefObject<HTMLElement | null>;
  /** The column's label: "Status". */
  label: string;
  options: readonly string[];
  /** The tone the type chose for an option; one without is toned by its name. */
  tones?: Readonly<Record<string, StatusTone>>;
  /** The option the cell holds now, or null. */
  value: string | null;
  onPick: (option: string) => void;
  onCancel: () => void;
  /** Tab and ⇧Tab: leave the cell as it was and edit the next or previous. */
  onStep: (to: 1 | -1) => void;
}) {
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          className="menu-positioner"
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={2}
        >
          <Popover.Popup className="cell-picker" aria-label={`Set ${label}`} finalFocus={false}>
            <PickerBody
              label={label}
              options={options}
              tones={tones}
              value={value}
              onPick={onPick}
              onStep={onStep}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Whether an option is among those a filter leaves: by its label, case aside. */
function matches(option: string, filter: string): boolean {
  return optionLabel(option).toLowerCase().includes(filter.trim().toLowerCase());
}

/** The filter and the rows, mounted afresh each time the picker opens, so each opens clean. */
function PickerBody({
  label,
  options,
  tones,
  value,
  onPick,
  onStep,
}: {
  label: string;
  options: readonly string[];
  tones: Readonly<Record<string, StatusTone>>;
  value: string | null;
  onPick: (option: string) => void;
  onStep: (to: 1 | -1) => void;
}) {
  const id = useId();
  const [filter, setFilter] = useState('');
  const [highlight, setHighlight] = useState(0);
  const shown = options.filter((option) => matches(option, filter));
  const highlighted = shown[Math.min(highlight, shown.length - 1)];
  const optionId = (option: string) => `${id}-${options.indexOf(option)}`;

  return (
    <>
      <div className="cell-picker__filter">
        <Icon name="search" size={13} />
        <input
          className="cell-picker__input"
          type="text"
          role="combobox"
          aria-label={`Filter ${label.toLowerCase()} options`}
          aria-controls={`${id}-list`}
          aria-expanded="true"
          aria-autocomplete="list"
          aria-activedescendant={highlighted === undefined ? undefined : optionId(highlighted)}
          placeholder={`Set ${label.toLowerCase()}…`}
          // The picker is in the page only while it is open, so focusing its
          // filter is what opening it asked for rather than a focus steal.
          autoFocus
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={(event) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const picked = optionPickedByNumber({
              key: event.key,
              filter,
              count: Math.min(options.length, NUMBER_KEYS),
            });
            const option = picked === null ? undefined : options[picked];
            if (option !== undefined) {
              event.preventDefault();
              onPick(option);
            } else if (event.key === 'Tab') {
              event.preventDefault();
              onStep(event.shiftKey ? -1 : 1);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const last = Math.max(shown.length - 1, 0);
              const at = Math.min(highlight, last);
              setHighlight(
                event.key === 'ArrowDown' ? Math.min(at + 1, last) : Math.max(at - 1, 0),
              );
            } else if (event.key === 'Enter' && highlighted !== undefined) {
              event.preventDefault();
              onPick(highlighted);
            }
          }}
        />
      </div>
      <div id={`${id}-list`} role="listbox" aria-label={label}>
        {shown.map((option) => {
          const number = options.indexOf(option) + 1;
          return (
            <div
              key={option}
              id={optionId(option)}
              role="option"
              className="cell-picker__option"
              aria-selected={option === value}
              data-highlighted={option === highlighted ? '' : undefined}
              onMouseEnter={() => setHighlight(shown.indexOf(option))}
              onClick={() => onPick(option)}
            >
              <StatusPill value={option} variant="dot" decorative {...tonedAs(tones, option)} />
              <span className="cell-picker__label">{optionLabel(option)}</span>
              {option === value && <Icon name="check" size={13} className="cell-picker__tick" />}
              <span className="cell-picker__key" aria-hidden="true">
                {number <= NUMBER_KEYS ? number : ''}
              </span>
            </div>
          );
        })}
        {shown.length === 0 && <p className="cell-picker__none">No option matches</p>}
      </div>
    </>
  );
}

/** The `tone` prop for an option the type coloured; none for one it did not. */
function tonedAs(
  tones: Readonly<Record<string, StatusTone>>,
  option: string,
): { tone?: StatusTone } {
  const tone = tones[option];
  return tone === undefined ? {} : { tone };
}
