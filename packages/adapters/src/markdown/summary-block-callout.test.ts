import { describe, expect, it } from 'vitest';
import { placeSummary, renderSummaryBlock, type EditorDocument } from '@atlas/domain';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';

/**
 * The summary Claude writes at the top of a meeting (#183, #186), as the
 * meeting view reads it: a callout titled "Summary by Claude (…)", its
 * markers kept but not read, and every byte saved back as it was when the
 * person types elsewhere in the note.
 */
const BLOCK = renderSummaryBlock({
  model: 'claude-sonnet-5-5',
  date: '2026-10-14',
  summary: 'Larkspur Payroll and the platform team agreed to ship the cache behind a flag.',
  keyPoints: ['The cache is ready'],
  decisions: ['Ship the cache behind a flag'],
  actionItems: [
    { title: 'Flag the cache', assignee: 'Tobias Fenn', turn: 't0002', taskMade: false },
    { title: 'Send the rollout note', assignee: 'you', turn: 't0003', taskMade: true },
  ],
  openQuestions: [],
}).text;

const MEETING =
  '\n## Summary\n\nThey agreed to ship.\n\n## Notes\n\nMine.\n\n## Transcript\n\n**Mara Quill** [00:00:01] Morning. ^t0001\n';

const placed = placeSummary(MEETING, BLOCK, { recorded: null });
if (!placed.ok) throw new Error('not placed');
const BODY = placed.body;

describe('the summary block in the meeting view', () => {
  it('reads as a summary callout titled by Claude, its opening marker a comment', () => {
    const [marker, callout] = parseMarkdownBody(BODY).doc.content;
    expect(marker).toMatchObject({
      type: 'rawBlock',
      attrs: { markdown: '<!-- atlas:summary v1 -->' },
    });
    expect(callout).toMatchObject({
      type: 'callout',
      attrs: {
        kind: 'summary',
        title: 'Summary by Claude (claude-sonnet-5-5, 2026-10-14)',
      },
    });
  });

  it('is saved back byte for byte when the person types in their own notes', () => {
    const parsed = parseMarkdownBody(BODY);
    const content = parsed.doc.content.map((node) =>
      node.type === 'paragraph' && node.content?.[0]?.text === 'Mine.'
        ? { ...node, content: [{ type: 'text', text: 'Mine, edited.' }] }
        : node,
    );
    const doc: EditorDocument = { type: 'doc', content };
    const saved = serializeMarkdownBody({ originalBody: BODY, parsed, doc });
    expect(saved).toBe(BODY.replace('Mine.', 'Mine, edited.'));
    expect(saved.startsWith(`\n${BLOCK}\n\n`)).toBe(true);
  });
});
