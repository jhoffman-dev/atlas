import { parse, parseDocument } from 'yaml';
import { FrontmatterRefusedError, type WritingRead } from '@atlas/application';
import { duplicatedProperties, problemLine } from './frontmatter-write.ts';

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
  if (error !== undefined) return problemLine(error);
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
export function parseFrontmatterProperties(
  frontmatter: string | null,
  read?: WritingRead,
): Record<string, unknown> {
  if (frontmatter === null) return {};

  const body = yamlOf(frontmatter);
  if (body.trim() === '') return {};
  const refusing = read?.refusingDuplicated ?? [];
  if (refusing.length > 0) {
    // Outside the catch below: a refusal is the caller's answer, not an unreadable block.
    const refused = duplicatedProperties(body).find(({ key }) => refusing.includes(key));
    if (refused !== undefined) throw new FrontmatterRefusedError(refused);
  }

  try {
    // Read for writing, a key listed twice is its last copy, as the writer reads it.
    const parsed: unknown = parse(body, { uniqueKeys: read?.forWriting !== true });
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
