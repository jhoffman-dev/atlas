import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  NEW_PROPERTY_LABEL,
  PROPERTY_KINDS,
  propertyIcon,
  type ObjectType,
  type PropertyDef,
  type PropertyKind,
  type SidebarIcon,
  type TypeEdit,
} from '@atlas/domain';
import { CommitField } from './commit-field.tsx';
import { Icon, propertyGlyph, sidebarGlyph } from './icon.tsx';
import { OptionsEditor } from './options-editor.tsx';
import { SortableList } from './sortable-list.tsx';
import { Toggle } from './toggle.tsx';

/** A change that needs a decision before it is made: how many notes it touches, and the ways on. */
export interface TypeEditorPrompt {
  readonly text: string;
  readonly actions: readonly {
    readonly label: string;
    readonly primary?: boolean;
    readonly run: () => void;
  }[];
}

/** What the last change did, or why it could not be made. */
export interface TypeEditorNotice {
  readonly tone: 'done' | 'problem';
  readonly text: string;
  /** One line per note that could not be written, say. */
  readonly details?: readonly string[];
}

/** A type a relation can point at. */
export interface RelationTarget {
  readonly name: string;
  readonly label: string;
}

/**
 * Deleting the type: asked for through `onDelete`, or refused — a built-in
 * type — with the reason shown where the button would be.
 */
