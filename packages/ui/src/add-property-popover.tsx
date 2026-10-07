import { useId, useState } from 'react';
import { newPropertyKey, PROPERTY_KINDS, type PropertyKind } from '@atlas/domain';
import { KIND_LABELS, type RelationTarget } from './type-editor.tsx';

/** A property to add, as the person described it. */
export interface NewProperty {
  /** What it is called, as typed. */
  readonly label: string;
  /** The key it is stored under in this note, when it is added to the note alone. */
  readonly key: string;
  readonly kind: PropertyKind;
  /** On every note of the type, or on this note alone. */
  readonly scope: 'type' | 'note';
  /** The type a relation points at. */
  readonly target: string | null;
  /** Whether a relation holds several notes. */
  readonly many: boolean;
}

/** Kinds whose options or target live in a type, so one note alone cannot hold them. */
const NEEDS_TYPE: ReadonlySet<PropertyKind> = new Set(['select', 'relation']);

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * "Add a property": its name, its kind, and — on a note of a type — whether it
 * goes on every note of the type (the default) or on this note alone.
 *
 * It stays open until the property is added or the person gives up: leaving
 * the name field for the kind is part of filling it in, not a reason to throw
 * the name away.
 */
export function AddPropertyPopover({
  existing,
  typeName,
  typeLabel,
  targets,
  onAdd,
  onClose,
}: {
  /** Every key the note already holds, which a new one may not take. */
  existing: readonly string[];
  typeName: string | null;
  /** The note's type as a person reads it; null when there is no type to add to. */
  typeLabel: string | null;
  targets: readonly RelationTarget[];
  onAdd: (property: NewProperty) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PropertyKind>('text');
  const [scope, setScope] = useState<'type' | 'note'>(typeLabel === null ? 'note' : 'type');
  const [target, setTarget] = useState(
    targets.find((candidate) => candidate.name === typeName)?.name ?? targets[0]?.name ?? '',
  );
  const [many, setMany] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Two panes can each have one open; their choices must not be one radio group.
  const group = useId();

  const { key, problem } = newPropertyKey(name, existing);
  const ready = key !== null && !adding && (kind !== 'relation' || target !== '');

  const chooseScope = (next: 'type' | 'note') => {
    setScope(next);
    if (next === 'note' && NEEDS_TYPE.has(kind)) setKind('text');
  };

  const add = () => {
    if (!ready) return;
    setAdding(true);
    setFailure(null);
    const relation = kind === 'relation';
    onAdd({
      label: name.trim(),
      key,
      kind,
      scope,
      target: relation ? target : null,
      many: relation && many,
    })
      .then(onClose)
      .catch((cause: unknown) => {
        setFailure(message(cause));
        setAdding(false);
      });
  };

  const shown = failure ?? problem;

  return (
    <div
      className="view-popover props__add-popover"
      role="dialog"
      aria-label="Add a property"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <form
        className="props__add-form"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <input
          className="props__add-name"
          aria-label="Property name"
          placeholder="Property name"
          // The popover exists because "Add a property" was just pressed.
          autoFocus
          value={name}
          aria-invalid={problem !== null}
          onChange={(event) => setName(event.target.value)}
        />
        <select
          className="props__add-kind"
          aria-label="Kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as PropertyKind)}
        >
          {PROPERTY_KINDS.map((candidate) => (
            <option
              key={candidate}
              value={candidate}
              disabled={scope === 'note' && NEEDS_TYPE.has(candidate)}
            >
              {KIND_LABELS[candidate]}
            </option>
          ))}
        </select>
        {kind === 'relation' && (
          <div className="props__add-relation">
            <select
              aria-label="Points at"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              {targets.map((candidate) => (
                <option key={candidate.name} value={candidate.name}>
                  {candidate.label}
                </option>
              ))}
            </select>
            <label className="props__add-option">
              <input
                type="checkbox"
                checked={many}
                onChange={(event) => setMany(event.target.checked)}
              />
              Several notes
            </label>
          </div>
        )}
        {typeLabel !== null && (
          <fieldset className="props__add-scope">
            <legend className="view-popover__title">Where</legend>
            <label className="props__add-option">
              <input
                type="radio"
                name={group}
                checked={scope === 'type'}
                onChange={() => chooseScope('type')}
              />
              {`Add to ${typeLabel} (every ${typeLabel.toLowerCase()})`}
            </label>
            <label className="props__add-option">
              <input
                type="radio"
                name={group}
                checked={scope === 'note'}
                onChange={() => chooseScope('note')}
              />
              Only this note
            </label>
          </fieldset>
        )}
        {shown !== null && (
          <span className="props__error" role="alert">
            {shown}
          </span>
        )}
        <div className="props__add-actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={!ready}>
            Add property
          </button>
        </div>
      </form>
    </div>
  );
}
