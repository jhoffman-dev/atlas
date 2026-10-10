import {
  validateMeetingImport,
  type FrontmatterReading,
  type MeetingImportResult,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';

/** A frontmatter block's values, or none and why, as the meeting validator is handed them. */
export function readFrontmatter(
  markdown: MarkdownPort,
  frontmatter: string | null,
): FrontmatterReading {
  const problem = markdown.frontmatterProblem(frontmatter);
  return {
    properties: problem === null ? markdown.frontmatterProperties(frontmatter) : {},
    problem,
  };
}

/** Whether a meeting file follows the import contract, read with the app's YAML reader. */
export function validateMeetingFile(markdown: MarkdownPort, text: string): MeetingImportResult {
  return validateMeetingImport({
    text,
    readFrontmatter: (frontmatter) => readFrontmatter(markdown, frontmatter),
    // Who `You` is changes how a turn is read, never whether the file follows the contract.
    selfName: null,
  });
}
