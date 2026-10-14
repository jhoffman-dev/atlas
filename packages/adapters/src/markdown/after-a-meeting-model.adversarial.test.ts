import { describe, expect, it } from 'vitest';
import { createVaultPath, parseAutomationRule, splitFrontmatter } from '@atlas/domain';
import { remarkMarkdown } from './markdown-port.ts';

/**
 * #179 adversarial: `model:` is meant to be "one plain id" (readModel's own
 * contract). A rule file whose model carries a control or invisible format
 * character reads as a valid rule, saves clean in the editor, and fails only
 * when a meeting arrives and the host is handed the id.
 */
const PATH = createVaultPath('.atlas/automations/After a meeting.md');
const fileWithModel = (yamlModel: string) =>
  [
    '---',
    'atlas: automation',
    'name: After a meeting',
    'enabled: true',
    'when: a meeting is created',
    'which: FROM meeting WHERE date >= @-14d',
    'do: claude',
    'prompt: .atlas/prompts/after-a-meeting.md',
    'tools: []',
    'output: meeting-items',
    'apply: mine',
    `model: ${yamlModel}`,
    '---',
    '',
    '# After a meeting',
    '',
  ].join('\n');
const readBack = (text: string) =>
  parseAutomationRule(PATH, remarkMarkdown.frontmatterProperties(splitFrontmatter(text).frontmatter));

describe('model: refuses what is not one plain id (adversarial, #179)', () => {
  it.each([
    ['a NUL byte', '"claude-sonnet-5-5\\0"'],
    ['a control character (BEL)', '"claude-sonnet-5-5\\a"'],
    ['a zero-width space', 'claude-sonnet-5-5​'],
    ['a soft hyphen', 'claude­sonnet-5-5'],
    ['a word joiner', 'claude-sonnet⁠-5-5'],
  ])('refuses a model with %s', (_what, yamlModel) => {
    const read = readBack(fileWithModel(yamlModel));
    expect(read).toHaveProperty('broken');
  });
});
