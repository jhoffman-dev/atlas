import { describe, expect, it } from 'vitest';
import {
  MAX_SUMMARY_BLOCK_CHARACTERS,
  placeSummary,
  plainLine,
  readSummaryBlock,
  removeSummary,
  renderSummaryBlock,
  restoreSummary,
  SUMMARY_CLOSE_MARKER,
  SUMMARY_OPEN_MARKER,
  summaryBlockDigest,
  summaryWritten,
  withoutSummaryBlock,
  type MeetingSummary,
} from './meeting-summary-block.ts';

const SUMMARY: MeetingSummary = {
  model: 'claude-sonnet-5-5',
  date: '2026-10-14',
  summary: 'Larkspur Payroll and the platform team agreed to ship the cache behind a flag.',
  keyPoints: ['The cache is ready', 'Tobias wants a flag first'],
  decisions: ['Ship the cache behind a flag'],
  actionItems: [
    {
      title: 'Flag the cache before Friday',
      assignee: 'Tobias Fenn',
      turn: 't0002',
      taskMade: false,
    },
    { title: 'Send Mara the renewal contract', assignee: 'you', turn: 't0003', taskMade: true },
  ],
  openQuestions: ['Who tells the support team?'],
};

const block = (summary: MeetingSummary = SUMMARY) => renderSummaryBlock(summary).text;

const MEETING_BODY =
  '\n## Summary\n\nThey agreed to ship.\n\n## Transcript\n\n**Mara Quill** [00:00:01] Morning. ^t0001\n';

