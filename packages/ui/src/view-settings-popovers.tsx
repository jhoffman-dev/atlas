import { Icon } from './icon.tsx';
import type { OverlaySlot } from './overlay-slot.ts';
import { ToolbarPopover, type ViewField } from './view-query-popovers.tsx';

/** A property the Group control offers, and why it cannot be chosen when it cannot. */
export interface GroupOption {
  readonly key: string;
  readonly label: string;
  readonly reason: string | null;
}

/**
 * What a view groups by, then what each group is split by in turn: a board's
 * columns and swimlanes, a table's groups and sub-groups. A board cannot be
 * drawn without columns, so it has no "None" for the first; a table can.
 * A property that holds several values is listed, disabled, with the reason.
 */
export function GroupByPopover({
  choices,
  groupBy,
  subGroupBy,
  onChange,
  onChangeSub,
  required = false,
  slot,
}: {
  choices: readonly GroupOption[];
  groupBy: string | null;
  subGroupBy: string | null;
  onChange: (groupBy: string | null) => void;
  onChangeSub: (subGroupBy: string | null) => void;
  /** Whether there must be a grouping — a board's columns. */
  required?: boolean;
  slot?: OverlaySlot | undefined;
}) {
  return (
    <ToolbarPopover icon="board" label="Group" slot={slot}>
      <GroupChoices
        title="Group by"
        name="view-group-by"
        choices={choices}
        chosen={groupBy}
        none={!required}
        onChange={onChange}
      />
      {groupBy !== null && (
        <GroupChoices
          title="Then by"
          name="view-sub-group-by"
          choices={choices.filter((choice) => choice.key !== groupBy)}
          chosen={subGroupBy}
          none
          onChange={onChangeSub}
        />
      )}
    </ToolbarPopover>
  );
}

function GroupChoices({
  title,
  name,
  choices,
  chosen,
  none,
  onChange,
}: {
  title: string;
  name: string;
  choices: readonly GroupOption[];
  chosen: string | null;
  /** Whether "None" is offered. */
  none: boolean;
  onChange: (key: string | null) => void;
}) {
  return (
    <>
      <p className="view-popover__title">{title}</p>
      <ul className="view-popover__list" role="radiogroup" aria-label={title}>
        {none && (
          <li className="view-popover__row">
            <label className="view-popover__choice">
              <input
                type="radio"
                name={name}
                checked={chosen === null}
                onChange={() => onChange(null)}
              />
              None
            </label>
          </li>
        )}
        {choices.map((choice) => (
          <li key={choice.key} className="view-popover__row view-popover__row--stacked">
            <label className="view-popover__choice">
              <input
                type="radio"
                name={name}
                checked={choice.key === chosen}
                disabled={choice.reason !== null}
                {...(choice.reason !== null && {
                  'aria-describedby': `${name}-${choice.key}-reason`,
                })}
                onChange={() => onChange(choice.key)}
              />
              {choice.label}
            </label>
            {choice.reason !== null && (
              <span id={`${name}-${choice.key}-reason`} className="view-popover__reason">
                {choice.reason}
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Which properties the view shows, and in what order: a box to show or hide
 * each, and a way to move a shown one earlier or later. The name is always
 * shown, so it is not listed.
 */
export function PropertiesPopover({
  fields,
  columns,
  onChange,
  onMove,
  slot,
}: {
  /** Every property the view could show. */
  fields: readonly ViewField[];
  /** The shown ones, in order. */
  columns: readonly string[];
  onChange: (key: string) => void;
  onMove: (key: string, by: -1 | 1) => void;
  slot?: OverlaySlot | undefined;
}) {
  const shown = columns.flatMap((key) => fields.filter((field) => field.key === key));
  const hidden = fields.filter((field) => !columns.includes(field.key));
  return (
    <ToolbarPopover icon="list" label="Properties" slot={slot}>
      <p className="view-popover__title">Shown</p>
      {shown.length === 0 && <p className="view-popover__empty">Only the name is shown.</p>}
      <ul className="view-popover__list" aria-label="Shown properties">
        {shown.map((field, at) => (
          <li key={field.key} className="view-popover__row">
            <PropertyToggle field={field} on onChange={onChange} />
            <MoveButton
              label={`Move ${field.label} earlier`}
              direction="up"
              disabled={at === 0}
              onMove={() => onMove(field.key, -1)}
            />
            <MoveButton
              label={`Move ${field.label} later`}
              direction="down"
              disabled={at === shown.length - 1}
              onMove={() => onMove(field.key, 1)}
            />
          </li>
        ))}
      </ul>
      {hidden.length > 0 && (
        <>
          <p className="view-popover__title">Hidden</p>
          <ul className="view-popover__list" aria-label="Hidden properties">
            {hidden.map((field) => (
              <li key={field.key} className="view-popover__row">
                <PropertyToggle field={field} on={false} onChange={onChange} />
              </li>
            ))}
          </ul>
        </>
      )}
    </ToolbarPopover>
  );
}

function PropertyToggle({
  field,
  on,
  onChange,
}: {
  field: ViewField;
  on: boolean;
  onChange: (key: string) => void;
}) {
  return (
    <label className="view-popover__choice">
      <input type="checkbox" checked={on} onChange={() => onChange(field.key)} />
      {field.label}
    </label>
  );
}

function MoveButton({
  label,
  direction,
  disabled,
  onMove,
}: {
  label: string;
  direction: 'up' | 'down';
  disabled: boolean;
  onMove: () => void;
}) {
  return (
    <button
      type="button"
      className="icon-button view-popover__move"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onMove}
    >
      <Icon
        name="up"
        size={14}
        {...(direction === 'down' && { className: 'view-popover__down' })}
      />
    </button>
  );
}
