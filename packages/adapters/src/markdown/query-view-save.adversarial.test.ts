import { describe, expect, it } from 'vitest';
import { updateFrontmatter } from './frontmatter-write.ts';
import { parseFrontmatterProperties } from './frontmatter.ts';

/**
 * Adversarial (ADR-0019): saving a query view writes `query:` (and the layout)
 * through the byte-preserving frontmatter write. The text must read back
 * exactly as typed, and the rest of the file must keep its bytes.
 */

const VIEW = [
  '---',
  '# the Q3 board, hand-kept',
  'atlas: view',
  'layout: "table"   # drawn as a table',
  'query: FROM task',
  'owner: Julie',
  '---',
  '',
].join('\n');

const HOSTILE_QUERIES = [
  'FROM task WHERE tag = #q3',
  "FROM task WHERE notes = 'a: b'",
  "'FROM' task",
  'FROM task WHERE project = [[Atlas|the app]]',
  'FROM task\nWHERE status != done\nSORT BY due',
  'FROM task WHERE status = done   ',
  '  FROM task',
  'FROM task WHERE notes = "- x"',
  'FROM task WHERE title = @today',
  "FROM task WHERE notes = 'tab\there'",
  'FROM task # trailing',
  '- FROM task',
  'FROM task WHERE notes = "x\\ny"',
];

describe('saving a query view (adversarial)', () => {
  it.each(HOSTILE_QUERIES)('reads back %j exactly as it was saved', (query) => {
    const after = updateFrontmatter(VIEW, { query, layout: 'table' });
    expect(parseFrontmatterProperties(after)['query']).toBe(query);
  });

  it('keeps every other line of the file byte for byte', () => {
    const after = updateFrontmatter(VIEW, { query: 'FROM task WHERE tag = #q3', layout: 'table' });
    const others = (text: string) => text.split('\n').filter((line) => !line.startsWith('query:'));
    expect(others(after)).toEqual(others(VIEW));
  });

  it('keeps CRLF line endings when the query changes', () => {
    const crlf = VIEW.replaceAll('\n', '\r\n');
    const after = updateFrontmatter(crlf, { query: 'FROM task, project', layout: 'table' });
    expect(after.replaceAll('\r\n', '')).not.toContain('\n');
    expect(after).toContain('owner: Julie\r\n');
    expect(parseFrontmatterProperties(after)['query']).toBe('FROM task, project');
  });

  it('keeps CRLF line endings when the saved query spans lines', () => {
    const crlf = VIEW.replaceAll('\n', '\r\n');
    const query = 'FROM task\nWHERE status = done';
    const after = updateFrontmatter(crlf, { query, layout: 'table' });
    expect(after.replaceAll('\r\n', '')).not.toContain('\n');
    expect(String(parseFrontmatterProperties(after)['query']).replaceAll('\r\n', '\n')).toBe(query);
  });
});
