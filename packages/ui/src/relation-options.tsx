import { createVaultPath } from '@dfai/domain';
import type { NoteNames, VaultPath } from '@dfai/domain';
import { Icon } from './icon.tsx';
import { LinkCombobox } from './link-suggest/link-combobox.tsx';
import type { CreateLink } from './link-suggest/link-suggestions.tsx';
import type { CreateRelated, RelationChoice } from './properties-panel.tsx';

/**
 * A relation's picker: a field that suggests the notes it may link as you
 * type (#465) — and, where notes can be made from here, "Create <type>
 * '<typed>'" when none is called what was typed, which makes the note and
 * links it. Each pick hands over the link to write, as the note is found
 * (`linkTo`). Shared by the properties panel and a table's relation cell.
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
  /** The field's id, for a label to point at. */
  id?: string;
  /** The notes not linked yet. */
  choices: readonly RelationChoice[];
  names: Pick<NoteNames, 'linkTo'>;
  /** What the field says while nothing is typed: "Add a project…". */
  prompt: string;
  /** The types the relation points at; none, and there is nothing to offer. */
  pointsAt: readonly string[];
  /** Links the note picked, or the one made. */
  onPick: (link: string) => void;
  onCreateRelated?: CreateRelated;
}) {
  if (pointsAt.length === 0) return null;
  return (
    <span className="props__chip props__chip--add">
      <Icon name="plus" size={14} className="props__chip-icon" />
      <LinkCombobox
        {...(id === undefined ? { label: prompt } : { id })}
        className="props__chip-select"
        placeholder={prompt}
        choices={choices}
        onPick={(choice) => onPick(names.linkTo(createVaultPath(choice.path)))}
        {...(onCreateRelated !== undefined && {
          creates: pointsAt,
          onCreate: (request: CreateLink) => onCreateRelated(request).then(onPick),
        })}
      />
    </span>
  );
}

/** Whether `link` is a link to this note, by what it opens or, before that is known, by how it is written. */
export function linksTo(link: string, path: VaultPath, names: NoteNames): boolean {
  const opens = names.opens(link);
  return opens === null ? link.trim() === names.linkTo(path) : opens === path;
}
