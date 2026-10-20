import type { ReactNode } from 'react';
import {
  PROPERTY_KINDS,
  propertyIcon,
  relationTypes,
  type PropertyDef,
  type PropertyKind,
  type TypeEdit,
} from '@atlas/domain';
import { CommitField } from './commit-field.tsx';
import { Icon, propertyGlyph } from './icon.tsx';
import { OptionsEditor } from './options-editor.tsx';

/** A type a relation can point at. */
export interface RelationTarget {
  readonly name: string;
  readonly label: string;
}

/** What each kind of property is called where one is chosen. */
export const KIND_LABELS: Readonly<Record<PropertyKind, string>> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  checkbox: 'Checkbox',
  select: 'Select',
  multiSelect: 'Multi-select',
  url: 'URL',
  relation: 'Relation',
  thumbnail: 'Thumbnail',
};

/**
 * A property's kind as its closed row says it: a relation by the type it
 * points at — "Person, many" — so the row reads without being opened.
 */
export function kindSummary(property: PropertyDef, targets: readonly RelationTarget[]): string {
  if (property.kind !== 'relation' || property.target === null) return KIND_LABELS[property.kind];
  const target = targets.find((each) => each.name === property.target)?.label ?? property.target;
  return property.many ? `${target}, many` : target;
}

interface PropertyRowProps {
  property: PropertyDef;
  handle: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  targets: readonly RelationTarget[];
  onEdit: (edit: TypeEdit) => void;
}

/** One property: a closed row — grip, glyph, name, kind, chevron — that opens in place. */
export function PropertyRow({
  property,
  handle,
  expanded,
  onToggle,
  targets,
  onEdit,
}: PropertyRowProps) {
  const detailsId = `type-property-${property.key}`;
  return (
    <div className={`type-editor__property${expanded ? ' type-editor__property--open' : ''}`}>
      <div className="type-editor__summary">
        {handle}
        <Icon name={propertyGlyph(propertyIcon(property.kind))} className="type-editor__glyph" />
        <span className="type-editor__label">{property.label}</span>
        <span className="type-editor__kind">{kindSummary(property, targets)}</span>
        <button
          type="button"
          className="icon-button type-editor__expand"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`Edit ${property.label}`}
          onClick={onToggle}
        >
          <Icon name="chevron" size={14} />
        </button>
      </div>
      {expanded && (
        <div className="type-editor__details" id={detailsId}>
          <PropertyDetails property={property} targets={targets} onEdit={onEdit} />
        </div>
      )}
    </div>
  );
}

function PropertyDetails({
  property,
  targets,
  onEdit,
}: {
  property: PropertyDef;
  targets: readonly RelationTarget[];
  onEdit: (edit: TypeEdit) => void;
}) {
  const { key, label } = property;
  const hasOptions = property.kind === 'select' || property.kind === 'multiSelect';

  return (
    <>
      <label className="type-editor__row">
        <span className="type-editor__row-label">Name</span>
        <CommitField
          value={label}
          label={`Name of ${label}`}
          onCommit={(next) => onEdit({ kind: 'renameProperty', key, newKey: key, label: next })}
        />
      </label>
      <label className="type-editor__row">
        <span className="type-editor__row-label">Kind</span>
        <select
          className="type-editor__field"
          aria-label={`Kind of ${label}`}
          value={property.kind}
          onChange={(event) =>
            onEdit({ kind: 'changeKind', key, propertyKind: event.target.value as PropertyKind })
          }
        >
          {PROPERTY_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </label>
      {property.kind === 'relation' && (
        <RelationDetails property={property} targets={targets} onEdit={onEdit} />
      )}
      <PropertyFlags property={property} onEdit={onEdit} />
      <label className="type-editor__row">
        <span className="type-editor__row-label">Stored as</span>
        <CommitField
          value={key}
          label={`Key of ${label}`}
          className="type-editor__field type-editor__field--code"
          onCommit={(next) => onEdit({ kind: 'renameProperty', key, newKey: next, label })}
        />
      </label>
      {hasOptions && <OptionsEditor property={property} onEdit={onEdit} />}
      <div className="type-editor__row type-editor__row--end">
        <button
          type="button"
          className="btn btn--ghost btn--sm type-editor__remove"
          onClick={() => onEdit({ kind: 'removeProperty', key })}
        >
          Remove {label}
        </button>
      </div>
    </>
  );
}

/**
 * What a property is allowed: several values, where its kind can hold them,
 * and whether new notes are asked for it. "Allow many" is no new setting: a
 * select that allows many is a multi-select, and a relation says `many`.
 * "Required" prompts on a note and never blocks one (plan question 10).
 */
function PropertyFlags({
  property,
  onEdit,
}: {
  property: PropertyDef;
  onEdit: (edit: TypeEdit) => void;
}) {
  const { key } = property;
  const many = allowMany(property);
  return (
    <div className="type-editor__flags">
      {many !== null && (
        <label className="type-editor__flag">
          <input
            type="checkbox"
            checked={many.on}
            onChange={(event) => onEdit(many.set(event.target.checked))}
          />
          Allow many
        </label>
      )}
      <label className="type-editor__flag">
        <input
          type="checkbox"
          checked={property.required}
          onChange={(event) => onEdit({ kind: 'setRequired', key, required: event.target.checked })}
        />
        Required on new notes
      </label>
    </div>
  );
}

/** Whether a property holds several values, and the edit that changes it; null for a kind of one. */
function allowMany(property: PropertyDef): { on: boolean; set: (on: boolean) => TypeEdit } | null {
  const { key } = property;
  if (property.kind === 'select' || property.kind === 'multiSelect') {
    return {
      on: property.kind === 'multiSelect',
      set: (on) => ({ kind: 'changeKind', key, propertyKind: on ? 'multiSelect' : 'select' }),
    };
  }
  if (property.kind === 'relation') {
    const target = property.target ?? '';
    return { on: property.many, set: (on) => ({ kind: 'setRelation', key, target, many: on }) };
  }
  return null;
}

function RelationDetails({
  property,
  targets,
  onEdit,
}: {
  property: PropertyDef;
  targets: readonly RelationTarget[];
  onEdit: (edit: TypeEdit) => void;
}) {
  const target = property.target ?? '';
  const others = relationTypes(property).filter((name) => name !== target);
  return (
    <>
      <label className="type-editor__row">
        <span className="type-editor__row-label">Points at</span>
        <select
          className="type-editor__field"
          aria-label={`Type ${property.label} points at`}
          value={target}
          onChange={(event) =>
            onEdit({
              kind: 'setRelation',
              key: property.key,
              target: event.target.value,
              many: property.many,
            })
          }
        >
          {targets.map((choice) => (
            <option key={choice.name} value={choice.name}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      {/* Written as a list in the type file; kept unless "Points at" is changed. */}
      {others.length > 0 && (
        <div className="type-editor__row">
          <span className="type-editor__row-label">And at</span>
          <span>{others.join(', ')}</span>
        </div>
      )}
    </>
  );
}
