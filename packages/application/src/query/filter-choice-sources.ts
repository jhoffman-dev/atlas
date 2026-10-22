import {
  relatedChoices,
  relationTypes,
  TAGS_PROPERTY,
  type FilterChoice,
  type FilterChoiceSources,
  type NoteNames,
  type ObjectType,
} from '@dfai/domain';
import type { IndexPort } from '../index/ports.ts';
import { loadTagCounts } from '../tags/load-tags.ts';
import { relationGroupLinks } from './relation-group-links.ts';

/**
 * What a type's filters can offer that only the index knows (#212): for each
 * relation, the notes it can point at, and the vault's tags when the type has
 * a `tags` property. Read only for the properties asked about — those a
 * Filter control is choosing a value for — so a view nobody filters asks the
 * index nothing.
 */
export async function loadFilterChoiceSources({
  index,
  type,
  names,
  keys,
}: {
  index: IndexPort;
  type: ObjectType;
  /** Links a note the way it is found, and reads it by the title a table shows. */
  names: NoteNames;
  /** The properties whose choices are wanted. */
  keys: readonly string[];
}): Promise<FilterChoiceSources> {
  const asked = type.properties.filter((property) => keys.includes(property.key));
  const relations = asked.filter((property) => property.kind === 'relation');
  const wantsTags = asked.some((property) => property.key === TAGS_PROPERTY);
  const [related, tags] = await Promise.all([
    Promise.all(
      relations.map(async (property): Promise<[string, FilterChoice[]]> => {
        const links = await relationGroupLinks({ index, targets: relationTypes(property), names });
        return [property.key, relatedChoices(links, names)];
      }),
    ),
    wantsTags ? loadTagCounts({ index }) : Promise.resolve([]),
  ]);
  return { tags: tags.map((tag) => tag.name), related: Object.fromEntries(related) };
}
