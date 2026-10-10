import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NODES } from './workflow.ts';

/*
 * PR #86 (issue #80): the failure notification. The README wires the Atlas
 * branch beside the Notion branch and above it, so n8n's v1 order runs Atlas
 * — and its notification — before Notion writes anything.
 */

interface WorkflowNode {
  readonly name: string;
  readonly parameters: Record<string, unknown>;
}

const committed = JSON.parse(
  readFileSync(new URL('meeting-to-atlas.workflow.json', import.meta.url), 'utf8'),
) as { nodes: readonly WorkflowNode[] };

describe('the failure email', () => {
  it('does not tell you Notion has the meeting, which it has not written yet', () => {
    const notify = committed.nodes.find((each) => each.name === NODES.notify);
    const message = String(notify?.parameters.message ?? '');
    expect(message).toContain('$json.error');
    expect(message).not.toMatch(/is in Notion/i);
  });
});
