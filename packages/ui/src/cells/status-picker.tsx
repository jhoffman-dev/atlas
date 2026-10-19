import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Popover } from '@base-ui/react/popover';
import { optionLabel, type StatusTone } from '@atlas/domain';
import { Icon } from '../icon.tsx';
import { StatusPill } from '../status-pill.tsx';
import { NUMBER_KEYS, optionPickedByNumber } from './cell-keys.ts';

/**
 * The picker a status or select cell opens (FlowTable.dc.html): a 220px
 * popover under the cell with a filter field, then a row per option — its
 * dot, its label, a tick on the one the cell holds, and the number key that
 * picks it. ↑ ↓ move and wrap, ↵ picks, 1–8 pick outright while nothing is
 * typed, Esc leaves the cell as it was, Tab and ⇧Tab move on to the next
 * cell. Open state, Esc and the outside press are Base UI's (ADR-0015).
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

/** Moves a highlight by one, wrapping at either end as the editor's slash menu does. */
function wrapped(at: number, step: 1 | -1, count: number): number {
  return count === 0 ? 0 : (at + step + count) % count;
}

/**
 * The filter and the rows, mounted afresh each time the picker opens, so
 * each opens clean — on the option the cell holds, so ↵ at once keeps it.
 */
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
  const [highlight, setHighlight] = useState(Math.max(options.indexOf(value ?? ''), 0));
  const shown = options.filter((option) => matches(option, filter));
  const highlighted = shown[Math.min(highlight, shown.length - 1)];
  const optionId = (option: string) => `${id}-${options.indexOf(option)}`;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const picked = optionPickedByNumber({
      key: event.key,
      filter,
      count: Math.min(shown.length, NUMBER_KEYS),
    });
    const option = picked === null ? undefined : shown[picked];
    if (option !== undefined) {
      event.preventDefault();
      onPick(option);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      onStep(event.shiftKey ? -1 : 1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const at = Math.min(highlight, Math.max(shown.length - 1, 0));
      setHighlight(wrapped(at, event.key === 'ArrowDown' ? 1 : -1, shown.length));
    } else if (event.key === 'Enter' && highlighted !== undefined) {
      event.preventDefault();
      onPick(highlighted);
    }
  };

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
          // The focus stays in the filter; this tells a screen reader which
          // row the arrows have reached, since the rows never take it.
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
          onKeyDown={onKeyDown}
        />
      </div>
      <OptionList
        id={`${id}-list`}
        label={label}
        shown={shown}
        number={(option) => options.indexOf(option) + 1}
        optionId={optionId}
        tones={tones}
        value={value}
        highlighted={highlighted}
        onHighlight={(option) => setHighlight(shown.indexOf(option))}
        onPick={onPick}
      />
    </>
  );
}

/** The rows the filter leaves, the highlighted one kept in view as the arrows move it. */
function OptionList({
  id,
  label,
  shown,
  number,
  optionId,
  tones,
  value,
  highlighted,
  onHighlight,
  onPick,
}: {
  id: string;
  label: string;
  shown: readonly string[];
  /** An option's number key, by its place among every option: the keys do not move as the filter narrows. */
  number: (option: string) => number;
  optionId: (option: string) => string;
  tones: Readonly<Record<string, StatusTone>>;
  value: string | null;
  highlighted: string | undefined;
  onHighlight: (option: string) => void;
  onPick: (option: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The list is bounded and scrolls; a row the arrows reach off its edge
    // is brought in. (jsdom has no scrollIntoView.)
    if (highlighted === undefined) return;
    const rows = list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [];
    for (const row of rows) {
      if (row.id === optionId(highlighted)) row.scrollIntoView?.({ block: 'nearest' });
    }
  }, [highlighted, optionId]);
  return (
    <div ref={list} id={id} className="cell-picker__list" role="listbox" aria-label={label}>
      {shown.map((option) => {
        const key = number(option);
        return (
          <div
            key={option}
            id={optionId(option)}
            role="option"
            className="cell-picker__option"
            // Selected is what the cell holds; the highlight is where the arrows are.
            aria-selected={option === value}
            data-highlighted={option === highlighted ? '' : undefined}
            onMouseEnter={() => onHighlight(option)}
            onClick={() => onPick(option)}
          >
            <StatusPill value={option} variant="dot" decorative {...tonedAs(tones, option)} />
            <span className="cell-picker__label">{optionLabel(option)}</span>
            {option === value && <Icon name="check" size={13} className="cell-picker__tick" />}
            <span className="cell-picker__key" aria-hidden="true">
              {key <= NUMBER_KEYS ? key : ''}
            </span>
          </div>
        );
      })}
      {shown.length === 0 && <p className="cell-picker__none">No option matches</p>}
    </div>
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
