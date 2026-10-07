/**
 * What a fetch sends: the URL and headers a source declares, split so that
 * every secret they name is a name the host looks up rather than text.
 */

import { isRecord } from '../query/frontmatter-query.ts';
import type { Datasource } from './datasource.ts';
import {
  parseSecretTemplate,
  secretNamesIn,
  SecretReferenceError,
  type TemplatePart,
} from './secrets.ts';

/** A request as the host is handed it. Nothing in it is a secret's value. */
export interface HttpRequest {
  readonly url: readonly TemplatePart[];
  readonly headers: readonly { readonly name: string; readonly value: readonly TemplatePart[] }[];
}

/** RFC 9110's `token`: what a header name may be made of. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const AUTHORIZATION = 'Authorization';
const DEFAULT_SCHEME = 'Bearer';

/**
 * The headers a source declares, `auth:` folded in as an `Authorization`
 * header, or null when they cannot be sent as written.
 *
 * Refused rather than trimmed, as the rest of a source is: a header dropped
 * for a bad name is a request that fails on the server for a reason the note
 * no longer shows.
 */
export function readSourceRequest({
  url,
  headers,
  auth,
}: {
  url: string | null;
  headers: unknown;
  auth: unknown;
}): Readonly<Record<string, string>> | null {
  const declared = readHeaders(headers);
  if (declared === null) return null;

  const authorization = readAuth(auth);
  if (authorization === null) return null;
  if (authorization !== undefined) {
    // Two answers to who is asking is a source that does not say which.
    const named = Object.keys(declared).some((name) => name.toLowerCase() === 'authorization');
    if (named) return null;
    declared[AUTHORIZATION] = authorization;
  }

  // A file is read from the disk; there is no request to send headers with.
  if (url === null && Object.keys(declared).length > 0) return null;

  const templates = [url ?? '', ...Object.values(declared)];
  return templates.every(isTemplate) ? declared : null;
}

function readHeaders(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return null;

  const headers: Record<string, string> = {};
  for (const [name, text] of Object.entries(value)) {
    if (!HEADER_NAME.test(name)) return null;
    if (typeof text !== 'string' && typeof text !== 'number') return null;
    headers[name] = String(text);
  }
  return headers;
}

/** The `Authorization` value `auth:` asks for, undefined for none, null when unusable. */
function readAuth(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return null;

  const secret = typeof value['secret'] === 'string' ? value['secret'].trim() : '';
  const scheme =
    typeof value['scheme'] === 'string' ? value['scheme'].trim() || DEFAULT_SCHEME : DEFAULT_SCHEME;
  if (!HEADER_NAME.test(scheme)) return null;
  return `${scheme} {{secret:${secret}}}`;
}

function isTemplate(text: string): boolean {
  try {
    parseSecretTemplate(text);
    return true;
  } catch (cause) {
    if (cause instanceof SecretReferenceError) return false;
    throw cause;
  }
}

/** The request a fetching source sends, or null for one that reads a file. */
export function sourceRequest(source: Datasource): HttpRequest | null {
  if (source.url === null) return null;
  return {
    url: parseSecretTemplate(source.url.trim()),
    headers: Object.entries(source.headers).map(([name, value]) => ({
      name,
      value: parseSecretTemplate(value),
    })),
  };
}

/** Every secret a source names, each once — what Settings lists as "used by". */
export function secretsUsedBy(source: Datasource): readonly string[] {
  const request = sourceRequest(source);
  if (request === null) return [];
  return secretNamesIn([request.url, ...request.headers.map((header) => header.value)].flat());
}
