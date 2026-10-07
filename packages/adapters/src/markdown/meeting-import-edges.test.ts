import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BLOCK_ANCHOR_ATTR,
  splitFrontmatter,
  validateMeetingImport,
  type EditorDocument,
  type EditorNode,
  type MeetingImportResult,
} from '@atlas/domain';
import { frontmatterProblem, parseFrontmatterProperties } from './frontmatter.ts';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';

/*
 * Edges of meeting/v1 read with the app's own YAML reader and saved with its
 * own serializer (adversarial pass on P28-01).
 */

const root = new URL('../../../../', import.meta.url);
const gemini = readFileSync(
  new URL('packages/domain/src/meetings/fixtures/valid/gemini-platform-sync.md', root),
  'utf8',
);

function validate(text: string): MeetingImportResult {
  return validateMeetingImport({
    text,
    selfName: 'James Hoffman',
    readFrontmatter: (frontmatter) => ({
      properties: parseFrontmatterProperties(frontmatter),
      problem: frontmatterProblem(frontmatter),
    }),
  });
}

describe('frontmatter YAML cannot read is reported as such', () => {
  it('names an alias bomb as unreadable YAML, not as seven missing keys', () => {
    const bomb = [
      'a: &a [x, x, x, x, x, x, x, x, x]',
      'b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]',
      'c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]',
      'd: [*c, *c, *c, *c, *c, *c, *c, *c, *c]',
      'attendees:',
    ].join('\n');
    const result = validate(gemini.replace('attendees:', bomb));
    // Today: problem is null (parseDocument does not expand aliases) but parse()
    // throws, so the properties come back {} and every required key is "missing".
    expect(result.ok ? [] : result.errors.map((error) => error.field)).toEqual(['frontmatter']);
  });
});

describe('a meeting edited in Atlas still follows the contract', () => {
  it('validates after a section heading is given a block id, as citing it writes one', () => {
    const { frontmatter, body } = splitFrontmatter(gemini);
    const parsed = parseMarkdownBody(body);
    const cite = (node: EditorNode): EditorNode =>
      node.type === 'heading' && node.content?.[0]?.text === 'Transcript'
        ? { ...node, attrs: { ...node.attrs, [BLOCK_ANCHOR_ATTR]: 'h2k8d1' } }
        : node;
    const doc: EditorDocument = { type: 'doc', content: parsed.doc.content.map(cite) };
    const saved = serializeMarkdownBody({ originalBody: body, parsed, doc });
    expect(saved).toContain('## Transcript ^h2k8d1');
    // Today: refused — "## Transcript ^h2k8d1 is not a meeting/v1 section".
    const result = validate((frontmatter ?? '') + saved);
    expect(result.ok ? [] : result.errors.map((error) => error.message)).toEqual([]);
  });
});
