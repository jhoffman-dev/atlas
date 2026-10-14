import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GranolaError } from '@atlas/application';

/*
 * The Granola adapter against a fake `invoke`: the commands and arguments
 * `granola.rs` takes (P28-10), the JSON Granola's OpenAPI documents read
 * into the app's types, and every way the host or Granola can fail turned
 * into the app's error. All names are made up.
 */

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { tauriGranola, granolaErrorOf } = await import('./tauri-granola.ts');

const VAULT = '/Users/mara/Vault';
const ID = 'not_1d3tmYTlCICgjy';

const answer = (status: number, body: unknown) => ({
  status,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const SUMMARY = {
  id: ID,
  object: 'note',
  title: 'Larkspur Payroll renewal',
  owner: { name: 'Mara Quill', email: 'mara.quill@example.com' },
  created_at: '2026-10-06T16:58:00Z',
  updated_at: '2026-10-06T18:10:00Z',
  deleted_at: null,
};

const NOTE = {
  ...SUMMARY,
  web_url: 'https://notes.granola.ai/d/0b6c1d2e',
  calendar_event: null,
  attendees: [{ name: 'Tobias Fenn', email: 'tobias.fenn@example.com' }],
  folder_membership: [],
  summary_text: 'Go-live moves a week.',
  summary_markdown: null,
  private_notes_text: null,
  private_notes_markdown: null,
  transcript: [
    {
      speaker: { source: 'microphone', attribution: 'me' },
      text: 'Morning.',
      start_time: '2026-10-06T17:00:00Z',
      end_time: '2026-10-06T17:00:02Z',
    },
  ],
};

/** What the adapter rejects with, when it rejects. */
async function failureOf(call: Promise<unknown>) {
  const error: unknown = await call.then(
    () => null,
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(GranolaError);
  return (error as GranolaError).failure;
}

describe('tauriGranola: the key', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('asks status, sets and forgets the key by the host’s command names, naming the vault', async () => {
    invoke
      .mockResolvedValueOnce({ hasKey: false, lastRefusal: null })
      .mockResolvedValueOnce({ hasKey: true, lastRefusal: null })
      .mockResolvedValueOnce({ hasKey: false, lastRefusal: null });

    await expect(tauriGranola.status({ vault: VAULT })).resolves.toEqual({
      hasKey: false,
      lastRefusal: null,
    });
    await expect(tauriGranola.setKey({ vault: VAULT, key: 'grn_fictional' })).resolves.toEqual({
      hasKey: true,
      lastRefusal: null,
    });
    await tauriGranola.forgetKey({ vault: VAULT });

    expect(invoke.mock.calls).toEqual([
      ['granola_status', { vault: VAULT }],
      ['granola_set_key', { vault: VAULT, key: 'grn_fictional' }],
      ['granola_forget_key', { vault: VAULT }],
    ]);
  });

  it('reads a key Granola refused', async () => {
    invoke.mockResolvedValue({ hasKey: true, lastRefusal: 401 });
    await expect(tauriGranola.status({ vault: VAULT })).resolves.toEqual({
      hasKey: true,
      lastRefusal: 401,
    });
  });

  it.each([
    null,
    'yes',
    {},
    { hasKey: 'true', lastRefusal: null },
    { hasKey: true, lastRefusal: 403 },
    { hasKey: true },
  ])('calls a status it cannot read (%j) malformed', async (status) => {
    invoke.mockResolvedValue(status);
    expect(await failureOf(tauriGranola.status({ vault: VAULT }))).toMatchObject({
      kind: 'malformed',
    });
  });
});

describe('tauriGranola: listing notes', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('asks for the largest page, from the watermark and cursor when given, and reads the next cursor', async () => {
    invoke.mockResolvedValue(answer(200, { notes: [SUMMARY], hasMore: true, cursor: 'c2' }));

    const page = await tauriGranola.listNotes({
      vault: VAULT,
      updatedAfter: '2026-10-05T18:00:00.000Z',
      cursor: 'c1',
    });

    expect(page).toEqual({ notes: [SUMMARY], unreadable: [], cursor: 'c2' });
    expect(invoke).toHaveBeenCalledWith('granola_request', {
      vault: VAULT,
      path: '/v1/notes',
      query: { page_size: '30', updated_after: '2026-10-05T18:00:00.000Z', cursor: 'c1' },
    });
  });

  it('lists everything with no watermark, and ends where Granola says there is no more', async () => {
    invoke.mockResolvedValue(answer(200, { notes: [], hasMore: false, cursor: 'ignored' }));

    const page = await tauriGranola.listNotes({ vault: VAULT, updatedAfter: null, cursor: null });

    expect(page).toEqual({ notes: [], unreadable: [], cursor: null });
    expect(invoke).toHaveBeenCalledWith('granola_request', {
      vault: VAULT,
      path: '/v1/notes',
      query: { page_size: '30' },
    });
  });

  it.each([
    ['not an object', []],
    ['no notes', { hasMore: false, cursor: null }],
    ['no hasMore', { notes: [], cursor: null }],
    ['more with no cursor', { notes: [], hasMore: true, cursor: null }],
    ['more with an empty cursor', { notes: [], hasMore: true, cursor: '' }],
  ])('calls a list with %s malformed', async (_case, body) => {
    invoke.mockResolvedValue(answer(200, body));
    expect(
      await failureOf(tauriGranola.listNotes({ vault: VAULT, updatedAfter: null, cursor: null })),
    ).toMatchObject({ kind: 'malformed' });
  });

  it.each([
    ['no id', { ...SUMMARY, id: undefined }, null, 'its id is not a Granola note id'],
    [
      'an id a path could not hold',
      { ...SUMMARY, id: 'not_../x' },
      'not_../x',
      'its id is not a Granola note id',
    ],
    ['an id that is not text', { ...SUMMARY, id: 7 }, null, 'its id is not a Granola note id'],
    ['no updated_at', { ...SUMMARY, updated_at: null }, ID, 'its updated_at is not text'],
    ['a title that is not text', { ...SUMMARY, title: 7 }, ID, 'its title is not text'],
    ['nothing that is a note', 'not_1d3tmYTlCICgjy', null, 'it is not a note'],
  ])(
    'sets a listed note with %s aside, with its id and why, and keeps the rest of the page',
    async (_case, odd, id, reason) => {
      const other = { ...SUMMARY, id: 'not_2e4unZUmDJDhkz' };
      invoke.mockResolvedValue(answer(200, { notes: [SUMMARY, odd, other], hasMore: false }));

      const page = await tauriGranola.listNotes({ vault: VAULT, updatedAfter: null, cursor: null });

      expect(page).toEqual({ notes: [SUMMARY, other], unreadable: [{ id, reason }], cursor: null });
    },
  );

  it('keeps a note with no title', async () => {
    invoke.mockResolvedValue(answer(200, { notes: [{ ...SUMMARY, title: null }], hasMore: false }));
    const page = await tauriGranola.listNotes({ vault: VAULT, updatedAfter: null, cursor: null });
    expect(page.notes[0]?.title).toBeNull();
  });
});

describe('tauriGranola: a note and its transcript', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('asks for the note with its transcript, and hands it on as Granola sent it', async () => {
    invoke.mockResolvedValue(answer(200, NOTE));

    await expect(tauriGranola.getNote({ vault: VAULT, id: ID, transcript: true })).resolves.toEqual(
      NOTE,
    );
    expect(invoke).toHaveBeenCalledWith('granola_request', {
      vault: VAULT,
      path: `/v1/notes/${ID}`,
      query: { include: 'transcript' },
    });
  });

  it('asks for the note alone, whose transcript is then null', async () => {
    invoke.mockResolvedValue(answer(200, { ...NOTE, transcript: undefined, web_url: undefined }));

    const note = await tauriGranola.getNote({ vault: VAULT, id: ID, transcript: false });

    expect(note.transcript).toBeNull();
    expect(note.web_url).toBeNull();
    expect(invoke).toHaveBeenCalledWith('granola_request', {
      vault: VAULT,
      path: `/v1/notes/${ID}`,
      query: {},
    });
  });

  it.each([
    ['another note', { ...NOTE, id: 'not_99999999999999' }],
    ['a transcript that is not a list', { ...NOTE, transcript: 'Morning.' }],
    ['a web address that is not text', { ...NOTE, web_url: 3 }],
    ['no updated_at', { ...NOTE, updated_at: undefined }],
    ['a title that is not text', { ...NOTE, title: ['A'] }],
    ['a list', [NOTE]],
  ])('calls a note answered as %s malformed', async (_case, body) => {
    invoke.mockResolvedValue(answer(200, body));
    expect(
      await failureOf(tauriGranola.getNote({ vault: VAULT, id: ID, transcript: true })),
    ).toMatchObject({ kind: 'malformed' });
  });

  it('reads a page of a transcript, and where the next starts', async () => {
    invoke
      .mockResolvedValueOnce(
        answer(200, { transcript: NOTE.transcript, hasMore: true, cursor: 'p2' }),
      )
      .mockResolvedValueOnce(answer(200, { transcript: [], hasMore: false, cursor: null }));

    await expect(
      tauriGranola.getTranscriptPage({ vault: VAULT, id: ID, cursor: null }),
    ).resolves.toEqual({ transcript: NOTE.transcript, cursor: 'p2' });
    await expect(
      tauriGranola.getTranscriptPage({ vault: VAULT, id: ID, cursor: 'p2' }),
    ).resolves.toEqual({ transcript: [], cursor: null });
    expect(invoke.mock.calls).toEqual([
      [
        'granola_request',
        { vault: VAULT, path: `/v1/notes/${ID}/transcript`, query: { page_size: '100' } },
      ],
      [
        'granola_request',
        {
          vault: VAULT,
          path: `/v1/notes/${ID}/transcript`,
          query: { page_size: '100', cursor: 'p2' },
        },
      ],
    ]);
  });

  it.each([
    { hasMore: false },
    { transcript: {}, hasMore: false },
    { transcript: [], hasMore: true },
    { transcript: [] },
  ])('calls a transcript page it cannot read (%j) malformed', async (body) => {
    invoke.mockResolvedValue(answer(200, body));
    expect(
      await failureOf(tauriGranola.getTranscriptPage({ vault: VAULT, id: ID, cursor: null })),
    ).toMatchObject({ kind: 'malformed' });
  });
});

