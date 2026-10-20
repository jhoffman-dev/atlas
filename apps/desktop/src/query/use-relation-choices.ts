import { useCallback, useEffect, useState } from 'react';
import { relationTypes, type ObjectType } from '@atlas/domain';
import { notesInUseOfTypes, type IndexPort } from '@atlas/application';
import type { RelationChoice } from '@atlas/ui';

/** The notes each relation column may link, by its key. */
export type RelationChoicesByKey = Readonly<Record<string, readonly RelationChoice[]>>;

const NO_CHOICES: RelationChoicesByKey = {};
const NONE_WANTED: readonly string[] = [];

/** The relations whose notes have been asked for, and of which type. */
interface WantedKeys {
  readonly typeName: string | null;
  readonly keys: readonly string[];
}

/**
 * The notes a view's table offers in each relation cell's picker (#300):
 * read once a picker on that relation has opened, and again whenever the
 * index changes — never before, so a table nobody links from costs the index
 * nothing as it opens. The same notes the properties panel offers
 * (`notesInUseOfTypes`).
 */
export function useRelationChoices({
  type,
  index,
  indexKey,
}: {
  type: ObjectType | null;
  index: IndexPort;
  indexKey: string;
}): { choices: RelationChoicesByKey; want: (key: string) => void } {
  const typeName = type?.name ?? null;
  // Held with the type it was asked of: another type's relations are other relations.
  const [asked, setAsked] = useState<WantedKeys>({ typeName, keys: NONE_WANTED });
  const wanted = asked.typeName === typeName ? asked.keys : NONE_WANTED;
  const [choices, setChoices] = useState<RelationChoicesByKey>(NO_CHOICES);

  const want = useCallback(
    (key: string) =>
      setAsked((was) => {
        const keys = was.typeName === typeName ? was.keys : NONE_WANTED;
        return keys.includes(key) ? was : { typeName, keys: [...keys, key] };
      }),
    [typeName],
  );

  useEffect(() => {
    const relations = (type?.properties ?? []).filter(
      (def) => def.kind === 'relation' && wanted.includes(def.key),
    );
    if (relations.length === 0) {
      setChoices(NO_CHOICES);
      return;
    }
    let cancelled = false;
    Promise.all(
      relations.map(
        async (def) =>
          [def.key, await notesInUseOfTypes({ index, types: relationTypes(def) })] as const,
      ),
    )
      .then((pairs) => {
        if (!cancelled) setChoices(Object.fromEntries(pairs));
      })
      .catch(() => {
        // An index that is not ready yet offers nothing; the picker still opens.
        if (!cancelled) setChoices(NO_CHOICES);
      });
    return () => {
      cancelled = true;
    };
  }, [type, index, indexKey, wanted]);

  return { choices, want };
}
