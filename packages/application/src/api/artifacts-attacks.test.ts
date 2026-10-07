import { describe, expect, it } from 'vitest';
import { apiFixture, codeOf, encoded } from '../testing/api-fixture.ts';

/*
 * Adversarial: what a chunked write can be made to do to files that are not
 * its own copy. Each test names the invariant it holds the route to.
 */

const NOTE = '---\ntype: artifact\nkind: page\n---\n';
const withSaved = (saved: string) => `---\ntype: artifact\nkind: page\nsaved: ${saved}\n---\n`;
const decode = (bytes: Uint8Array | undefined) =>
  bytes === undefined ? undefined : new TextDecoder().decode(bytes);

const put = (api: ReturnType<typeof apiFixture>, note: string, name: string, body: unknown) =>
  api.send({
    method: 'PUT',
    path: `/v1/artifacts/${encoded(note)}/files/${encoded(name)}`,
    body,
  });

describe('PUT /v1/artifacts/{path}/files/{name} — adversarial', () => {
  it("never writes into another artifact's copy when two titles share a slug", async () => {
    // "Sales deck" saved its copy in artifacts/sales-deck. "Sales Deck!" has no
    // copy yet; its folder by name is the same one.
    const api = apiFixture({
      files: {
        'artifacts/Sales deck.md': withSaved('artifacts/sales-deck'),
        'artifacts/Sales Deck!.md': NOTE,
      },
    });
    api.binaries.set(
      'artifacts/sales-deck/index.html',
      new TextEncoder().encode('<script src="app.js"></script>'),
    );

    await put(api, 'artifacts/Sales Deck!.md', 'app.js', { text: 'stealTheDeck()' });

    // app.js is exactly what the other artifact's page loads and would now run.
    expect(decode(api.binaries.get('artifacts/sales-deck/app.js'))).toBeUndefined();
    expect(api.files.get('artifacts/Sales Deck!.md')?.text).not.toContain(
      'saved: artifacts/sales-deck',
    );
  });

  it('adopts no folder that was already there and is not the note’s copy', async () => {
    // A leftover or user folder named like the note: the copy should not move into it.
    const api = apiFixture({ files: { 'artifacts/Research.md': NOTE } });
    api.folders.add('artifacts/research');
    api.binaries.set('artifacts/research/chart.png', new Uint8Array([1, 2, 3]));

    // As addArtifactCopy does for a dropped page: refuse, and say what is in the way.
    await put(api, 'artifacts/Research.md', 'index.html', { text: '<p>x</p>' });

    expect(api.binaries.has('artifacts/research/index.html')).toBe(false);
  });

  it(`holds a copy to the ${200}-file limit a dropped copy is held to`, async () => {
    const api = apiFixture({ files: { 'artifacts/Big.md': NOTE } });
    for (let at = 0; at < 200; at += 1) {
      expect((await put(api, 'artifacts/Big.md', `f${at}.js`, { text: '1' })).status).toBe(201);
    }

    const response = await put(api, 'artifacts/Big.md', 'one-too-many.js', { text: '1' });

    expect(codeOf(response)).toBe('invalid');
    expect(api.binaries.has('artifacts/big/one-too-many.js')).toBe(false);
  });

  it("refuses a saved folder that is a folder of notes, not an artifact's copy", async () => {
    const api = apiFixture({
      files: { 'artifacts/Big.md': withSaved('Tasks'), 'Tasks/Call.md': '---\ntype: task\n---\n' },
    });

    const response = await put(api, 'artifacts/Big.md', 'index.html', { text: '<p>x</p>' });

    expect(codeOf(response)).toBe('invalid');
    expect(api.binaries.has('Tasks/index.html')).toBe(false);
  });
});
