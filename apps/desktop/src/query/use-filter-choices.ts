import { useEffect, useMemo, useState } from 'react';
import {
  filterChoices,
  NO_CHOICE_SOURCES,
  type FilterChoice,
  type FilterChoiceSources,
  type NoteNames,
  type ObjectType,
} from '@atlas/domain';
import { loadFilterChoiceSources, type IndexPort } from '@atlas/application';

/** Each property's filter choices, by key. */
export type FilterChoicesByKey = Readonly<Record<string, readonly FilterChoice[]>>;

/**
 * What the Filter control offers for each property of a view's type (#212):
 * a select's options at once, and a relation's notes and the vault's tags
 * once the index has answered — again whenever it changes.
 */
export function useFilterChoices({
  type,
  index,
  indexKey,
  names,
}: {
  type: ObjectType | null;
  index: IndexPort;
  indexKey: string;
  names: NoteNames;
}): FilterChoicesByKey {
  const [sources, setSources] = useState<FilterChoiceSources>(NO_CHOICE_SOURCES);

  useEffect(() => {
    if (type === null) {
      setSources(NO_CHOICE_SOURCES);
      return;
    }
    let cancelled = false;
    loadFilterChoiceSources({ index, type, names })
      .then((loaded) => {
        if (!cancelled) setSources(loaded);
      })
      .catch(() => {
        // An index that is not ready yet offers no notes or tags; the
        // options still show, and any value can still be typed.
        if (!cancelled) setSources(NO_CHOICE_SOURCES);
      });
    return () => {
      cancelled = true;
    };
  }, [index, type, indexKey, names]);

  return useMemo(
    () =>
      Object.fromEntries(
        (type?.properties ?? []).map((property) => [
          property.key,
          filterChoices(property, sources),
        ]),
      ),
    [type, sources],
  );
}
