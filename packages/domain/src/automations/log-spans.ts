/** How a log writes a value into a line, and the pattern that reads one back. */

/** JSON in a code span; a backtick escaped so the span cannot end early. */
export const code = (value: unknown): string =>
  `\`${JSON.stringify(value).replace(/`/g, '\\u0060')}\``;

/** A code span, capturing what is inside it. */
export const JSON_SPAN = '`((?:[^`])*)`';
