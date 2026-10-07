import { describe, expect, it } from 'vitest';
import type { EditorDocument, EditorNode } from '@atlas/domain';
import { parseMarkdownBody, RAW_BLOCK, serializeMarkdownBody } from './markdown-blocks.ts';
import { documentOf, generatedDocument } from './writer-fuzz.test-support.ts';

/**
 * The writer's promise (A21-03): an edited block reads back as the editor had
 * it. Seeded editor documents — every block kind the editor writes, text full
 * of markdown's punctuation, every mark — go through the writer and the
 * reader, and must come back as the same document, adjacent text merged.
 *
 * The one other outcome allowed is a block read back as its own source, shown
 * read-only (ADR-0004): markdown that cannot be written faithfully is kept as
 * written rather than turned silently into something else.
 */

/** A new note holding `doc`, saved and read back. */
function saveAndReload(doc: EditorDocument): { markdown: string; reread: EditorNode[] } {
  const markdown = serializeMarkdownBody({ originalBody: '', parsed: parseMarkdownBody(''), doc });
  return { markdown, reread: [...parseMarkdownBody(markdown).doc.content] };
}

/** The same note, with every text block in it given one more word, saved over itself. */
function editedEverywhere(doc: EditorDocument): EditorDocument {
  const edit = (node: EditorNode): EditorNode => {
    if (node.type === 'paragraph' || node.type === 'heading')
      return { ...node, content: [{ type: 'text', text: 'Q ' }, ...(node.content ?? [])] };
    return node.content === undefined ? node : { ...node, content: node.content.map(edit) };
  };
  return { type: 'doc', content: doc.content.map(edit) };
}

type Outcome = 'same' | 'raw' | 'different';

function outcomeOf(doc: EditorDocument, reread: EditorNode[]): Outcome {
  if (documentOf(reread) === documentOf(doc.content)) return 'same';
  // Block by block: each reads back as it was, or as its own source.
  const blocks = doc.content.filter((node) => node.type !== 'paragraph' || node.content?.length);
  if (blocks.length !== reread.length) return 'different';
  const each = blocks.map((node, at) =>
    documentOf([reread[at]!]) === documentOf([node])
      ? 'same'
      : reread[at]!.type === RAW_BLOCK
        ? 'raw'
        : 'different',
  );
  return each.includes('different') ? 'different' : 'raw';
}

/** Seeds whose documents do not read back as written, with their markdown, for the report. */
function misread(seeds: number, check: (doc: EditorDocument) => [Outcome, string]) {
  const different: string[] = [];
  let raw = 0;
  for (let seed = 1; seed <= seeds; seed += 1) {
    let outcome: Outcome;
    let markdown: string;
    try {
      [outcome, markdown] = check(generatedDocument(seed));
    } catch (error) {
      [outcome, markdown] = ['different', `threw ${String(error)}`];
    }
    if (outcome === 'raw') raw += 1;
    if (outcome === 'different') different.push(`seed ${seed}: ${JSON.stringify(markdown)}`);
  }
  return { different, raw };
}

const SEEDS = 3000;
/**
 * About 17 s alone; past 120 s under the gate's coverage run beside the
 * rest of the suite on a loaded Mac (2026-10-04, twice). The work is fixed
 * and deterministic, so this is a budget for CPU, not a wait on a moment.
 */
const BUDGET_MS = 300_000;

describe('an edited block reads back as the editor had it', () => {
  it(
    `holds for ${SEEDS} seeded documents written afresh`,
    () => {
      const { different, raw } = misread(SEEDS, (doc) => {
        const { markdown, reread } = saveAndReload(doc);
        return [outcomeOf(doc, reread), markdown];
      });
      expect(different.slice(0, 8), `${different.length} of ${SEEDS} read differently`).toEqual([]);
      // Kept as source is the last resort, not the answer: a handful at most.
      expect(raw, `${raw} of ${SEEDS} kept as source`).toBeLessThanOrEqual(SEEDS / 100);
    },
    BUDGET_MS,
  );

  it(
    `holds for ${SEEDS} seeded documents saved, reopened and edited again`,
    () => {
      const { different, raw } = misread(SEEDS, (first) => {
        const { markdown: original } = saveAndReload(first);
        const parsed = parseMarkdownBody(original);
        if (parsed.doc.content.some((node) => node.type === RAW_BLOCK)) return ['same', original];
        const doc = editedEverywhere(parsed.doc);
        const markdown = serializeMarkdownBody({ originalBody: original, parsed, doc });
        const reread = [...parseMarkdownBody(markdown).doc.content];
        return [outcomeOf(doc, reread), `${original}\n=>\n${markdown}`];
      });
      expect(different.slice(0, 8), `${different.length} of ${SEEDS} read differently`).toEqual([]);
      expect(raw, `${raw} of ${SEEDS} kept as source`).toBeLessThanOrEqual(SEEDS / 100);
    },
    BUDGET_MS,
  );
});