describe('tauriGranola: what Granola refused', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it.each([401, 403, 404, 413, 429, 500, 302])(
    'passes status %i on as Granola’s refusal, without its body',
    async (status) => {
      invoke.mockResolvedValue(answer(status, { message: 'Mara Quill’s meeting notes' }));
      const failure = await failureOf(
        tauriGranola.getNote({ vault: VAULT, id: ID, transcript: true }),
      );
      expect(failure).toEqual({
        kind: 'api_refused',
        status,
        message: `Granola answered ${status}`,
      });
    },
  );

  it('calls an answer that is not JSON malformed, without its body', async () => {
    invoke.mockResolvedValue(answer(200, '<html>Mara Quill</html>'));
    const failure = await failureOf(
      tauriGranola.listNotes({ vault: VAULT, updatedAfter: null, cursor: null }),
    );
    expect(failure).toEqual({ kind: 'malformed', message: 'Granola did not answer with JSON' });
  });
});

describe('granolaErrorOf: the host’s rejections', () => {
  it.each(['no_key', 'invalid', 'unreachable', 'timeout', 'too_large', 'malformed', 'keychain'])(
    'keeps the host’s kind %s and its message',
    (kind) => {
      expect(granolaErrorOf({ kind, message: 'what the host said' }).failure).toEqual({
        kind,
        message: 'what the host said',
      });
    },
  );

  it('turns a rejection from any command into the app’s error', async () => {
    invoke.mockReset();
    invoke.mockRejectedValue({ kind: 'no_key', message: 'no Granola API key is kept' });
    expect(
      await failureOf(tauriGranola.listNotes({ vault: VAULT, updatedAfter: null, cursor: null })),
    ).toEqual({ kind: 'no_key', message: 'no Granola API key is kept' });
    expect(await failureOf(tauriGranola.status({ vault: VAULT }))).toMatchObject({
      kind: 'no_key',
    });
  });

  it('makes anything the host did not build a request that could not be made', () => {
    expect(granolaErrorOf('invalid args `vault`').failure).toEqual({
      kind: 'invalid',
      message: 'invalid args `vault`',
    });
    expect(granolaErrorOf(new Error('ipc closed')).failure).toEqual({
      kind: 'invalid',
      message: 'ipc closed',
    });
    expect(granolaErrorOf({ kind: 'refused', message: 'x' }).failure.kind).toBe('invalid');
    // The host never says Granola refused: that is read from an answer's status, not a rejection.
    expect(granolaErrorOf({ kind: 'api_refused', message: 'x' }).failure.kind).toBe('invalid');
    expect(granolaErrorOf({ kind: 'timeout', message: 7 }).failure).toEqual({
      kind: 'timeout',
      message: '',
    });
  });
});
