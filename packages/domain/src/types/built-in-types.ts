import { ARTIFACT_TYPE } from '../artifacts/artifact.ts';
import { MEETING_TYPE } from '../meetings/meeting-header.ts';
import { COMPANY_TYPE } from '../people/company.ts';
import { PERSON_TYPE } from '../people/person.ts';
import { TERM_TYPE } from '../terms/term.ts';
import { DECISION_TYPE, PROPOSAL_TYPE } from '../proposals/proposal.ts';
import { vaultPathName, type VaultPath } from '../vault/vault-path.ts';
import { TYPES_DIRECTORY } from '../vault/vault-visibility.ts';
import { AREA_TYPE, RESOURCE_TYPE } from './para.ts';

/**
 * The types a feature of Atlas is built on, and what would stop working
 * without each. Their properties are the vault's to change; the type itself
 * stays, or the feature would be left pointing at nothing (U-20).
 */
const BUILT_IN_TYPES: ReadonlyMap<string, string> = new Map([
  [PERSON_TYPE, '@ mentions find people by it'],
  ['task', 'capture and the board make tasks of it'],
  ['project', 'artifacts and tasks are filed under projects'],
  [ARTIFACT_TYPE, 'saved artifacts are notes of it'],
  [MEETING_TYPE, 'imported meetings are notes of it'],
  [COMPANY_TYPE, 'meetings and terms point at companies'],
  [TERM_TYPE, 'the Terms page lists its notes, and Atlas spells names by them'],
  [AREA_TYPE, 'the Inbox files notes under areas as well as projects'],
  [RESOURCE_TYPE, 'reference is kept as resources, filed under a project or an area'],
  [PROPOSAL_TYPE, 'what Claude proposes waits in the Inbox as notes of it'],
  [DECISION_TYPE, 'accepted decision proposals are notes of it'],
]);

/** Whether a type is one Atlas's own features depend on. */
export function isBuiltInType(name: string): boolean {
  return BUILT_IN_TYPES.has(name.trim().toLowerCase());
}

/**
 * Why a type cannot be deleted, in the words the type editor shows — or null
 * when it can. Its properties can be changed either way.
 */
export function typeDeleteRefusal(type: {
  readonly name: string;
  readonly label: string;
}): string | null {
  const because = BUILT_IN_TYPES.get(type.name.trim().toLowerCase());
  if (because === undefined) return null;
  return `${type.label} is built in — ${because} — so it cannot be deleted. Its properties are yours to change.`;
}

/**
 * Whether `path` is the file of a built-in type, `.atlas/types/person.md` —
 * by its file name, or by the `name:` it declares, when that has been read.
 *
 * The file's name is the type's name for every type Atlas writes
 * (`createObjectType`) and ships, and the path is all a menu knows; a type
 * written by hand or synced from elsewhere is known by its `name:`, which a
 * delete or rename reads first (A21-02). Case is folded, as the disks Atlas
 * runs on fold it.
 */
export function isBuiltInTypeFile(path: VaultPath, declaredName: string | null = null): boolean {
  const folder = path.slice(0, Math.max(0, path.lastIndexOf('/')));
  if (folder.toLowerCase() !== TYPES_DIRECTORY) return false;
  const name = vaultPathName(path).replace(/\.md$/i, '');
  return isBuiltInType(name) || (declaredName !== null && isBuiltInType(declaredName));
}

/** A top-level `name:` in YAML, its value bare or quoted. */
const NAME_LINE = /^name:[ \t]*(["']?)(.*?)\1[ \t]*$/m;

/**
 * The type a type file's frontmatter declares: its top-level `name:`, or null.
 *
 * Read with a pattern rather than a YAML parser, which the domain does not
 * have, because all it decides is whether to refuse a delete: a `name:`
 * written some rarer way is missed and the file is judged by its name alone,
 * as it was before.
 */
export function declaredTypeName(frontmatter: string): string | null {
  const value = NAME_LINE.exec(frontmatter)?.[2]?.trim() ?? '';
  return value === '' ? null : value;
}
