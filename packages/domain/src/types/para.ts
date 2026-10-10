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
 * things go (U-22). These are the types that structure stands on.
 */
export const PROJECT_TYPE = 'project';
export const AREA_TYPE = 'area';
export const RESOURCE_TYPE = 'resource';

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

/** The PARA types, as written into a vault that lacks them. */
export const PARA_TYPE_FILES: readonly BuiltInTypeFile[] = [
  {
    type: {
      name: PROJECT_TYPE,
      label: 'Project',
      icon: 'board',
      properties: [
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
        {
          key: 'area',
          kind: 'relation',
          label: 'Area',
          required: false,
          options: [],
          target: AREA_TYPE,
          many: false,
        },
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
    body: '# Project\n\nSomething with an end: tasks, meetings and notes are filed under it.\n',
  },
  {
    type: { name: AREA_TYPE, label: 'Area', icon: 'folder', properties: [SUMMARY] },
    body: '# Area\n\nA responsibility with no end date — Health, Home, a team. Projects and notes are filed under it.\n',
  },
  {
    type: {
      name: RESOURCE_TYPE,
      label: 'Resource',
      icon: 'doc',
      properties: [
        FILED_UNDER,
        {
          key: 'url',
          kind: 'url',
          label: 'Link',
          required: false,
          options: [],
          target: null,
          many: false,
        },
        SUMMARY,
      ],
    },
    body: '# Resource\n\nReference worth keeping — an article, a manual, a how-to — filed under a project or an area.\n',
  },
];

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
 * What the vault's types lack for PARA: the PARA types it has no file for,
 * and the filed types without a `project` that can point at a project or an
 * area. Additive only — nothing the vault has is changed or taken away. A
 * property the vault already has under the key is left as it is, unless it is
 * a relation that already points at a project or an area: that one is given
 * the other as well. One pointing anywhere else is the vault's own choice.
 *
 * Types are matched by name in any case, as the disk matches their files.
 */
export function builtInTypePlan<Type extends ObjectType>(
  existing: readonly Type[],
): BuiltInTypePlan<Type> {
  const byName = new Map(existing.map((type) => [folded(type.name), type]));
  const missing = PARA_TYPE_FILES.filter((file) => !byName.has(file.type.name));
  const extensions = FILED_TYPES.flatMap((name) => {
    const type = byName.get(name);
    const extension = type === undefined ? null : filedUnder(type);
    return extension === null ? [] : [extension];
  });
  return { missing, filesByProject: byName.has(PROJECT_TYPE), extensions };
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
  if (labels.length === 1) return `Adds the ${labels[0] ?? ''} type.`;
  return `Adds the ${labels.slice(0, -1).join(', ')} and ${labels.at(-1) ?? ''} types.`;
}

function extensionLine({ before, added, widened }: TypeExtension): string {
  const gains = added.map(
    (property) =>
      `${before.label} gains ${property.label}, linking ${relationTypesText(property)} notes.`,
  );
  const wider = widened.map(
    (property) =>
      `${before.label}'s ${property.label} will link ${relationTypesText(property)} notes.`,
  );
  return [...gains, ...wider].join(' ');
}
