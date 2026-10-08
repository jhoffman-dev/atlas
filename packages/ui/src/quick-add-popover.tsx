import { useId, useState, type KeyboardEvent } from 'react';
import { optionLabel, type PropertyDef } from '@atlas/domain';
import { Icon, type IconName } from './icon.tsx';
import { isImeKey } from './ime.ts';
import { KeyHints } from './key-hints.tsx';
import { useNoteNames } from './note-names.tsx';
import type { RelationChoice } from './properties-panel.tsx';
import { RelationOptions } from './relation-options.tsx';

const HINTS = [
  ['↵', 'to add'],
  ['⌘ ↵', 'to add and open'],
  ['esc', 'to close'],
] as const;

/** A quick-added note, as the person filled it in. */
export interface QuickAddRequest {
  readonly name: string;
  /** Each field's value by property key; an empty field is ''. */
  readonly values: Readonly<Record<string, string>>;
  /** "Add and open" rather than "Add". */
  readonly open: boolean;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Quick add: a title, and the few properties of the type worth asking for on
 * the way — which ones is the domain's to say (`quickAddFields`). Enter adds
 * it and stays where you were; Cmd+Enter adds it and opens it.
 *
 * A popover beside the add button rather than a palette, so what is in view
 * stays in view. Escape closes it; a click elsewhere is the button's to see.
 */
export function QuickAddPopover({
  label,
  icon,
  fields,
  startValues,
  choices,
  onAdd,
  onClose,
}: {
  /** The type, as a person reads it: "Task". */
  label: string;
  icon: IconName;
  fields: readonly PropertyDef[];
  startValues: Readonly<Record<string, string>>;
  /** Candidates per relation key, already filtered to the target type. */
  choices: Readonly<Record<string, readonly RelationChoice[]>>;
  onAdd: (request: QuickAddRequest) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({ ...startValues });
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const add = (open: boolean) => {
    if (adding || name.trim() === '') return;
    setAdding(true);
    setFailure(null);
    onAdd({ name: name.trim(), values, open }).catch((cause: unknown) => {
      setFailure(message(cause));
      setAdding(false);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Enter' || isImeKey(event)) return;
    const open = event.metaKey || event.ctrlKey;
    // A plain Enter adds only from the title; in a list it chooses, as it always does.
    if (!open && !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    add(open);
  };

  return (
    <div
      className="fab__popover quick-add"
      role="dialog"
      aria-label={`New ${label}`}
      onKeyDown={onKeyDown}
    >
      <div className="quick-add__title">
        <Icon name={icon} size={18} className="quick-add__icon" />
        <input
          className="quick-add__name"
          aria-label={`${label} name`}
          placeholder={`New ${label.toLowerCase()}…`}
          // It exists because the add button was just pressed.
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      {fields.length > 0 && (
        <div className="quick-add__fields">
          {fields.map((field) => (
            <QuickAddField
              key={field.key}
              field={field}
              value={values[field.key] ?? ''}
              choices={choices[field.key] ?? []}
              onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
            />
          ))}
        </div>
      )}
      {failure !== null && (
        <p className="quick-add__problem" role="alert">
          {failure}
        </p>
      )}
      <div className="quick-add__actions">
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={adding || name.trim() === ''}
          onClick={() => add(true)}
        >
          Add and open
        </button>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={adding || name.trim() === ''}
          onClick={() => add(false)}
        >
          Add
        </button>
      </div>
      <KeyHints hints={HINTS} />
    </div>
  );
}

/** One property's control, labelled by the property's own name. */
function QuickAddField({
  field,
  value,
  choices,
  onChange,
}: {
  field: PropertyDef;
  value: string;
  choices: readonly RelationChoice[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <label className="quick-add__field" htmlFor={id}>
      <span className="quick-add__label">{field.label}</span>
      <FieldControl id={id} field={field} value={value} choices={choices} onChange={onChange} />
    </label>
  );
}

function FieldControl({
  id,
  field,
  value,
  choices,
  onChange,
}: {
  id: string;
  field: PropertyDef;
  value: string;
  choices: readonly RelationChoice[];
  onChange: (value: string) => void;
}) {
  const names = useNoteNames();
  const common = {
    id,
    className: 'quick-add__control',
    value,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
  };
  switch (field.kind) {
    case 'select':
      return (
        <select {...common}>
          {!field.required && <option value="">—</option>}
          {field.options.map((option) => (
            <option key={option} value={option}>
              {optionLabel(option)}
            </option>
          ))}
        </select>
      );
    case 'relation':
      return (
        <select {...common}>
          <option value="">— none —</option>
          <RelationOptions choices={choices} names={names} />
        </select>
      );
    case 'date':
      return <input {...common} type="date" />;
    case 'number':
      return <input {...common} type="number" />;
    case 'checkbox':
      return (
        <input
          id={id}
          className="quick-add__check"
          type="checkbox"
          checked={value === 'true'}
          onChange={(event) => onChange(event.target.checked ? 'true' : 'false')}
        />
      );
    default:
      return <input {...common} type={field.kind === 'url' ? 'url' : 'text'} />;
  }
}
