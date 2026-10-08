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
}: {
  choices: readonly RelationChoice[];
  names: Pick<NoteNames, 'linkTo'>;
}) {
  const option = (choice: RelationChoice) => (
    <option key={choice.path} value={names.linkTo(createVaultPath(choice.path))}>
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
