/**
 * A meeting the mapping cannot turn into a contract file (a required field is
 * missing or unreadable), or one the workflow cannot safely write. In n8n the
 * Code node sends the item out of its error output to "DFAI commit failed",
 * which emails this message, and the run goes on; `POST /v1/meetings` answers
 * it as `invalid`, with this message.
 */
export class MeetingMappingError extends Error {
  override readonly name = 'MeetingMappingError';
}

/** How much of a value a refusal shows: enough to find it, never a meeting's content. */
const SHOWN_LENGTH = 40;

/**
 * A value as a refusal may show it: text quoted and cut to
 * {@link SHOWN_LENGTH} characters, anything else by its type alone. A refusal
 * is emailed by n8n and logged by the pull, so it never carries what the
 * value holds.
 */
export function shown(value: unknown): string {
  if (typeof value !== 'string') return Array.isArray(value) ? 'a list' : String(typeof value);
  const characters = [...value];
  const cut = characters.length > SHOWN_LENGTH;
  return JSON.stringify(cut ? `${characters.slice(0, SHOWN_LENGTH).join('')}…` : value);
}

/**
 * The value as trimmed text with its whitespace collapsed; '' when there is
 * none. Refuses an object, naming `field` (and never what the object holds).
 */
export function oneLine(value: unknown, field?: string): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value
      .map((each) => oneLine(each, field))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'object') {
    const named = field === undefined ? '' : `${field}: `;
    throw new MeetingMappingError(`${named}expected text, got object`);
  }
  return (
    String(value)
      // Control characters have no place in a one-line value, and YAML refuses some.
      .replace(/\p{Cc}/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
