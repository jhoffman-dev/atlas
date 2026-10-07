/**
 * A meeting the mapping cannot turn into a contract file (a required field is
 * missing or unreadable), or one the workflow cannot safely write. The Code
 * node sends the item out of its error output to "Atlas commit failed", with
 * this message; the run goes on. The Atlas branch starts only after the
 * Notion node has written the meeting, so Notion has it either way.
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
