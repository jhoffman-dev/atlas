import type { ObjectType } from '@atlas/domain';
import type { TableSchema } from '@atlas/ui';

/**
 * How a type heads and fills a table: each property's kind and label, and the
 * type's name. The same for a saved view's table and a type's own, so a
 * choice is a status pill in both.
 */
export function schemaOf(type: ObjectType | null, fallbackNoun: string): TableSchema {
  const properties = type?.properties ?? [];
  return {
    kinds: Object.fromEntries(properties.map((def) => [def.key, def.kind])),
    labels: Object.fromEntries(properties.map((def) => [def.key, def.label])),
    noun: type?.label ?? fallbackNoun,
  };
}
