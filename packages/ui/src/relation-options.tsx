import { createVaultPath, humanizeKey } from '@atlas/domain';
import type { NoteNames } from '@atlas/domain';
import type { RelationChoice } from './properties-panel.tsx';

/**
 * The notes a relation's picker offers, each valued as the link to write.
 * Notes of more than one type — a relation to a project or an area — are
 * grouped under their type, so "Garden" the project is not taken for "Garden"
 * the area.
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
        <optgroup key={type ?? ''} label={type === undefined ? 'Other' : humanizeKey(type)}>
          {choices.filter((choice) => choice.type === type).map(option)}
        </optgroup>
      ))}
    </>
  );
}
