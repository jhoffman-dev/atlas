import { useEffect, useRef, useState } from 'react';
import {
  NEW_PROPERTY_LABEL,
  objectTypeIcon,
  type ObjectType,
  type SidebarIcon,
  type TypeEdit,
} from '@dfai/domain';
import { CommitField } from './commit-field.tsx';
import { Icon, sidebarGlyph } from './icon.tsx';
import { SortableList } from './sortable-list.tsx';
import { PropertyRow, type RelationTarget } from './type-editor-property.tsx';

export { KIND_LABELS, type RelationTarget } from './type-editor-property.tsx';

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

/**
 * Deleting the type: asked for through `onDelete`, or refused — a built-in
 * type — with the reason shown where the button would be.
 */
export interface TypeDeletion {
  /** Why the type cannot be deleted, or null when it can. */
  readonly refusal: string | null;
  readonly onDelete: () => void;
}

/** The view a type's notes open on, named, and how to go to it. */
export interface TypeDefaultView {
  readonly title: string;
  readonly onOpen: () => void;
}

export interface TypeEditorProps {
  type: ObjectType;
  /** The glyphs a type may choose from. */
  icons: readonly SidebarIcon[];
  targets: readonly RelationTarget[];
  prompt: TypeEditorPrompt | null;
  notice: TypeEditorNotice | null;
  onEdit: (edit: TypeEdit) => void;
  /** Left out where the type cannot be deleted from here at all. */
  deletion?: TypeDeletion;
  /** Opens the template new notes of the type start as; no row without it. */
  onOpenTemplate?: () => void;
  /** No row without it. */
  defaultView?: TypeDefaultView;
}

/**
 * The type editor, as the right sidebar holds it (slice 12, FlowType.dc.html):
 * the type's icon and name, its properties as rows that open in place — name,
 * kind, Allow many, Required on new notes, and what else the kind has —
 * then its template and default view, and a foot saying where edits land.
 *
 * Every change is handed over as a `TypeEdit` and made elsewhere; one that
 * would touch notes comes back as a `prompt` to decide on.
 */
export function TypeEditor(props: TypeEditorProps) {
  const { type, prompt, notice, deletion } = props;
  return (
    <div className="type-editor">
      <TypeHead type={type} icons={props.icons} onEdit={props.onEdit} />
      <div className="type-editor__body">
        {prompt !== null && <PromptCard prompt={prompt} />}
        {notice !== null && <NoticeLine notice={notice} />}
        <PropertiesSection type={type} targets={props.targets} onEdit={props.onEdit} />
        {deletion !== undefined && <DeleteSection label={type.label} deletion={deletion} />}
      </div>
      <TypeLinks
        label={type.label}
        {...(props.onOpenTemplate !== undefined && { onOpenTemplate: props.onOpenTemplate })}
        {...(props.defaultView !== undefined && { defaultView: props.defaultView })}
      />
      <p className="type-editor__foot">
        {notice?.tone === 'problem' ? 'Edits apply' : 'Saved · edits apply'} to every {type.label}{' '}
        note
      </p>
    </div>
  );
}

/** The icon tile, which opens the choice of glyphs, and the type's name, renamed in place. */
function TypeHead({ type, icons, onEdit }: Pick<TypeEditorProps, 'type' | 'icons' | 'onEdit'>) {
  const [choosing, setChoosing] = useState(false);
  return (
    <div className="type-editor__head">
      <div className="type-editor__identity">
        <button
          type="button"
          className="type-editor__tile"
          aria-label="Change icon"
          aria-expanded={choosing}
          aria-controls="type-editor-icons"
          title="Change icon"
          onClick={() => setChoosing((was) => !was)}
        >
          <Icon name={sidebarGlyph(objectTypeIcon(type))} size={17} />
        </button>
        <CommitField
          value={type.label}
          label="Name of this type"
          className="type-editor__name"
          onCommit={(label) => onEdit({ kind: 'setLabel', label })}
        />
      </div>
      {choosing && (
        <div className="type-editor__icons" id="type-editor-icons" role="group" aria-label="Icon">
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
      )}
    </div>
  );
}

function PropertiesSection({
  type,
  targets,
  onEdit,
}: Pick<TypeEditorProps, 'type' | 'targets' | 'onEdit'>) {
  // Which property is open, where it was, and how many there were: when its
  // key is renamed, the one now standing in its place — the list as long as
  // it was — is the same property under its new key. Removed, nothing is open.
  const [open, setOpen] = useState<{ key: string; at: number; count: number } | null>(null);
  const count = type.properties.length;
  const openKey =
    open === null
      ? null
      : type.properties.some((property) => property.key === open.key)
        ? open.key
        : open.count === count
          ? (type.properties[open.at]?.key ?? null)
          : null;
  const section = useRef<HTMLElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  // A property just added opens, ready to be named, with the focus in its Name.
  const added = useRef(count);
  const nameNew = useRef(false);
  useEffect(() => {
    const last = type.properties.at(-1);
    if (count > added.current && last !== undefined) {
      setOpen({ key: last.key, at: count - 1, count });
      nameNew.current = true;
    }
    added.current = count;
  }, [count, type.properties]);
  useEffect(() => {
    if (!nameNew.current || openKey === null) return;
    nameNew.current = false;
    section.current?.querySelector<HTMLInputElement>('.type-editor__details input')?.focus();
  }, [openKey]);
  const edit = (request: TypeEdit) => {
    onEdit(request);
    if (request.kind !== 'removeProperty') return;
    // The row and its button go; the focus goes where the next property would be added.
    setOpen(null);
    add.current?.focus();
  };

  return (
    <section
      ref={section}
      className="type-editor__section"
      aria-labelledby="type-editor-properties"
    >
      <h2 className="type-editor__heading" id="type-editor-properties">
        Properties
        <span className="type-editor__count">{count}</span>
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
                  : { key: property.key, at: type.properties.indexOf(property), count },
              )
            }
            targets={targets}
            onEdit={edit}
          />
        )}
      </SortableList>
      <button
        ref={add}
        type="button"
        className="btn btn--ghost btn--sm type-editor__add"
        onClick={() => onEdit({ kind: 'addProperty', label: NEW_PROPERTY_LABEL })}
      >
        <Icon name="plus" size={14} />
        Add property
      </button>
    </section>
  );
}

/** The template and default view, as label-and-value rows that go to them. */
function TypeLinks({
  label,
  onOpenTemplate,
  defaultView,
}: {
  label: string;
  onOpenTemplate?: () => void;
  defaultView?: TypeDefaultView;
}) {
  if (onOpenTemplate === undefined && defaultView === undefined) return null;
  return (
    <div className="type-editor__links">
      {onOpenTemplate !== undefined && (
        <LinkRow name="Template" value={label} onOpen={onOpenTemplate} />
      )}
      {defaultView !== undefined && (
        <LinkRow name="Default view" value={defaultView.title} onOpen={defaultView.onOpen} />
      )}
    </div>
  );
}

function LinkRow({ name, value, onOpen }: { name: string; value: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="type-editor__link"
      aria-label={`${name}: ${value}`}
      onClick={onOpen}
    >
      <span className="type-editor__link-name">{name}</span>
      <span className="type-editor__link-value">{value}</span>
    </button>
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
