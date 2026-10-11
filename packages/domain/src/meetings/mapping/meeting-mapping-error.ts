/**
 * A meeting the mapping cannot turn into a contract file (a required field is
 * missing or unreadable), or one the workflow cannot safely write. In n8n the
 * Code node sends the item out of its error output to "Atlas commit failed",
 * which emails this message, and the run goes on; `POST /v1/meetings` answers
 * it as `invalid`, with this message.
 */
export class MeetingMappingError extends Error {
  override readonly name = 'MeetingMappingError';
}

/** The value as trimmed text with its whitespace collapsed; '' when there is none. */
export function oneLine(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(oneLine).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    throw new MeetingMappingError(`expected text, got ${JSON.stringify(value)}`);
  }
  return (
    String(value)
      // Control characters have no place in a one-line value, and YAML refuses some.
      .replace(/\p{Cc}/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
