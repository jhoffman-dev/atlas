import type { ObjectType, PropertyDef } from '../types/property-def.ts';
import { newNoteFolder } from '../vault/new-note-folder.ts';
import { VAULT_ROOT, type VaultPath } from '../vault/vault-path.ts';
import { QUICK_ADD_DEFAULT } from './quick-add-types.ts';

/** How many properties quick add asks for beside the title: more is a form, not a quick add. */
export const QUICK_ADD_FIELD_LIMIT = 3;

/**
 * The properties worth asking for while adding a note quickly, in the order
 * they are asked: whatever the type requires, then its first choice (a
 * task's status), then what it links to (a task's project), then its first
 * date (a task's due date) — at most three, each once.
 *
 * A checkbox is left out unless required: unticked is what it starts as anyway.
 */
export function quickAddFields(type: Pick<ObjectType, 'properties'>): readonly PropertyDef[] {
  const { properties } = type;
  const wanted = [
    ...properties.filter((property) => property.required),
    ...properties.filter((property) => property.kind === 'select').slice(0, 1),
    ...properties.filter((property) => property.kind === 'relation'),
    ...properties.filter((property) => property.kind === 'date').slice(0, 1),
  ];
  const unique = wanted.filter((property, at) => wanted.indexOf(property) === at);
  return unique.slice(0, QUICK_ADD_FIELD_LIMIT);
}

/** What each field starts as: a single choice at its first option, anything else empty. */
export function quickAddStartValues(fields: readonly PropertyDef[]): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => [field.key, field.kind === 'select' ? (field.options[0] ?? '') : '']),
  );
}

/**
 * What a quick-added note's frontmatter is changed by: its type, and every
 * field that was filled in, as the value its kind stores — a number as a
 * number, a relation to several notes as a list. An empty field is left out
 * rather than written as nothing, so a template's own value for it stands.
 */
export function quickAddProperties({
  type,
  fields,
  values,
}: {
  type: Pick<ObjectType, 'name'>;
  fields: readonly PropertyDef[];
  values: Readonly<Record<string, string>>;
}): Record<string, unknown> {
  const filled = fields
    .filter((field) => field.key !== 'type')
    .map((field) => [field.key, storedValue(field, (values[field.key] ?? '').trim())] as const)
    .filter(([, value]) => value !== null);
  return { type: type.name, ...Object.fromEntries(filled) };
}

function storedValue(field: PropertyDef, typed: string): unknown {
  if (typed === '') return null;
  if (field.kind === 'number') {
    const number = Number(typed);
    return Number.isFinite(number) ? number : typed;
  }
  if (field.kind === 'checkbox') return typed === 'true';
  if (field.kind === 'multiSelect') {
    const choices = typed
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');
    return choices.length === 0 ? null : choices;
  }
  if (field.kind === 'relation' && field.many) return [typed];
  return typed;
}

/**
 * The folder a quick-added note goes in.
 *
 * A task goes where a captured one (Shift+Cmd+N) does — beside the note in
 * view, or at the root — since quick add is capture with a few fields. A
 * type has no folder of its own to send anything else to, so anything else
 * goes at the root, as "New <type>" on a type's table puts it.
 */
export function quickAddFolder({
  type,
  beside,
}: {
  type: Pick<ObjectType, 'name'>;
  beside: VaultPath | null;
}): VaultPath {
  if (type.name !== QUICK_ADD_DEFAULT) return VAULT_ROOT;
  return newNoteFolder({ beside, properties: { type: type.name } });
}
