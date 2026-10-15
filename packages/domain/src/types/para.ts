import { MEETING_TYPE } from '../meetings/meeting-header.ts';
import {
  relationTypes,
  relationTypesText,
  type ObjectType,
  type PropertyDef,
} from './property-def.ts';

/**
 * PARA in Atlas: Projects and Areas are what everything is filed under,
 * Resources are reference kept for them, and the Archive is where finished
 * things go (U-22). One type holds all four (#213, ADR-0037): a Project
 * note's `para` says which it is, so moving one between them — into the
 * Archive and back out included — is a value, never a change of type.
 *
 * `area` and `resource` were types of their own before (P30-01). A vault may
 * still have notes of them; they are read as the PARA value they name, and
 * moving them onto the Project type is offered (`paraNoteChanges`).
 */
export const PROJECT_TYPE = 'project';
export const AREA_TYPE = 'area';
export const RESOURCE_TYPE = 'resource';

/** The key a Project note keeps its place in PARA under. */
export const PARA_KEY = 'para';

/**
 * Where archiving a PARA note keeps what its `para` was, for Unarchive to
 * give back (#213). Atlas writes and clears it; nothing requires it.
 */
export const PARA_BEFORE_ARCHIVE_KEY = 'para_before_archive';

/** Where a Project note stands in PARA. */
export type ParaValue = 'project' | 'area' | 'resource' | 'archive';

/** The four, in the order PARA reads them and pickers group them. */
export const PARA_VALUES: readonly ParaValue[] = ['project', 'area', 'resource', 'archive'];

/** What a Project note with no `para` — or one Atlas cannot read — is. */
export const DEFAULT_PARA: ParaValue = 'project';

/** The value that puts a Project note away: archived without moving its file. */
export const ARCHIVED_PARA: ParaValue = 'archive';

/** `para` on the Project type: optional, so nothing a person saves is refused for want of it. */
export const PARA_PROPERTY: PropertyDef = {
  key: PARA_KEY,
  kind: 'select',
  label: 'PARA',
  required: false,
  options: PARA_VALUES,
  target: null,
  many: false,
};

/** `area` on the Project type: the area a project is part of, optional. */
export const AREA_PROPERTY: PropertyDef = {
  key: 'area',
  kind: 'relation',
  label: 'Area',
  required: false,
  options: [],
  target: AREA_TYPE,
  many: false,
};

/** The property a note is filed under a project or an area by. */
export const FILED_UNDER_KEY = 'project';

/** What a note can be filed under. */
export const FILED_UNDER_TYPES: readonly string[] = [PROJECT_TYPE, AREA_TYPE];

/** `project`, pointing at a project or an area: what every filed type carries. */
export const FILED_UNDER: PropertyDef = {
  key: FILED_UNDER_KEY,
  kind: 'relation',
  label: 'Project',
  required: false,
  options: [],
  target: PROJECT_TYPE,
  targets: FILED_UNDER_TYPES,
  many: false,
};

const SUMMARY: PropertyDef = {
  key: 'description',
  kind: 'text',
  label: 'Summary',
  required: false,
  options: [],
  target: null,
  many: false,
};

/** A built-in type as Atlas writes it into a vault that has none, and what its file says. */
export interface BuiltInTypeFile {
  readonly type: ObjectType;
  /** The body under the frontmatter, so the file reads as what it is anywhere else. */
  readonly body: string;
}

/**
 * The PARA type, as written into a vault that lacks it: Project, whose `para`
 * makes it a project, an area, a resource or archived (#213).
 */
export const PROJECT_TYPE_FILE: BuiltInTypeFile = {
  type: {
    name: PROJECT_TYPE,
    label: 'Project',
    icon: 'board',
    properties: [
      PARA_PROPERTY,
      {
        key: 'status',
        kind: 'select',
        label: 'Status',
        required: false,
        options: ['planned', 'active', 'paused', 'done'],
        target: null,
        many: false,
        done: 'done',
      },
      AREA_PROPERTY,
      {
        key: 'due',
        kind: 'date',
        label: 'Due',
        required: false,
        options: [],
        target: null,
        many: false,
      },
      SUMMARY,
    ],
  },
  body: '# Project\n\nA project, an area, a resource or archived — its PARA says which. Tasks, meetings and notes are filed under projects and areas.\n',
};

