import { describe, expect, it } from 'vitest';
import { apiFixture, bodyOf, codeOf } from '@atlas/application';
import { atlasQueryIndex } from '@atlas/application/testing/sqlite';
import { mapMeeting, splitFrontmatter } from '@atlas/domain';
import { remarkMarkdown } from './markdown-port.ts';

/*
 * Adversarial cases for POST /v1/meetings (#93). Each test names one promise
 * the route makes — "the file n8n's mapper would write", "two sends at once
 * write each meeting", "a request the host lets in is answered" — and an input
 * that breaks it. All names are made up.
 */

type ApiFixture = ReturnType<typeof apiFixture>;

/** A meeting whose subject states its day and time, so nothing else is needed to place it. */
const SENT = {
  provider: 'gemini',
  sourceId: '19a2b3c4d5e6f701',
  title: 'Larkspur Payroll leads sync',
  subject: 'Notes: “Larkspur Payroll leads sync” Oct 6, 2026 10:00 AM PDT',
};

function vault(files: Record<string, string> = {}): ApiFixture {
  const indexed = atlasQueryIndex({ files, markdown: remarkMarkdown });
  return apiFixture({ files, markdown: remarkMarkdown, index: { query: indexed } });
}

const send = (api: ApiFixture, body: unknown) =>
  api.send({ method: 'POST', path: '/v1/meetings', body });

const writtenPath = (response: Awaited<ReturnType<typeof send>>) =>
  (bodyOf(response) as { meeting: { path: string } }).meeting.path;

const frontmatterOf = (text: string) =>
  remarkMarkdown.frontmatterProperties(splitFrontmatter(text).frontmatter);

describe('POST /v1/meetings writes what n8n’s mapper writes', () => {
  // The mapper reads `group: true` off an attendee record (meeting-attendees.ts
  // fromRecord), and the contract says a group "never becomes a Person". The
  // route rebuilds each attendee as { name, email } and drops the flag, so the
  // same record n8n commits as a group arrives through the API as a person.
  it('keeps an attendee the record marks as a group a group', async () => {
    const attendees = [
      { name: 'Mara Quill', email: 'mara.quill@example.com' },
      { name: 'Larkspur leads', email: 'leads@example.com', group: true },
    ];
    const api = vault();
    const response = await send(api, { ...SENT, attendees });
    expect(response.status).toBe(201);

    const text = api.files.get(writtenPath(response)) ?? { text: '' };
    expect(frontmatterOf(text.text)).toMatchObject({
      attendees: [
        { name: 'Mara Quill', email: 'mara.quill@example.com' },
        { name: 'Larkspur leads', email: 'leads@example.com', group: true },
      ],
    });
    const committed = mapMeeting(
      {
        source: SENT.provider,
        sourceId: SENT.sourceId,
        title: SENT.title,
        stated: SENT.subject,
        attendees,
      },
      { timeZone: 'America/Los_Angeles' },
    );
    expect(text.text).toBe(committed.content);
  });
});

describe('POST /v1/meetings: sends at once into a vault with no Inbox/Meetings yet', () => {
  // ensureFolder lists, then creates; two requests interleave between the two,
  // and the second create_folder fails ("something with that name is already
  // there"). That is answered 500 `internal` — "a fault of ours" by ADR-0016 —
  // and logged in Activity as a refused write, though nothing was wrong with
  // the request and the folder it wanted now exists. The same happens to two
  // different meetings in one n8n run, not only to a retry of one.
  it('writes both of two different meetings sent at once', async () => {
    const api = vault({ 'Inbox/Older.md': '# Older\n' });
    const [first, second] = await Promise.all([
      send(api, SENT),
      send(api, {
        ...SENT,
        sourceId: '19a2b3c4d5e6f702',
        title: 'Tobias Fenn 1:1',
        subject: 'Notes: “Tobias Fenn 1:1” Oct 6, 2026 2:00 PM PDT',
      }),
    ]);

    expect([codeOf(first), codeOf(second)]).not.toContain('internal');
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(api.writes).toHaveLength(2);
  });
});

describe('POST /v1/meetings: a transcript the host lets in', () => {
  // STAMPED in meeting-transcript.ts, /\]\s*([^:*\]]+?)\s*:/, backtracks once
  // per character of a whitespace run inside a "[hh:mm:ss] …" line with no
  // colon after it: quadratic. The route runs in the webview, so the app's
  // only JS thread is blocked while it maps — about 1.2 s at 40 000 spaces,
  // and minutes for a run near the host's 1 MiB body limit. Measured as a
  // ratio so the machine's speed does not decide it: eight times the input
  // should take about eight times as long, not sixty-four.
  it('maps in time that grows with the transcript, not with its square', async () => {
    const timeFor = async (spaces: number) => {
      const api = vault();
      const transcriptMd = [
        `[00:00:01] Mara Quill${' '.repeat(spaces)}said nothing with a colon`,
        '### Transcription ended after 00:11:49',
      ].join('\n');
      const started = performance.now();
      const response = await send(api, { ...SENT, transcriptMd });
      const took = performance.now() - started;
      expect(response.status).toBe(201);
      return took;
    };
    await timeFor(1_000);
    const small = await timeFor(10_000);
    const large = await timeFor(80_000);
    expect(large / Math.max(small, 1)).toBeLessThan(20);
  }, 60_000);
});
