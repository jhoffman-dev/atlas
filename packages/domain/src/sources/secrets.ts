/**
 * Secrets, as a source refers to them.
 *
 * A source note is ordinary text that ends up in Git, so a token never appears
 * in one. The note names the secret instead — `{{secret:github}}` — and the
 * value lives in the operating system's keychain, where only the host reads it.
 * These rules decide what a reference looks like; the host is handed the
 * pieces already split and only has to look each name up.
 */

/** Letters, digits, `.`, `_` and `-`, starting with a letter or digit, at most 64. */
const SECRET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** `{{secret:name}}`, with space allowed inside the braces as people type it. */
const REFERENCE = /\{\{\s*secret\s*:([^{}]*)\}\}/g;

/** Where a reference starts, so one written wrongly is refused rather than sent as text. */
const OPENING = /\{\{\s*secret\s*:/;

/** One piece of a value that may name secrets: plain text, or the name of one. */
export type TemplatePart = { readonly text: string } | { readonly secret: string };

/** A reference that cannot be used: an empty name, an unusable one, or one left unclosed. */
export class SecretReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretReferenceError';
  }
}

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}

/**
 * Splits a value into text and the secrets it names.
 *
 * A malformed reference throws rather than passing through as text: sent as
 * written, `Bearer {{secret: git hub}}` would go to the server as a broken
 * header, and the name the author meant would never be looked up.
 */
export function parseSecretTemplate(value: string): readonly TemplatePart[] {
  const parts: TemplatePart[] = [];
  let from = 0;

  for (const match of value.matchAll(REFERENCE)) {
    const name = (match[1] ?? '').trim();
    if (!isSecretName(name)) {
      throw new SecretReferenceError(`"${name}" is not a usable secret name`);
    }
    pushText(parts, value.slice(from, match.index));
    parts.push({ secret: name });
    from = match.index + match[0].length;
  }

  const rest = value.slice(from);
  if (OPENING.test(rest)) {
    throw new SecretReferenceError('a {{secret:…}} reference is not closed');
  }
  pushText(parts, rest);
  return parts;
}

function pushText(parts: TemplatePart[], text: string): void {
  if (text !== '') parts.push({ text });
}

/** The names a template refers to, each once, in the order they first appear. */
export function secretNamesIn(parts: readonly TemplatePart[]): readonly string[] {
  const names = parts.flatMap((part) => ('secret' in part ? [part.secret] : []));
  return [...new Set(names)];
}

/**
 * The sites a secret may be sent to, as typed in Settings, written as the
 * origins the host compares a request against: https, the host in lower case,
 * a port only when it is not 443. A bare host is taken as https, since a
 * secret is only ever sent over https.
 *
 * Several may be given, separated by commas or spaces. Null when none is
 * given or any one is not a bare https site — one with a path, query,
 * fragment or login would not be the site the person meant, and binding to
 * fewer sites than were typed would be a surprise.
 *
 * This is the rule; the host (ADR-0017) keeps only the exact strings it is
 * handed and refuses a request whose origin is not one of them.
 */
export function parseSecretOrigins(input: string): readonly string[] | null {
  const entries = input.split(/[\s,]+/).filter((entry) => entry !== '');
  const origins = entries.map(secretOrigin);
  if (origins.length === 0 || origins.some((origin) => origin === null)) return null;
  return [...new Set(origins as string[])];
}

function secretOrigin(entry: string): string | null {
  const written = entry.includes('://') ? entry : `https://${entry}`;
  if (!URL.canParse(written)) return null;
  const url = new URL(written);
  const bare =
    url.protocol === 'https:' &&
    url.hostname !== '' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    !written.endsWith('?') &&
    !written.endsWith('#');
  return bare ? url.origin : null;
}

/** A template as it was written, secrets as references — never as values. */
export function templateText(parts: readonly TemplatePart[]): string {
  return parts.map((part) => ('secret' in part ? `{{secret:${part.secret}}}` : part.text)).join('');
}
