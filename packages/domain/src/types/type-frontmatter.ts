import { humanizeKey } from '../page/property-label.ts';
import type { ObjectType, PropertyDef } from './property-def.ts';

/**
 * A property as it is written in a type file: the shorthand `due: date` when
 * the kind is all there is to say, otherwise a map holding only what differs
 * from the defaults `parseObjectType` fills in — so a written type reads the
 * way one written by hand does, and parses back to the same thing.
 */
export function propertySpec(property: PropertyDef): string | Record<string, unknown> {
  const spec: Record<string, unknown> = { kind: property.kind };
  if (property.label !== humanizeKey(property.key)) spec['label'] = property.label;
  if (property.options.length > 0) spec['options'] = [...property.options];
  if (property.colors !== undefined && Object.keys(property.colors).length > 0) {
    spec['colors'] = { ...property.colors };
  }
  if (property.done !== undefined) spec['done'] = property.done;
  if (property.target !== null) spec['target'] = property.target;
  // multiSelect is many by definition, and saying so again is noise.
  if (property.many && property.kind !== 'multiSelect') spec['many'] = true;
  if (property.required) spec['required'] = true;
  return Object.keys(spec).length === 1 ? property.kind : spec;
}

/**
 * The frontmatter keys a type file is rewritten with. `name` is left out: it is
 * what notes declare, and an edit never changes it. A missing icon is null, so
 * the key is removed rather than left behind.
 */
export function typeFrontmatter(type: ObjectType): Record<string, unknown> {
  return {
    label: type.label,
    icon: type.icon ?? null,
    properties: Object.fromEntries(
      type.properties.map((property) => [property.key, propertySpec(property)]),
    ),
  };
}