export interface TypeDeletion {
  /** Why the type cannot be deleted, or null when it can. */
  readonly refusal: string | null;
  readonly onDelete: () => void;
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
 * The type editor: a type's icon and its properties, each opened in place to
 * change its name, key, kind and what else its kind has — options for a
 * select, a target for a relation.
 *
 * Every change is handed over as a `TypeEdit` and made elsewhere; one that
 * would touch notes comes back as a `prompt` to decide on.
 */
export function TypeEditor({
  type,
  icons,
  targets,
  prompt,
  notice,
  onEdit,
  deletion,
}: {
  type: ObjectType;
  /** The glyphs a type may choose from. */
  icons: readonly SidebarIcon[];
  targets: readonly RelationTarget[];
  prompt: TypeEditorPrompt | null;
  notice: TypeEditorNotice | null;
  onEdit: (edit: TypeEdit) => void;
  /** Left out where the type cannot be deleted from here at all. */
  deletion?: TypeDeletion;
}) {
  // Which property is open, and where it was: when its key is renamed, the one
  // now standing in its place is the same property under its new key.
  const [open, setOpen] = useState<{ key: string; at: number } | null>(null);
  const openKey =
    open === null
      ? null
      : type.properties.some((property) => property.key === open.key)
        ? open.key
        : (type.properties[open.at]?.key ?? null);
  const count = type.properties.length;
  // A property just added opens, ready to be named.
  const added = useRef(count);
  useEffect(() => {
    const last = type.properties.at(-1);
    if (count > added.current && last !== undefined) setOpen({ key: last.key, at: count - 1 });
    added.current = count;
  }, [count, type.properties]);

  return (
    <div className="type-editor">
      {prompt !== null && <PromptCard prompt={prompt} />}
      {notice !== null && <NoticeLine notice={notice} />}

      <section className="type-editor__section" aria-labelledby="type-editor-icon">
        <h2 className="type-editor__heading" id="type-editor-icon">
          Icon
        </h2>
        <div className="type-editor__icons" role="group" aria-label="Icon">
          {icons.map((icon) => (
            <button
              key={icon}
              type="button"
              className="new-type__icon"
              aria-pressed={type.icon === icon}
              aria-label={`${icon} icon`}
              title={icon}
              onClick={() => onEdit({ kind: 'setIcon', icon: type.icon === icon ? null : icon })}
            >
              <Icon name={sidebarGlyph(icon)} size={17} />
            </button>
          ))}
        </div>
      </section>

      <section className="type-editor__section" aria-labelledby="type-editor-properties">
        <h2 className="type-editor__heading" id="type-editor-properties">
          Properties
        </h2>
        {count === 0 && <p className="type-editor__empty">No properties yet.</p>}
        <SortableList
          className="type-editor__properties"
          items={type.properties}
          idOf={(property) => property.key}
          nameOf={(property) => property.label}
          onMove={({ id, to }) => onEdit({ kind: 'moveProperty', key: id, to })}
        >
          {(property, handle) => (
            <PropertyRow
              property={property}
              handle={handle}
              expanded={openKey === property.key}
              onToggle={() =>
                setOpen(
                  openKey === property.key
                    ? null
                    : { key: property.key, at: type.properties.indexOf(property) },
                )
              }
              targets={targets}
              onEdit={onEdit}
            />
          )}
        </SortableList>
        <button
          type="button"
          className="btn btn--tinted type-editor__add"
          onClick={() => onEdit({ kind: 'addProperty', label: NEW_PROPERTY_LABEL })}
        >
          <Icon name="plus" size={15} />
          Add property
        </button>
      </section>

      {deletion !== undefined && <DeleteSection label={type.label} deletion={deletion} />}
    </div>
  );
}

/**
 * Deleting the type, last and apart. A built-in type keeps the button, turned
 * off, with the reason beside it — a missing button would only leave someone
 * looking for it.
 */
function DeleteSection({ label, deletion }: { label: string; deletion: TypeDeletion }) {
  const { refusal } = deletion;
  return (
    <section className="type-editor__section" aria-labelledby="type-editor-delete">
      <h2 className="type-editor__heading" id="type-editor-delete">
        Delete
      </h2>
      {refusal !== null && (
        <p className="type-editor__protected" id="type-editor-protected">
          <span className="type-editor__badge">Built in</span>
          {refusal}
        </p>
      )}
      <div>
        <button
          type="button"
          className="btn btn--secondary btn--sm type-editor__delete"
          disabled={refusal !== null}
          aria-describedby={refusal !== null ? 'type-editor-protected' : undefined}
          onClick={deletion.onDelete}
        >
          Delete {label}…
        </button>
      </div>
    </section>
  );
}

function PromptCard({ prompt }: { prompt: TypeEditorPrompt }) {
  const first = useRef<HTMLButtonElement>(null);
  // The decision is the next thing to do, so it takes the keyboard.
  useEffect(() => first.current?.focus(), [prompt]);

  return (
    <div
      className="type-editor__prompt"
      role="alertdialog"
      aria-label="Confirm change"
      aria-describedby="type-editor-prompt"
    >
      <p id="type-editor-prompt">{prompt.text}</p>
      <div className="type-editor__prompt-actions">
        {prompt.actions.map((action, at) => (
          <button
            key={action.label}
            ref={at === 0 ? first : undefined}
            type="button"
            className={action.primary === true ? 'btn btn--primary' : 'btn btn--secondary'}
            onClick={action.run}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NoticeLine({ notice }: { notice: TypeEditorNotice }) {
  return (
    <div
      className={`type-editor__notice type-editor__notice--${notice.tone}`}
      role={notice.tone === 'problem' ? 'alert' : 'status'}
    >
      <p>{notice.text}</p>
      {notice.details !== undefined && notice.details.length > 0 && (
        <ul>
          {notice.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PropertyRow({
  property,
  handle,
  expanded,
  onToggle,
  targets,
  onEdit,
}: {
  property: PropertyDef;
  handle: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  targets: readonly RelationTarget[];
  onEdit: (edit: TypeEdit) => void;
}) {
  const detailsId = `type-property-${property.key}`;
  return (
    <div className="type-editor__property">
      <div className="type-editor__summary">
        {handle}
        <Icon name={propertyGlyph(propertyIcon(property.kind))} className="type-editor__glyph" />
        <span className="type-editor__label">{property.label}</span>
        <span className="type-editor__kind">{KIND_LABELS[property.kind]}</span>
        {property.required && <span className="type-editor__badge">Required</span>}
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
        <span className="type-editor__row-label">Stored as</span>
        <CommitField
          value={key}
          label={`Key of ${label}`}
          className="type-editor__field type-editor__field--code"
          onCommit={(next) => onEdit({ kind: 'renameProperty', key, newKey: next, label })}
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
      <div className="type-editor__row">
        <span className="type-editor__row-label">Required</span>
        <Toggle
          label={`${label} is required`}
          checked={property.required}
          onChange={(required) => onEdit({ kind: 'setRequired', key, required })}
        />
      </div>
      {property.kind === 'relation' && (
        <RelationDetails property={property} targets={targets} onEdit={onEdit} />
      )}
      {hasOptions && <OptionsEditor property={property} onEdit={onEdit} />}
      <div className="type-editor__row type-editor__row--end">
        <button
          type="button"
          className="btn btn--ghost type-editor__remove"
          onClick={() => onEdit({ kind: 'removeProperty', key })}
        >
          Remove {label}
        </button>
      </div>
    </>
  );
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
      <div className="type-editor__row">
        <span className="type-editor__row-label">Several notes</span>
        <Toggle
          label={`${property.label} holds several notes`}
          checked={property.many}
          onChange={(many) => onEdit({ kind: 'setRelation', key: property.key, target, many })}
        />
      </div>
    </>
  );
}