describe('renderSummaryBlock', () => {
  it('writes the marked callout: summary, key points, decisions, action items with assignees, open questions', () => {
    expect(block()).toBe(
      [
        SUMMARY_OPEN_MARKER,
        '',
        '> [!summary] Summary by Claude (claude-sonnet-5-5, 2026-10-14)',
        '> Larkspur Payroll and the platform team agreed to ship the cache behind a flag.',
        '>',
        '> **Key points**',
        '>',
        '> - The cache is ready',
        '> - Tobias wants a flag first',
        '>',
        '> **Decisions**',
        '>',
        '> - Ship the cache behind a flag',
        '>',
        '> **Action items**',
        '>',
        '> - Flag the cache before Friday: Tobias Fenn (turn t0002)',
        '> - Send Mara the renewal contract: you (a task was made)',
        '>',
        '> **Open questions**',
        '>',
        '> - Who tells the support team?',
        '',
        SUMMARY_CLOSE_MARKER,
      ].join('\n'),
    );
  });

  it('leaves out a section with nothing in it, and names nobody as such', () => {
    const text = block({
      ...SUMMARY,
      keyPoints: [],
      decisions: [],
      openQuestions: [],
      actionItems: [{ title: 'Write it up', assignee: '', turn: null, taskMade: false }],
    });
    expect(text).not.toContain('Key points');
    expect(text).not.toContain('Decisions');
    expect(text).not.toContain('Open questions');
    expect(text).toContain('> - Write it up: nobody named\n');
  });

  it('holds no checkbox, no wikilink and no tag, whatever the model wrote', () => {
    const text = block({
      ...SUMMARY,
      summary: 'Talked to [[People/Mara Quill|Mara]] about [[Larkspur Payroll]] #urgent',
      keyPoints: ['- [ ] Ship it', '[x] done already', '![[Diagram.png]]'],
      actionItems: [
        {
          title: '[ ] Call [[Tobias Fenn]]',
          assignee: '[[People/Tobias Fenn]]',
          turn: 't9',
          taskMade: false,
        },
      ],
    });
    expect(text).not.toMatch(/\[\[|\]\]/);
    expect(text).not.toMatch(/- \[[ xX]?\]/);
    expect(text).not.toContain('#urgent');
    expect(text).toContain('> Talked to Mara about Larkspur Payroll urgent');
    expect(text).toContain('> - Ship it\n');
    expect(text).toContain('> - done already\n');
    expect(text).toContain('> - Call Tobias Fenn: Tobias Fenn (turn t9)');
  });

  it('neutralises text that would close the callout or a marker', () => {
    const text = block({
      ...SUMMARY,
      summary: `Fine.\n\nNot quoted any more\n${SUMMARY_CLOSE_MARKER}\n<!-- atlas:summary v1 -->\n## Transcript`,
      keyPoints: [`one\n\ntwo -->`],
    });
    const reading = readSummaryBlock(text);
    expect(reading.kind).toBe('block');
    // Only the block's own two markers; every line of the callout is quoted.
    expect(text.match(/<!--\s*\/?atlas:summary/g)).toHaveLength(2);
    expect(text).not.toContain('-->\n> ## ');
    // Every line between the open marker and the close is quoted.
    const callout = text.split('\n').slice(2, -2);
    expect(callout.every((line) => line.startsWith('>'))).toBe(true);
    expect(text.split('\n').slice(-2)).toEqual(['', SUMMARY_CLOSE_MARKER]);
    expect(text).not.toMatch(/^## /m);
  });

  it('writes no block id of the model’s and no turn id it could not be', () => {
    const text = block({
      ...SUMMARY,
      summary: 'Ends with a block id ^t0001',
      actionItems: [{ title: 'Do it ^abc', assignee: 'you', turn: 't0001]] ^x', taskMade: false }],
    });
    expect(text).not.toMatch(/\^/);
    expect(text).toContain('> - Do it: you (turn t0001)');
  });

  it('cuts the summary to 150 words and keeps 6 key points and 4 open questions, saying so', () => {
    const rendered = renderSummaryBlock({
      ...SUMMARY,
      summary: Array.from({ length: 180 }, (_, at) => `w${at}`).join(' '),
      keyPoints: Array.from({ length: 8 }, (_, at) => `point ${at}`),
      decisions: [],
      actionItems: [],
      openQuestions: Array.from({ length: 5 }, (_, at) => `q${at}?`),
    });
    expect(rendered.text).toContain('w149…');
    expect(rendered.text).not.toContain('w150');
    expect(rendered.text).toContain('point 5');
    expect(rendered.text).not.toContain('point 6');
    expect(rendered.text).toContain('q3?');
    expect(rendered.text).not.toContain('q4?');
    expect(rendered.cut).toEqual(
      expect.arrayContaining([
        'The summary was 180 words: cut to 150.',
        'There were 8 key points: kept the first 6.',
        'There were 5 open questions: kept the first 4.',
      ]),
    );
  });

  it('fits the whole block in about 1,500 characters, the least useful lines first, and says what went', () => {
    const rendered = renderSummaryBlock({
      ...SUMMARY,
      actionItems: Array.from({ length: 25 }, (_, at) => ({
        title: `An action item that takes a fair few words to say, number ${at}`,
        assignee: 'Tobias Fenn',
        turn: `t${at}`,
        taskMade: false,
      })),
    });
    expect(rendered.text.length).toBeLessThanOrEqual(MAX_SUMMARY_BLOCK_CHARACTERS);
    expect(rendered.text).not.toContain('Open questions');
    expect(rendered.text).toMatch(/> - and \d+ more: see the meeting’s tasks and the Inbox/);
    expect(rendered.cut.at(-1)).toMatch(
      /^The block was \d+ characters.*left out 1 open question, \d+ action items\.$/,
    );
    expect(readSummaryBlock(rendered.text).kind).toBe('block');
  });

  it('cuts every line of a runaway answer and still closes the block', () => {
    const huge = 'x'.repeat(2_000_000);
    const rendered = renderSummaryBlock({
      ...SUMMARY,
      summary: huge,
      keyPoints: [huge, huge, huge],
      decisions: [huge, huge, huge],
      openQuestions: [huge],
    });
    expect(rendered.text.length).toBeLessThanOrEqual(MAX_SUMMARY_BLOCK_CHARACTERS * 2);
    expect(rendered.text.endsWith(SUMMARY_CLOSE_MARKER)).toBe(true);
    expect(rendered.cut.length).toBeGreaterThan(0);
  });

  it('keeps the title to a model name and a date', () => {
    const text = block({ ...SUMMARY, model: 'evil) <!-- x', date: 'yesterday' });
    expect(text).toContain('> [!summary] Summary by Claude (evil--x, )');
  });
});

describe('placeSummary', () => {
  it('puts the block at the top, before the provider’s Summary, every other byte as it was', () => {
    const placed = placeSummary(MEETING_BODY, block(), { recorded: null });
    expect(placed).toMatchObject({ ok: true, replaced: false });
    if (!placed.ok) return;
    expect(placed.body).toBe(`\n${block()}\n\n${MEETING_BODY.slice(1)}`);
    expect(placed.digest).toBe(summaryBlockDigest(block()));
  });

  it.each([
    ['sections', MEETING_BODY],
    ['no sections', '\nJust some notes.\n'],
    ['a # Title first', '\n# Platform weekly sync\n\n## Summary\n\nShipped.\n'],
    ['frontmatter only (an empty body)', ''],
    ['a blank body', '\n'],
    ['words before the first section', 'My own line.\n## Summary\n\nShipped.\n'],
    [
      'Windows line ends',
      '\r\n## Summary\r\n\r\nShipped.\r\n\r\n## Transcript\r\n\r\n**A** x ^t1\r\n',
    ],
  ])('round-trips a body with %s: placed, read, removed', (_name, body) => {
    const placed = placeSummary(body, block(), { recorded: null });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const reading = readSummaryBlock(placed.body);
    expect(reading).toMatchObject({ kind: 'block', digest: placed.digest });
    expect(withoutSummaryBlock(placed.body)).toBe(body);
    expect(removeSummary(placed.body, { recorded: placed.digest })).toEqual({ ok: true, body });
  });

  it('puts it on a line of its own under a # Title with nothing after it', () => {
    const placed = placeSummary('# Platform weekly sync', block(), { recorded: null });
    expect(placed.ok && placed.body).toBe(`# Platform weekly sync\n\n${block()}\n`);
  });

  it('puts it after a # Title line, before the first section', () => {
    const placed = placeSummary('\n# Weekly\n\n## Summary\n\nShipped.\n', block(), {
      recorded: null,
    });
    expect(placed.ok && placed.body).toBe(`\n# Weekly\n\n${block()}\n\n## Summary\n\nShipped.\n`);
  });

  it('puts it before the first section when other words come first', () => {
    const placed = placeSummary('My own line.\n\n## Summary\n', block(), { recorded: null });
    expect(placed.ok && placed.body).toBe(`My own line.\n\n${block()}\n\n## Summary\n`);
  });

  it('writes Windows line ends into a body that has them, and its digest covers them', () => {
    const body = '\r\n## Summary\r\n\r\nShipped.\r\n';
    const placed = placeSummary(body, block(), { recorded: null });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const written = block().replace(/\n/g, '\r\n');
    expect(placed.body).toBe(`\r\n${written}\r\n\r\n## Summary\r\n\r\nShipped.\r\n`);
    expect(placed.digest).toBe(summaryBlockDigest(written));
    expect(readSummaryBlock(placed.body)).toMatchObject({ kind: 'block', digest: placed.digest });
  });

  it('replaces its own block twice over while the digest matches, and never duplicates it', () => {
    const first = placeSummary(MEETING_BODY, block(), { recorded: null });
    if (!first.ok) throw new Error('not placed');
    const second = placeSummary(first.body, block({ ...SUMMARY, summary: 'Second.' }), {
      recorded: first.digest,
    });
    expect(second).toMatchObject({ ok: true, replaced: true });
    if (!second.ok) return;
    const third = placeSummary(second.body, block({ ...SUMMARY, summary: 'Third.' }), {
      recorded: second.digest,
    });
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.body.match(/atlas:summary v1/g)).toHaveLength(1);
    expect(third.body).toContain('> Third.');
    expect(third.body.endsWith(MEETING_BODY.slice(1))).toBe(true);
    // Placing the same block again changes nothing.
    const again = placeSummary(third.body, block({ ...SUMMARY, summary: 'Third.' }), {
      recorded: third.digest,
    });
    expect(again.ok && again.body).toBe(third.body);
  });

  it('refuses after a one-character edit inside the block', () => {
    const first = placeSummary(MEETING_BODY, block(), { recorded: null });
    if (!first.ok) throw new Error('not placed');
    const edited = first.body.replace('agreed', 'agreeD');
    expect(placeSummary(edited, block(), { recorded: first.digest })).toMatchObject({
      ok: false,
      refusal: 'edited',
    });
  });

  it('writes over nothing outside the block: an edit there is no edit to the block', () => {
    const first = placeSummary(MEETING_BODY, block(), { recorded: null });
    if (!first.ok) throw new Error('not placed');
    const outside = first.body.replace('They agreed to ship.', 'My own words.');
    const replaced = placeSummary(outside, block({ ...SUMMARY, summary: 'New.' }), {
      recorded: first.digest,
    });
    expect(replaced.ok && replaced.body).toContain('My own words.');
  });

  it('refuses a block nobody recorded, and one the person took out', () => {
    const first = placeSummary(MEETING_BODY, block(), { recorded: null });
    if (!first.ok) throw new Error('not placed');
    expect(placeSummary(first.body, block(), { recorded: null })).toMatchObject({
      ok: false,
      refusal: 'edited',
    });
    expect(placeSummary(MEETING_BODY, block(), { recorded: first.digest })).toMatchObject({
      ok: false,
      refusal: 'removed',
    });
  });

  it.each([
    [
      'a missing closing marker',
      `${SUMMARY_OPEN_MARKER}\n\n> [!summary] x\n${MEETING_BODY}`,
      'unclosed',
    ],
    [
      'two blocks',
      `${SUMMARY_OPEN_MARKER}\n> ${SUMMARY_CLOSE_MARKER}\n${SUMMARY_OPEN_MARKER}\n> ${SUMMARY_CLOSE_MARKER}\n`,
      'two-blocks',
    ],
    [
      'an unknown marker version',
      `<!-- atlas:summary v2 -->\n> ${SUMMARY_CLOSE_MARKER}\n`,
      'unknown-version',
    ],
    [
      'a closing marker with no opening one',
      `> ${SUMMARY_CLOSE_MARKER}\n${MEETING_BODY}`,
      'stray-marker',
    ],
    [
      'a closing marker before the opening one',
      `> ${SUMMARY_CLOSE_MARKER}\n${SUMMARY_OPEN_MARKER}\n`,
      'stray-marker',
    ],
    [
      'a block inside a code fence',
      `\`\`\`\n${SUMMARY_OPEN_MARKER}\n> ${SUMMARY_CLOSE_MARKER}\n\`\`\`\n${MEETING_BODY}`,
      'in-code-fence',
    ],
  ])('refuses %s, writing nothing', (_name, body, refusal) => {
    const placed = placeSummary(body, block(), { recorded: 'whatever' });
    expect(placed).toMatchObject({ ok: false, refusal });
    if (!placed.ok) expect(placed.reason).not.toBe('');
    expect(readSummaryBlock(body)).toMatchObject({ kind: 'refused', refusal });
  });
});

