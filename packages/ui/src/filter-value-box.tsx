import { useId, useState, type KeyboardEvent } from 'react';
import { matchingChoices, type FilterChoice, type PropertyKind } from '@atlas/domain';
import { isImeKey } from './ime.ts';

/** How many choices the list shows at once: a relation can point at hundreds of notes. */
const MOST_SHOWN = 50;

/**
 * A filter's value: typed, or picked from what the property can hold (#212) —
 * a status from its options, a note from those a relation points at. An
 * ARIA combobox: ↓ and ↑ move through the list, Enter picks, Escape closes it.
 * A date also gets a date picker.
 */
export function FilterValueBox({
  kind,
  choices,
  typed,
  onOpen,
  onType,
  onPick,
}: {
  kind: PropertyKind | undefined;
  choices: readonly FilterChoice[];
  typed: string;
  /** The list is opening: what it offers may be gathered only now. */
  onOpen?: () => void;
  onType: (typed: string) => void;
  onPick: (choice: FilterChoice) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const shown = matchingChoices(choices, typed).slice(0, MOST_SHOWN);
  const expanded = open && shown.length > 0;
  const at = Math.min(active, shown.length - 1);

  const openList = () => {
    onOpen?.();
    setOpen(true);
  };

  const pick = (choice: FilterChoice) => {
    onPick(choice);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openList();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(Math.min(Math.max(at + step, 0), shown.length - 1));
    } else if (event.key === 'Enter' && expanded && at >= 0 && !isImeKey(event)) {
      // Picks the value; a second Enter adds the filter.
      event.preventDefault();
      const choice = shown[at];
      if (choice !== undefined) pick(choice);
    } else if (event.key === 'Escape' && expanded) {
      // Closes the list, not the popover it is in.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="filter-value">
      <input
        role="combobox"
        aria-label="Value"
        aria-autocomplete="list"
        aria-expanded={expanded}
        {...(expanded && { 'aria-controls': listId })}
        {...(expanded && at >= 0 && { 'aria-activedescendant': `${listId}-${at}` })}
        placeholder={choices.length > 0 ? 'Choose or type…' : 'Value'}
        autoComplete="off"
        value={typed}
        onFocus={openList}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          onType(event.target.value);
          openList();
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
      />
      {kind === 'date' && (
        <input
          type="date"
          aria-label="Pick a date"
          className="filter-value__date"
          onChange={(event) => onType(event.target.value)}
        />
      )}
      {expanded && (
        <ul id={listId} role="listbox" aria-label="Values" className="filter-value__list">
          {shown.map((choice, index) => (
            <li
              key={choice.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === at}
              className={
                index === at
                  ? 'filter-value__option filter-value__option--on'
                  : 'filter-value__option'
              }
              // Before the field's blur, which would close the list under the pointer.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(choice)}
            >
              {choice.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
