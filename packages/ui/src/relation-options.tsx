import { createVaultPath, relationGroupLabel } from '@atlas/domain';
import type { NoteNames } from '@atlas/domain';
import type { RelationChoice } from './properties-panel.tsx';

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