describe('readSummaryBlock', () => {
  it('reads the block, its digest, and the model and date its title names', () => {
    const placed = placeSummary(MEETING_BODY, block(), { recorded: null });
    if (!placed.ok) throw new Error('not placed');
    expect(readSummaryBlock(placed.body)).toMatchObject({
      kind: 'block',
      text: block(),
      model: 'claude-sonnet-5-5',
      date: '2026-10-14',
      digest: placed.digest,
    });
  });

  it('reads none in a meeting with no block', () => {
    expect(readSummaryBlock(MEETING_BODY)).toEqual({ kind: 'none' });
    expect(readSummaryBlock('')).toEqual({ kind: 'none' });
  });

  it('reads no model when the title was edited away', () => {
    const text = `${SUMMARY_OPEN_MARKER}\n\n> [!summary] Mine now\n> ${SUMMARY_CLOSE_MARKER}`;
    expect(readSummaryBlock(text)).toMatchObject({ kind: 'block', model: null, date: null });
  });
});

describe('summaryWritten', () => {
  const placed = placeSummary(MEETING_BODY, block(), { recorded: null });
  if (!placed.ok) throw new Error('not placed');

  it('is written while the block is the one recorded', () => {
    expect(summaryWritten(placed.body, placed.digest)).toBe('written');
  });

  it('is edited once the block changed, broke, or was taken out', () => {
    expect(summaryWritten(placed.body.replace('flag.', 'flag!'), placed.digest)).toBe('edited');
    expect(summaryWritten(placed.body, null)).toBe('edited');
    expect(summaryWritten(MEETING_BODY, placed.digest)).toBe('edited');
    expect(summaryWritten(`${SUMMARY_OPEN_MARKER}\n${MEETING_BODY}`, placed.digest)).toBe('edited');
  });

  it('is none with no block and nothing recorded', () => {
    expect(summaryWritten(MEETING_BODY, null)).toBe('none');
  });
});

