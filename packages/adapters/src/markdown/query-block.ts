import {
  QUERY_BLOCK_LANGUAGE,
  queryBlockOfCode,
  queryBlockText,
  type EditorNode,
} from '@atlas/domain';
import type { Code, RootContent } from 'mdast';

/**
 * A top-level block as the query block it stands as (P30-05), or null: a
 * fenced code block whose language is `atlas-query` and nothing more.
 */
export function queryBlockFromMdast(node: RootContent): EditorNode | null {
  if (node.type !== 'code') return null;
  return queryBlockOfCode({
    language: node.lang ?? null,
    meta: node.meta ?? null,
    text: node.value,
  });
}

/** A query block as markdown writes it: its text, fenced, with its language. */
export function queryBlockToMdast(node: EditorNode): Code {
  return { type: 'code', lang: QUERY_BLOCK_LANGUAGE, value: queryBlockText(node) };
}
