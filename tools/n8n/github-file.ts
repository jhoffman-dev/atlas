import { MeetingMappingError } from '../../packages/domain/src/meetings/mapping/meeting-mapping-error.ts';

/*
 * What the workflow's GitHub branch needs beyond the mapping: whether a file
 * already at a meeting's path is that meeting. Compiled into the "Same
 * meeting?" Code nodes with the mapper (code-node.ts).
 */

/** A frontmatter value as text, its YAML quotes taken off. */
function frontmatterValue(frontmatterText: string, key: string): string | null {
  const line = new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, 'm').exec(frontmatterText);
  const value = line?.[1];
  if (value === undefined) return null;
  if (/^'.*'$/.test(value)) return value.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/.test(value)) return value.slice(1, -1).replace(/\\"/g, '"');
  return value;
}

/**
 * Whether a file already in the repository is this meeting: the same
 * `provider` and `external_id` (ADR-0027's duplicate rule). Read line by line
 * so it needs no YAML library inside n8n.
 */
export function sameMeeting(
  existing: string,
  meeting: { readonly provider: string; readonly externalId: string },
): boolean {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(existing);
  if (match === null) return false;
  const header = match[1] ?? '';
  return (
    frontmatterValue(header, 'provider') === meeting.provider &&
    frontmatterValue(header, 'external_id') === meeting.externalId
  );
}

/**
 * The text of a file the GitHub API returned, which comes base64-encoded with
 * line breaks. Buffer first: n8n documents it in the Code node; atob and
 * TextDecoder are the fallback where it is missing.
 */
export function decodeBase64(encoded: string): string {
  const compact = encoded.replace(/\s/g, '');
  if (typeof Buffer === 'function') return Buffer.from(compact, 'base64').toString('utf8');
  const binary = atob(compact);
  return new TextDecoder().decode(Uint8Array.from(binary, (each) => each.charCodeAt(0)));
}

/** A file as n8n's GitHub node returns it from File → Get. */
export interface GitHubFile {
  readonly content?: unknown;
  /** `base64`, or `none` when GitHub sent no content. */
  readonly encoding?: unknown;
  readonly size?: unknown;
}

/**
 * The text of the file at a meeting's path. GitHub sends no content for a
 * file over 1 MB; such a file may be this meeting or not, so it is refused
 * rather than guessed at — a guess of "another meeting" would write a
 * duplicate at the collision path.
 */
export function existingFileText(file: GitHubFile): string {
  const { content, size } = file;
  if (typeof content === 'string' && (content !== '' || size === 0)) return decodeBase64(content);
  throw new MeetingMappingError(
    `cannot read the file already at this path (GitHub sends no content for a file over 1 MB, size ${String(size)}); not writing, so as not to write the meeting twice`,
  );
}

/**
 * True when the file at the collision path is this meeting (the workflow then
 * skips). Throws when it is another meeting: both of this meeting's paths are
 * taken, and writing anywhere else would break the path rule.
 */
export function sameMeetingAtOtherPath(
  file: GitHubFile,
  meeting: { readonly provider: string; readonly externalId: string },
): true {
  if (sameMeeting(existingFileText(file), meeting)) return true;
  throw new MeetingMappingError(
    `another meeting holds both paths of ${meeting.provider} ${meeting.externalId}; not writing it`,
  );
}