/** The PARA types, as written into a vault that lacks them: the one Project type. */
export const PARA_TYPE_FILES: readonly BuiltInTypeFile[] = [PROJECT_TYPE_FILE];

/**
 * The built-in types notes are filed by, when the vault has them: each gains
 * `project`, pointing at a project or an area. Atlas does not write these
 * types into a vault that lacks them; other features do (U-20).
 */
const FILED_TYPES: readonly string[] = ['task', MEETING_TYPE, RESOURCE_TYPE];

/** What a vault's own type lacks of what Atlas needs it to have. */
export interface TypeExtension<Type extends ObjectType = ObjectType> {
  /** The type as the vault has it. */
  readonly before: Type;
  readonly after: ObjectType;
  /** The properties it gains. */
  readonly added: readonly PropertyDef[];
  /** Its relations that gain types to point at, as they will be. */
  readonly widened: readonly PropertyDef[];
}

/** The property keys an extension adds or widens: what an offer to make it shows. */
export function extensionKeys(extension: TypeExtension): ReadonlySet<string> {
  return new Set([...extension.added, ...extension.widened].map((property) => property.key));
}

/**
 * The part of `extension` that touches only `keys` — what an offer showed for
 * its type — or null when none of it does. Worked out again from the type as
 * the extension found it, so a change nobody was shown is never written.
 */
export function extensionWithin<Type extends ObjectType>(
  extension: TypeExtension<Type>,
  keys: ReadonlySet<string>,
): TypeExtension<Type> | null {
  const added = extension.added.filter((property) => keys.has(property.key));
  const widened = extension.widened.filter((property) => keys.has(property.key));
  if (added.length + widened.length === 0) return null;
  const wider = new Map(widened.map((property) => [property.key, property]));
  const { before } = extension;
  const properties = before.properties.map((property) => wider.get(property.key) ?? property);
  return {
    before,
    after: { ...before, properties: [...properties, ...added] },
    added,
    widened,
  };
}

/** What making a vault's types whole for PARA would do. */
export interface BuiltInTypePlan<Type extends ObjectType = ObjectType> {
  /** The PARA types the vault has no file for. */
  readonly missing: readonly BuiltInTypeFile[];
  /**
   * Whether the vault already files by project — it has a Project type — so
   * the rest of PARA is simply written in. A vault without one has not taken
   * PARA up, and is only offered it.
   */
  readonly filesByProject: boolean;
  /** The vault's own types that would gain a property, or a type for a relation to point at. */
  readonly extensions: readonly TypeExtension<Type>[];
}

/** A vault's type name as the disk compares its file's: in any case. */
const folded = (name: string) => name.trim().toLowerCase();

/**
 * What the vault's types lack for PARA: the PARA types it has no file for;
 * on its Project type, the `para` and `area` it was written without (#213);
 * and the filed types without a `project` that can point at a project or an
 * area. Additive only — nothing the vault has is changed or taken away. A
 * property the vault already has under the key is left as it is, unless it is
 * a relation that already points at a project or an area: that one is given
 * the other as well. One pointing anywhere else is the vault's own choice.
 *
 * Types are matched by name in any case, as the disk matches their files. A
 * type two files claim is offered nothing until they are merged.
 */
export function builtInTypePlan<Type extends ObjectType>(
  existing: readonly Type[],
): BuiltInTypePlan<Type> {
  const byName = new Map(existing.map((type) => [folded(type.name), type]));
  const missing = PARA_TYPE_FILES.filter((file) => !byName.has(file.type.name));
  const project = onlyTypeNamed(existing, PROJECT_TYPE);
  const projectExtension = project === null ? null : withParaKeys(project);
  const filed = FILED_TYPES.flatMap((name) => {
    const type = onlyTypeNamed(existing, name);
    const extension = type === null ? null : filedUnder(type);
    return extension === null ? [] : [extension];
  });
  return {
    missing,
    filesByProject: byName.has(PROJECT_TYPE),
    extensions: [...(projectExtension === null ? [] : [projectExtension]), ...filed],
  };
}