describe('removeSummary', () => {
  it('takes out only a block that is still the one recorded', () => {
    const placed = placeSummary(MEETING_BODY, block(), { recorded: null });
    if (!placed.ok) throw new Error('not placed');
    expect(removeSummary(placed.body, { recorded: placed.digest })).toEqual({
      ok: true,
      body: MEETING_BODY,
    });
    expect(
      removeSummary(placed.body.replace('flag.', 'flag!'), { recorded: placed.digest }),
    ).toMatchObject({ ok: false, refusal: 'edited' });
    expect(removeSummary(MEETING_BODY, { recorded: placed.digest })).toMatchObject({
      ok: false,
      refusal: 'removed',
    });
  });
});

describe('withoutSummaryBlock', () => {
  it('shows the model the meeting without its summary, so it never summarises its own', () => {
    const placed = placeSummary(MEETING_BODY, block(), { recorded: null });
    if (!placed.ok) throw new Error('not placed');
    expect(withoutSummaryBlock(`---\ntype: meeting\n---\n${placed.body}`)).toBe(
      `---\ntype: meeting\n---\n${MEETING_BODY}`,
    );
  });

  it('leaves a block it cannot read as one in place', () => {
    const broken = `${SUMMARY_OPEN_MARKER}\n${MEETING_BODY}`;
    expect(withoutSummaryBlock(broken)).toBe(broken);
  });
});

