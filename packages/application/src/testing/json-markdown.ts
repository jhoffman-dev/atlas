import type { MarkdownPort } from '../notes/ports.ts';
import { fakeMarkdown } from './fake-ports.ts';

/**
 * Frontmatter written as JSON between the fences, for configuration notes
 * whose values nest — a view's filters, a type's properties. Any other
 * frontmatter reads as `fakeMarkdown`'s `key: value` lines. Test support only.
 */
export function jsonMarkdown(): MarkdownPort {
  const base = fakeMarkdown();
  return {
    ...base,
    frontmatterProperties: (frontmatter) => {
      const inner = (frontmatter ?? '')
        .replace(/^---\n/, '')
        .replace(/---\n?$/, '')
        .trim();
      return inner.startsWith('{') ? JSON.parse(inner) : base.frontmatterProperties(frontmatter);
    },
  };
}

/** A note whose frontmatter is `value` as JSON, for `jsonMarkdown` to read. */
export const jsonNote = (value: unknown): string => `---\n${JSON.stringify(value)}\n---\n\nbody\n`;
