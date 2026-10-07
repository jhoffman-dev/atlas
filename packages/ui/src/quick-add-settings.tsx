import { Icon, type IconName } from './icon.tsx';
import { SettingsCard } from './settings-card.tsx';
import { SortableList } from './sortable-list.tsx';

/** A type the add button is set to offer. */
export interface QuickAddRow {
  readonly name: string;
  readonly label: string;
  readonly icon: IconName;
  /** Named in the settings, but the vault has no such type: skipped until it does. */
  readonly missing: boolean;
}

/**
 * Settings → Quick add: which types the floating add button offers, in its
 * order — picked from the vault's types, dragged (or Alt+↑/↓) into order,
 * taken away. How many and what is missing are the domain's to say; this
 * only draws the list and reports what was asked.
 */
export function QuickAddSettings({
  rows,
  available,
  limit,
  problem,
  onAdd,
  onRemove,
  onMove,
}: {
  rows: readonly QuickAddRow[];
  /** The vault's types not yet listed, which can be added. */
  available: readonly { readonly name: string; readonly label: string }[];
  limit: number;
  /** Why the last change could not be saved. */
  problem: string | null;
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
  onMove: (args: { id: string; to: number }) => void;
}) {
  const full = rows.length >= limit;

  return (
    <SettingsCard id="settings-quick-add" icon="plus" title="Quick add">
      <p className="settings__lede">
        What the + button in the corner adds, up to {limit}. With one, pressing it asks for that
        straight away; with more, it opens a list to pick from.
      </p>
      {rows.length === 0 ? (
        <p className="settings__lede quick-add-settings__empty">
          Nothing yet, so the button is hidden.
        </p>
      ) : (
        <SortableList
          className="quick-add-settings__list"
          items={rows}
          idOf={(row) => row.name}
          nameOf={(row) => row.label}
          onMove={onMove}
        >
          {(row, handle) => (
            <div className="quick-add-settings__row" data-missing={row.missing}>
              {handle}
              <Icon name={row.icon} size={16} className="quick-add-settings__icon" />
              <span className="quick-add-settings__label">{row.label}</span>
              {row.missing && (
                <span className="quick-add-settings__missing">Not in this vault — skipped</span>
              )}
              <button
                type="button"
                className="icon-button quick-add-settings__remove"
                aria-label={`Remove ${row.label} from quick add`}
                onClick={() => onRemove(row.name)}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
        </SortableList>
      )}
      <div className="settings__row">
        <select
          className="quick-add-settings__add"
          aria-label="Add a type to quick add"
          value=""
          disabled={full || available.length === 0}
          onChange={(event) => {
            if (event.target.value !== '') onAdd(event.target.value);
          }}
        >
          <option value="">{full ? `${limit} is the most` : 'Add a type…'}</option>
          {available.map((type) => (
            <option key={type.name} value={type.name}>
              {type.label}
            </option>
          ))}
        </select>
      </div>
      {problem !== null && (
        <p className="settings__problem" role="alert">
          {problem}
        </p>
      )}
    </SettingsCard>
  );
}