/** The keys of a property's spec that `parseObjectType` reads; any other is the file's own. */
const SPEC_KEYS = new Set([
  'kind',
  'label',
  'options',
  'colors',
  'done',
  'target',
  'many',
  'required',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sameProperty = (a: PropertyDef | undefined, b: PropertyDef): boolean =>
  a !== undefined &&
  a.key === b.key &&
  JSON.stringify(propertySpec(a)) === JSON.stringify(propertySpec(b));

/**
 * What an edit changes in a type file's frontmatter, and only that: a file
 * written by hand can hold what `parseObjectType` does not read — an icon the
 * app does not offer, a kind it does not know, a key inside a spec, a colour off
 * its palette — and writing the whole type back would delete all of it.
 *
 * `before` is the type as read from `written`, the file's frontmatter as it
 * stands, and `after` the type the edit left. The label and icon are changed
 * only when they differ. When the properties differ, the map is rebuilt from
 * `written`: a property the edit left alone keeps what was written for it, an
 * edited one has its spec merged into what was written, and one the parser
 * skipped stays where it was.
 */
export function typeFrontmatterChanges({
  before,
  after,
  written,
}: {
  before: ObjectType;
  after: ObjectType;
  written: Readonly<Record<string, unknown>>;
}): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (after.label !== before.label) changes['label'] = after.label;
  if ((after.icon ?? null) !== (before.icon ?? null)) changes['icon'] = after.icon ?? null;
  const unchanged =
    after.properties.length === before.properties.length &&
    after.properties.every((property, at) => sameProperty(before.properties[at], property));
  if (!unchanged) {
    changes['properties'] = writtenProperties({
      before,
      after,
      written: isRecord(written['properties']) ? written['properties'] : {},
    });
  }
  return changes;
}

/**
 * The key each property of `after` had in `before`. A rename is one edit: the
 * lists are as long as each other and differ at one place, by a key that is
 * new standing where one that is gone stood.
 */
function formerKeys(before: ObjectType, after: ObjectType): Map<string, string> {
  const beforeKeys = new Set(before.properties.map((property) => property.key));
  const afterKeys = new Set(after.properties.map((property) => property.key));
  const former = new Map(after.properties.map((property) => [property.key, property.key]));
  if (before.properties.length !== after.properties.length) return former;
  before.properties.forEach((old, at) => {
    const now = after.properties[at];
    if (now !== undefined && !afterKeys.has(old.key) && !beforeKeys.has(now.key)) {
      former.set(now.key, old.key);
    }
  });
  return former;
}

function writtenProperties({
  before,
  after,
  written,
}: {
  before: ObjectType;
  after: ObjectType;
  written: Readonly<Record<string, unknown>>;
}): Record<string, unknown> {
  const beforeByKey = new Map(before.properties.map((property) => [property.key, property]));
  const former = formerKeys(before, after);
  const oldKey = (property: PropertyDef) => former.get(property.key) ?? property.key;
  const spec = (property: PropertyDef) => {
    const was = beforeByKey.get(oldKey(property));
    const raw = written[oldKey(property)];
    if (was !== undefined && sameProperty(was, property)) return raw;
    return mergedSpec({ raw, spec: propertySpec(property), was });
  };
  // Properties that were read before and still are fill the places those held,
  // in their new order; the ones the parser skipped are never moved.
  const kept = after.properties.filter((property) => Object.hasOwn(written, oldKey(property)));
  const keptOldKeys = new Set(kept.map(oldKey));
  const entries: [string, unknown][] = [];
  let next = 0;
  for (const [key, raw] of Object.entries(written)) {
    if (!beforeByKey.has(key)) entries.push([key, raw]);
    else if (keptOldKeys.has(key)) {
      const property = kept[next++]!;
      entries.push([property.key, spec(property)]);
    }
  }
  for (const property of after.properties) {
    if (!keptOldKeys.has(oldKey(property))) entries.push([property.key, spec(property)]);
  }
  return Object.fromEntries(entries);
}

/**
 * An edited property's spec written into what was there: keys the parser does
 * not read are kept where they stood, as are colours it could not read.
 */
function mergedSpec({
  raw,
  spec,
  was,
}: {
  raw: unknown;
  spec: string | Record<string, unknown>;
  was: PropertyDef | undefined;
}): unknown {
  if (!isRecord(raw)) return spec;
  const wanted = typeof spec === 'string' ? { kind: spec } : spec;
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!SPEC_KEYS.has(key)) merged[key] = value;
    else if (key === 'colors') {
      const colors = mergedColors({ raw: value, wanted: wanted['colors'], was });
      if (colors !== null) merged[key] = colors;
    } else if (Object.hasOwn(wanted, key)) merged[key] = wanted[key];
  }
  for (const [key, value] of Object.entries(wanted)) {
    if (!Object.hasOwn(merged, key) && !(key === 'colors' && Object.hasOwn(raw, key))) {
      merged[key] = value;
    }
  }
  return merged;
}

function mergedColors({
  raw,
  wanted,
  was,
}: {
  raw: unknown;
  wanted: unknown;
  was: PropertyDef | undefined;
}): Record<string, unknown> | null {
  const colors = isRecord(wanted) ? wanted : {};
  const read = was?.colors ?? {};
  const merged: Record<string, unknown> = {};
  for (const [option, tone] of Object.entries(isRecord(raw) ? raw : {})) {
    if (Object.hasOwn(colors, option)) merged[option] = colors[option];
    else if (!Object.hasOwn(read, option)) merged[option] = tone;
  }
  for (const [option, tone] of Object.entries(colors)) {
    if (!Object.hasOwn(merged, option)) merged[option] = tone;
  }
  return Object.keys(merged).length === 0 ? null : merged;
}

/**
 * The whole frontmatter of a new type file. An empty `properties` is left out
 * rather than written as `{}`: an inline map stays inline when edited, and the
 * first property added should start the block a person would write by hand.
 */
export function newTypeFrontmatter(type: ObjectType): Record<string, unknown> {
  const { properties, ...rest } = typeFrontmatter(type);
  return {
    name: type.name,
    ...rest,
    ...(type.properties.length > 0 && { properties }),
  };
}
