import { useState } from 'react';
import {
  optionLabel,
  optionTone,
  STATUS_TONES,
  type PropertyDef,
  type StatusTone,
  type TypeEdit,
} from '@atlas/domain';
import { CommitField } from './commit-field.tsx';
import { Icon } from './icon.tsx';
import { isImeKey } from './ime.ts';
import { SortableList } from './sortable-list.tsx';
import { StatusPill } from './status-pill.tsx';

/**
 * A select's options: renamed in place, coloured on the status ramp, put in
 * order — the order a board shows its columns in — removed, and added to.
 */
export function OptionsEditor({
  property,
  onEdit,
}: {
  property: PropertyDef;
  onEdit: (edit: TypeEdit) => void;
}) {
  const { key, label } = property;
  const [adding, setAdding] = useState('');

  return (
    <div className="type-editor__options" role="group" aria-label={`Options of ${label}`}>
      <span className="type-editor__row-label">Options</span>
      <SortableList
        className="type-editor__option-list"
        items={property.options}
        idOf={(option) => option}
        nameOf={(option) => optionLabel(option)}
        onMove={({ id, to }) => onEdit({ kind: 'moveOption', key, option: id, to })}
      >
        {(option, handle) => (
          <div className="type-editor__option">
            {handle}
            <StatusPill value={option} tone={optionTone(property, option)} />
            <CommitField
              value={option}
              label={`Rename ${option}`}
              onCommit={(to) => onEdit({ kind: 'renameOption', key, from: option, to })}
            />
            <select
              className="type-editor__tone"
              aria-label={`Colour of ${option}`}
              value={optionTone(property, option)}
              onChange={(event) =>
                onEdit({
                  kind: 'setOptionColor',
                  key,
                  option,
                  tone: event.target.value as StatusTone,
                })
              }
            >
              {STATUS_TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {optionLabel(tone)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove ${option}`}
              onClick={() => onEdit({ kind: 'removeOption', key, option })}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
      </SortableList>
      {property.kind === 'select' && property.options.length > 0 && (
        <DoneOptionPicker property={property} onEdit={onEdit} />
      )}
      <input
        className="type-editor__field"
        type="text"
        aria-label={`New option for ${label}`}
        placeholder="Add an option…"
        value={adding}
        onChange={(event) => setAdding(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || isImeKey(event) || adding.trim() === '') return;
          onEdit({ kind: 'addOption', key, option: adding.trim() });
          setAdding('');
        }}
      />
    </div>
  );
}

/**
 * Which option means finished: what ticking a note's box sets it to. Left
 * unchosen, an option named like done — "done", "complete" — is taken.
 */
function DoneOptionPicker({
  property,
  onEdit,
}: {
  property: PropertyDef;
  onEdit: (edit: TypeEdit) => void;
}) {
  return (
    <label className="type-editor__done">
      <span className="type-editor__row-label">Done option</span>
      <select
        className="type-editor__tone"
        aria-label={`Done option of ${property.label}`}
        value={property.done ?? ''}
        onChange={(event) =>
          onEdit({
            kind: 'setDoneOption',
            key: property.key,
            option: event.target.value === '' ? null : event.target.value,
          })
        }
      >
        <option value="">By name</option>
        {property.options.map((option) => (
          <option key={option} value={option}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}
