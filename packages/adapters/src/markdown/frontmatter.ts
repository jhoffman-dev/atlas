import { parse, parseDocument } from 'yaml';

/** The YAML between the delimiters. */
const yamlOf = (frontmatter: string) =>
  frontmatter.replace(/^---[ \t]*\r?\n/, '').replace(/\r?\n?---[ \t]*\r?\n?$/, '');

/**
 * Why a frontmatter block cannot be read as YAML, in one line; null when it
 * can (or there is none).
 */
export function frontmatterProblem(frontmatter: string | null): string | null {
  if (frontmatter === null) return null;
  const document = parseDocument(yamlOf(frontmatter));
  const [error] = document.errors;
  // YAML's message goes on to draw the line with a caret under the column.
  if (error !== undefined) return error.message.split('\n')[0] ?? error.message;
  try {
    // Parsing succeeds where turning the result into values does not: an
    // alias bomb parses, and only expanding it throws. `parse` does both.
    document.toJS();
    return null;
  } catch (thrown) {
    return thrown instanceof Error ? thrown.message : String(thrown);
  }
}

/**
 * Reads a frontmatter block into plain values for the index.
 *
 * The editor still treats frontmatter as opaque text and writes it back byte for
 * byte; this is a read-only view of it. Malformed YAML yields no properties rather
 * than failing, because one bad note must not stop the vault being indexed.
 */
export function parseFrontmatterProperties(frontmatter: string | null): Record<string, unknown> {
  if (frontmatter === null) return {};

  const body = yamlOf(frontmatter);
  if (body.trim() === '') return {};

  try {
    const parsed: unknown = parse(body);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