/**
 * The vault's type of `name`, in any case — or null when it has none, or two
 * files claim it: which one a feature reads is not the offer's to pick.
 */
function onlyTypeNamed<Type extends ObjectType>(
  existing: readonly Type[],
  name: string,
): Type | null {
  const claiming = existing.filter((type) => folded(type.name) === name);
  return claiming.length === 1 ? (claiming[0] ?? null) : null;
}

/** What a Project type lacks of `para` and `area`, or null when it has both keys, in whatever shape. */
function withParaKeys<Type extends ObjectType>(type: Type): TypeExtension<Type> | null {
  const has = new Set(type.properties.map((property) => property.key));
  const added = [PARA_PROPERTY, AREA_PROPERTY].filter((property) => !has.has(property.key));
  if (added.length === 0) return null;
  return {
    before: type,
    after: { ...type, properties: [...type.properties, ...added] },
    added,
    widened: [],
  };
}

/** What `type` lacks to be filed under a project or an area, or null when nothing. */
function filedUnder<Type extends ObjectType>(type: Type): TypeExtension<Type> | null {
  const own = type.properties.find((property) => property.key === FILED_UNDER_KEY);
  if (own === undefined) {
    return {
      before: type,
      after: { ...type, properties: [...type.properties, FILED_UNDER] },
      added: [FILED_UNDER],
      widened: [],
    };
  }
  const widened = widenedRelation(own);
  if (widened === null) return null;
  return {
    before: type,
    after: {
      ...type,
      properties: type.properties.map((property) => (property === own ? widened : property)),
    },
    added: [],
    widened: [widened],
  };
}

/** The relation pointing at a project or an area as well, or null when it already does or is not ours to widen. */
function widenedRelation(own: PropertyDef): PropertyDef | null {
  if (own.kind !== 'relation') return null;
  const types = relationTypes(own);
  if (!types.some((name) => FILED_UNDER_TYPES.includes(name))) return null;
  const more = FILED_UNDER_TYPES.filter((name) => !types.includes(name));
  if (more.length === 0) return null;
  return { ...own, targets: [...types, ...more] };
}

/**
 * What setting the vault's types up for PARA would do, one line per change,
 * in the words the offer to do it shows: "Adds the Project, Area and Resource
 * types." / "Task gains Project, linking project or area notes." / "Meeting's
 * Project will link project or area notes."
 */
export function typeSetupLines({
  types,
  extensions,
}: {
  types: readonly BuiltInTypeFile[];
  extensions: readonly TypeExtension[];
}): string[] {
  const adds = types.length === 0 ? [] : [addedTypesLine(types.map((file) => file.type.label))];
  return [...adds, ...extensions.map(extensionLine)];
}

function addedTypesLine(labels: readonly string[]): string {
  return `Adds the ${listed(labels)} ${labels.length === 1 ? 'type' : 'types'}.`;
}

function extensionLine({ before, added, widened }: TypeExtension): string {
  const links = added.filter((property) => property.kind === 'relation');
  const plain = added.filter((property) => property.kind !== 'relation');
  const gains = links.map(
    (property) =>
      `${before.label} gains ${property.label}, linking ${relationTypesText(property)} notes.`,
  );
  const fields =
    plain.length === 0 ? [] : [`${before.label} gains ${listed(plain.map((p) => p.label))}.`];
  const wider = widened.map(
    (property) =>
      `${before.label}'s ${property.label} will link ${relationTypesText(property)} notes.`,
  );
  return [...gains, ...fields, ...wider].join(' ');
}

/** "A", "A and B", "A, B and C". */
export function listed(words: readonly string[]): string {
  if (words.length < 2) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;
}
