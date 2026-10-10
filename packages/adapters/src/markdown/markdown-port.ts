import type { MarkdownPort } from '@atlas/application';
import { parseMarkdownBody, serializeMarkdownBody, parseBodyToMdast } from './markdown-blocks.ts';
import { frontmatterProblem, parseFrontmatterProperties } from './frontmatter.ts';
import { frontmatterKeyTexts, updateFrontmatter } from './frontmatter-write.ts';
import { plainTextOf } from './plain-text.ts';
import { readRawParts } from './raw-parts.ts';
import { textRangesOf } from './text-ranges.ts';

/** The remark-backed implementation of the application's markdown port. */
export const remarkMarkdown: MarkdownPort = {
  parseBody: parseMarkdownBody,
  serializeBody: serializeMarkdownBody,
  frontmatterProperties: parseFrontmatterProperties,
  frontmatterProblem,
  frontmatterKeyTexts,
  plainText: (body) => plainTextOf(parseBodyToMdast(body)),
  textRanges: (body) => textRangesOf(parseBodyToMdast(body)),
  updateFrontmatter,
  rawParts: readRawParts,
};
