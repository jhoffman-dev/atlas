import { useState, type ReactNode } from 'react';
import { Popover } from '@base-ui/react/popover';
import {
  describeFilter,
  FILTER_OPERATORS,
  filterOperatorWords,
  filterValueFrom,
  operatorTakesValue,
  type FilterOperator,
  type PropertyKind,
  type QueryFilter,
  type QuerySort,
} from '@atlas/domain';
import { Icon, type IconName } from './icon.tsx';
import type { OverlaySlot } from './overlay-slot.ts';

/** A property a view can be filtered or sorted by, as its heading reads. */
export interface ViewField {
  readonly key: string;
  readonly label: string;
  /** The declared kind, which decides whether a typed filter value is a number. */
  readonly kind?: PropertyKind;
}

const labelOf = (fields: readonly ViewField[], key: string) =>
  fields.find((field) => field.key === key)?.label ?? key;

/**
 * A toolbar button that opens a small panel under it. Focus and dismissal are
 * Base UI's, as the page menu's are (ADR-0015); the open state is the app's
 * when it is given one, so the panel gives way to a palette.
 */
export function ToolbarPopover({
  icon,
  label,
  active,
  slot,
  children,
}: {
  icon: IconName;
  label: string;
  /**
   * How many are set, shown beside the label when any are — for filters only:
   * a filter hides notes, which is worth saying, and a sort hides nothing.
   */
  active?: number;
  slot: OverlaySlot | undefined;
  children: ReactNode;
}) {
  return (
    <Popover.Root {...slot}>
      <Popover.Trigger className="view-toolbar__button">
        <Icon name={icon} size={16} />
        {label}
        {active !== undefined && active > 0 && (
          <span className="view-toolbar__badge">{active}</span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="menu-positioner" side="bottom" align="end" sideOffset={6}>
          <Popover.Popup className="view-popover" aria-label={label}>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** What the view is filtered by, and a way to add to it. Each change redraws the view; saving it is the toolbar's. */
export function FilterPopover({
  fields,
  filters,
  onChange,
  slot,
}: {
  fields: readonly ViewField[];
  filters: readonly QueryFilter[];
  onChange: (filters: readonly QueryFilter[]) => void;
  slot?: OverlaySlot | undefined;
}) {
  return (
    <ToolbarPopover icon="filter" label="Filter" active={filters.length} slot={slot}>
      <p className="view-popover__title">Filters</p>
      <FilterList fields={fields} filters={filters} onChange={onChange} />
    </ToolbarPopover>
  );
}

/**
 * The filters as sentences, each with a way to take it off, and a way to add
 * one. The Filter popover is this in a popup; the widget editor draws it
 * in place, since a popup inside its sheet would be a second overlay.
 */
export function FilterList({
  fields,
  filters,
  onChange,
  empty = 'Nothing filtered: every note of the type is here.',
}: {
  fields: readonly ViewField[];
  filters: readonly QueryFilter[];
  onChange: (filters: readonly QueryFilter[]) => void;
  /** What an empty list says. */
  empty?: string;
}) {
  return (
    <>
      {filters.length === 0 ? (
        <p className="view-popover__empty">{empty}</p>
      ) : (
        <ul className="view-popover__list">
          {filters.map((filter, at) => {
            const sentence = describeFilter({ filter, label: labelOf(fields, filter.key) });
            return (
              <li key={`${filter.key}-${at}`} className="view-popover__row">
                <span className="view-popover__text">{sentence}</span>
                <RemoveButton
                  label={`Remove filter: ${sentence}`}
                  onRemove={() => onChange(filters.filter((_, index) => index !== at))}
                />
              </li>
            );
          })}
        </ul>
      )}
      <AddFilter fields={fields} onAdd={(filter) => onChange([...filters, filter])} />
    </>
  );
}

function AddFilter({
  fields,
  onAdd,
}: {
  fields: readonly ViewField[];
  onAdd: (filter: QueryFilter) => void;
}) {
  const [key, setKey] = useState(fields[0]?.key ?? '');
  const [operator, setOperator] = useState<FilterOperator>('is');
  const [typed, setTyped] = useState('');
  const takesValue = operatorTakesValue(operator);
  const value = filterValueFrom(typed, fields.find((field) => field.key === key)?.kind);
  const ready = key !== '' && (!takesValue || value !== null);

  return (
    <form
      className="view-popover__add"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        onAdd(takesValue ? { key, operator, value } : { key, operator });
        setTyped('');
      }}
    >
      <select aria-label="Property" value={key} onChange={(event) => setKey(event.target.value)}>
        {fields.map((field) => (
          <option key={field.key} value={field.key}>
            {field.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Condition"
        value={operator}
        onChange={(event) => setOperator(event.target.value as FilterOperator)}
      >
        {FILTER_OPERATORS.map((candidate) => (
          <option key={candidate} value={candidate}>
            {filterOperatorWords(candidate)}
          </option>
        ))}
      </select>
      {takesValue && (
        <input
          aria-label="Value"
          placeholder="Value"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      )}
      <button type="submit" className="view-popover__submit" disabled={!ready}>
        Add filter
      </button>
    </form>
  );
}

/** What the view is sorted by, in order; each can be turned round or taken off. */
export function SortPopover({
  fields,
  sorts,
  onChange,
  slot,
}: {
  fields: readonly ViewField[];
  sorts: readonly QuerySort[];
  onChange: (sorts: readonly QuerySort[]) => void;
  slot?: OverlaySlot | undefined;
}) {
  const unsorted = fields.filter((field) => !sorts.some((sort) => sort.key === field.key));
  const replace = (at: number, sort: QuerySort | null) =>
    onChange(sorts.flatMap((was, index) => (index !== at ? [was] : sort === null ? [] : [sort])));

  return (
    <ToolbarPopover icon="sort" label="Sort" slot={slot}>
      <p className="view-popover__title">Sort</p>
      {sorts.length === 0 ? (
        <p className="view-popover__empty">Not sorted: the notes are in file order.</p>
      ) : (
        <ul className="view-popover__list">
          {sorts.map((sort, at) => {
            const label = labelOf(fields, sort.key);
            const flipped = sort.direction === 'asc' ? 'desc' : 'asc';
            return (
              <li key={sort.key} className="view-popover__row">
                <span className="view-popover__text">{label}</span>
                <button
                  type="button"
                  className="view-popover__direction"
                  aria-label={`Sort ${label} ${flipped === 'asc' ? 'ascending' : 'descending'}`}
                  onClick={() => replace(at, { key: sort.key, direction: flipped })}
                >
                  {sort.direction === 'asc' ? 'Ascending' : 'Descending'}
                </button>
                <RemoveButton
                  label={`Stop sorting by ${label}`}
                  onRemove={() => replace(at, null)}
                />
              </li>
            );
          })}
        </ul>
      )}
      {unsorted.length > 0 && (
        <select
          className="view-popover__add-sort"
          aria-label="Sort by"
          value=""
          onChange={(event) => onChange([...sorts, { key: event.target.value, direction: 'asc' }])}
        >
          <option value="" disabled>
            Sort by…
          </option>
          {unsorted.map((field) => (
            <option key={field.key} value={field.key}>
              {field.label}
            </option>
          ))}
        </select>
      )}
    </ToolbarPopover>
  );
}

export function RemoveButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      className="icon-button view-popover__remove"
      aria-label={label}
      title={label}
      onClick={onRemove}
    >
      <Icon name="close" size={14} />
    </button>
  );
}