describe('plainLine', () => {
  it('leaves no comment mark, even one that taking another out would join', () => {
    expect(plainLine('<!-<!---->- /atlas:summary -->', 100)).not.toMatch(/<!--|-->/);
    expect(plainLine('--<!-->>', 100)).not.toMatch(/<!--|-->/);
    const text = renderSummaryBlock({ ...SUMMARY, summary: '<!-<!---->- /atlas:summary -->' }).text;
    expect(readSummaryBlock(text).kind).toBe('block');
  });

  it('is one line, cut to its length', () => {
    expect(plainLine('a\n\nb\tc', 100)).toBe('a b c');
    expect(plainLine('abcdefghij', 5)).toBe('abcd…');
  });

  it('keeps a hash inside a word and drops one that would tag', () => {
    expect(plainLine('C# and #tag and ##twice', 100)).toBe('C# and tag and twice');
    expect(plainLine('## A heading of its own', 100)).toBe('A heading of its own');
  });
});

describe('restoreSummary', () => {
  const placedOver = () => {
    const first = placeSummary(MEETING_BODY, block(), { recorded: null });
    if (!first.ok) throw new Error(first.reason);
    const firstDigest = first.digest;
    const second = placeSummary(first.body, block({ ...SUMMARY, summary: 'New words.' }), {
      recorded: firstDigest,
    });
    if (!second.ok) throw new Error(second.reason);
    return { first, second };
  };

  it('puts the block a run wrote over back, every byte, with its digest', () => {
    const { first, second } = placedOver();
    expect(second.prior).toBe(block());
    expect(restoreSummary(second.body, { recorded: second.digest, prior: second.prior! })).toEqual({
      ok: true,
      body: first.body,
      digest: first.digest,
    });
  });

  it('is refused when the block was edited since, taken out, or the prior is not one block', () => {
    const { second } = placedOver();
    const prior = second.prior!;
    expect(
      restoreSummary(second.body.replace('New words.', 'Mine.'), {
        recorded: second.digest,
        prior,
      }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/edited since/) });
    expect(restoreSummary(MEETING_BODY, { recorded: second.digest, prior })).toMatchObject({
      ok: false,
    });
    for (const forged of ['Not a block.', `${prior}\n\nMore.`, `${prior}\n${prior}`]) {
      expect(restoreSummary(second.body, { recorded: second.digest, prior: forged })).toEqual({
        ok: false,
        reason:
          'The summary this run wrote over is not one DFAI can put back, so the summary was left as it is.',
      });
    }
  });
});
