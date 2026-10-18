import { useRef, useState } from 'react';
import { createVaultPath, relationGroupLabel } from '@atlas/domain';
import type { NoteNames, VaultPath } from '@atlas/domain';
import { Icon } from './icon.tsx';
import type { CreateRelated, RelationChoice } from './properties-panel.tsx';

/**
 * The notes a relation's picker offers, each valued as the link to write.
 * Notes of more than one type are grouped under their type — PARA's under
 * their PARA value, Projects, Areas, Resources (#213) — so "Garden" the
 * project is not taken for "Garden" the area.
 */
export function RelationOptions({
  choices,
  names,
  optionValue = (choice) => names.linkTo(createVaultPath(choice.path)),
}: {
  choices: readonly RelationChoice[];
  names: Pick<NoteNames, 'linkTo'>;
  /** What picking a note gives; the link to write, unless said otherwise. */
  optionValue?: (choice: RelationChoice) => string;
}) {
  const option = (choice: RelationChoice) => (
    <option key={choice.path} value={optionValue(choice)}>
      {choice.title}
    </option>
  );
  const types = [...new Set(choices.map((choice) => choice.type))];
  if (types.length < 2) return <>{choices.map(option)}</>;
  return (
    <>
      {types.map((type) => (
        <optgroup key={type ?? ''} label={type === undefined ? 'Other' : relationGroupLabel(type)}>
          {choices.filter((choice) => choice.type === type).map(option)}
        </optgroup>
      ))}
    </>
  );
}

/**
 * The start of the picker's "New …" entries, each followed by the type it
 * makes. Never a link a note could have: a link is written `[[…]]`, and this
 * starts with a character no name can hold.
 */
const NEW_RELATED = '\u0000new';

/**
 * A relation's picker: the notes it may link, offered as a select that is
 * always back on its prompt, ready for the next one — and, where notes can
 * be made from here, a "New <type>…" entry per type it points at, which
 * asks for a name and links the note once it is made. Shared by the
 * properties panel and a table's relation cell.
 */
export function RelationPicker({
  id,
  choices,
  names,
  prompt,
  pointsAt,
  onPick,
  onCreateRelated,
}: {
  /** The select's id, for a label to point at. */
  id?: string;
  /** The notes not linked yet. */
  choices: readonly RelationChoice[];
  names: Pick<NoteNames, 'linkTo'>;
  /** What the select says while nothing is being picked: "Add a project…". */
  prompt: string;
  /** The types the relation points at; none, and there is nothing to offer. */
  pointsAt: readonly string[];
  /** Links the note picked, or the one made. */
  onPick: (link: string) => void;
  onCreateRelated?: CreateRelated;
}) {
  /** The type of the note being named for "New …", or null while none is. */
  const [naming, setNaming] = useState<string | null>(null);
  if (pointsAt.length === 0) return null;
  return (
    <>
      <span className="props__chip props__chip--add">
        <Icon name="plus" size={14} className="props__chip-icon" />
        <select
          id={id}
          className="props__chip-select"
          // Always back on the prompt, ready for the next one.
          value=""
          onChange={(event) => {
            const picked = event.target.value;
            if (picked === '') return;
            if (picked.startsWith(NEW_RELATED)) {
              setNaming(picked.slice(NEW_RELATED.length));
              return;
            }
            onPick(picked);
          }}
        >
          <option value="">{prompt}</option>
          <RelationOptions choices={choices} names={names} />
          {onCreateRelated !== undefined &&
            pointsAt.map((type) => (
              <option key={type} value={`${NEW_RELATED}${type}`}>
                New {type}…
              </option>
            ))}
        </select>
      </span>
      {naming !== null && onCreateRelated !== undefined && (
        <NewRelatedName
          target={naming}
          onCreate={(name) => onCreateRelated({ target: naming, name }).then(onPick)}
          onDone={() => setNaming(null)}
        />
      )}
    </>
  );
}

/** The name of a note about to be made from a relation's picker. */
function NewRelatedName({
  target,
  onCreate,
  onDone,
}: {
  target: string;
  onCreate: (name: string) => Promise<void>;
  onDone: () => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Read as the key lands, before a render: a second Enter while the first
  // note is still being made would make a second one.
  const busy = useRef(false);
  return (
    <span className="props__new-related">
      <input
        className="props__input"
        type="text"
        aria-label={`Name of the new ${target}`}
        aria-busy={creating}
        placeholder={`Name of the new ${target}`}
        readOnly={creating}
        autoFocus
        onKeyDown={(event) => {
          if (busy.current) return;
          if (event.key === 'Escape') {
            onDone();
            return;
          }
          if (event.key !== 'Enter') return;
          const name = event.currentTarget.value.trim();
          if (name === '') return;
          busy.current = true;
          setCreating(true);
          onCreate(name).then(onDone, (cause: unknown) => {
            busy.current = false;
            setCreating(false);
            setProblem(cause instanceof Error ? cause.message : String(cause));
          });
        }}
      />
      {problem !== null && (
        <span className="props__error" role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}

/** Whether `link` is a link to this note, by what it opens or, before that is known, by how it is written. */
export function linksTo(link: string, path: VaultPath, names: NoteNames): boolean {
  const opens = names.opens(link);
  return opens === null ? link.trim() === names.linkTo(path) : opens === path;
}
