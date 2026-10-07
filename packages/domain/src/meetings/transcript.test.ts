import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from '../markdown/markdown-document.ts';
import { parseTranscript } from './transcript.ts';

const read = (section: string, selfName: string | null = 'James Hoffman') =>
  parseTranscript(section, { selfName, firstLine: 10 });

/** The Transcript section of a fixture: everything after its heading. */
function fixtureTranscript(name: string): string {
  const text = readFileSync(new URL(`./fixtures/valid/${name}`, import.meta.url), 'utf8');
  const body = splitFrontmatter(text).body;
  return body.slice(body.indexOf('## Transcript\n') + '## Transcript\n'.length);
}

describe('a transcript turn', () => {
  it('is a speaker, a time, the words and a block id', () => {
    const { turns, errors } = read('**Mara Quill** [00:09:44] Fine by me. ^t0003');
    expect(errors).toEqual([]);
    expect(turns).toEqual([
      {
        speaker: { kind: 'named', name: 'Mara Quill' },
        writtenSpeaker: 'Mara Quill',
        time: { kind: 'turn', text: '00:09:44', seconds: 584 },
        words: 'Fine by me.',
        blockId: 't0003',
        line: 10,
      },
    ]);
  });

  it('takes its section’s time when marked ~, and none when there is no time', () => {
    const { turns } = read('**A** [~01:02:03] one ^t1\n\n**B** two ^t2');
    expect(turns.map((turn) => turn.time)).toEqual([
      { kind: 'section', text: '01:02:03', seconds: 3723 },
      { kind: 'none' },
    ]);
  });

  it('reads hours past 99, for a recording that ran that long', () => {
    expect(read('**A** [100:00:01] late ^t1').turns[0]?.time).toEqual({
      kind: 'turn',
      text: '100:00:01',
      seconds: 360001,
    });
  });

  it('keeps bracketed words that are not a time as words', () => {
    const { turns, errors } = read('**A** [laughs] Fair. ^t1');
    expect(errors).toEqual([]);
    expect(turns[0]?.time).toEqual({ kind: 'none' });
    expect(turns[0]?.words).toBe('[laughs] Fair.');
  });

  it('may run over several lines, its id at the end or on a line of its own', () => {
    const { turns, errors } = read('**A** [00:00:01] one\nand two ^t1\n\n**B** three\n^t2');
    expect(errors).toEqual([]);
    expect(turns.map(({ words, blockId }) => [words, blockId])).toEqual([
      ['one\nand two', 't1'],
      ['three', 't2'],
    ]);
  });

  it('reads a file saved with Windows line ends', () => {
    const { turns, errors } = read('**A** [00:00:01] one ^t1\r\n\r\n**B** two ^t2\r\n');
    expect(errors).toEqual([]);
    expect(turns.map((turn) => [turn.words, turn.blockId, turn.line])).toEqual([
      ['one', 't1', 10],
      ['two', 't2', 12],
    ]);
  });
});

describe('who spoke', () => {
  it('is the profile’s name when the transcript says You', () => {
    const { turns } = read('**You** hi ^t1\n\n**you** again ^t2');
    expect(turns.map((turn) => turn.speaker)).toEqual([
      { kind: 'self', name: 'James Hoffman' },
      { kind: 'self', name: 'James Hoffman' },
    ]);
  });

  it('is You with no name when the profile has none — never a guess', () => {
    expect(read('**You** hi ^t1', null).turns[0]?.speaker).toEqual({ kind: 'self', name: null });
  });

  it('is Unknown for Remote Speaker and the other names providers give the unnamed', () => {
    const labels = [
      'Remote Speaker',
      'Unknown',
      'unknown speaker',
      'Speaker 2',
      'Guest',
      'Participant 3',
    ];
    const section = labels.map((label, index) => `**${label}** hi ^t${index}`).join('\n\n');
    const { turns, errors } = read(section);
    expect(errors).toEqual([]);
    expect(turns.map((turn) => turn.speaker)).toEqual(labels.map(() => ({ kind: 'unknown' })));
    expect(turns.map((turn) => turn.writtenSpeaker)).toEqual(labels);
  });

  it('is a real name otherwise, even one that starts like an unknown label', () => {
    expect(read('**Speaker Jones** hi ^t1').turns[0]?.speaker).toEqual({
      kind: 'named',
      name: 'Speaker Jones',
    });
  });
});

describe('a transcript that breaks the contract', () => {
  it('reports a turn with no block id and does not invent one', () => {
    const { turns, errors } = read('**A** [00:00:01] has one ^t1\n\n**B** [00:00:02] has none');
    expect(turns[1]?.blockId).toBeNull();
    expect(errors).toEqual([
      expect.objectContaining({ in: 'body', field: 'Transcript', line: 12 }),
    ]);
    expect(errors[0]?.message).toMatch(/no block id/);
  });

  it('reports an id used twice, naming both lines', () => {
    const { errors } = read('**A** one ^t1\n\n**B** two ^t2\n\n**C** three ^t1');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ field: 'Transcript', line: 14 });
    expect(errors[0]?.message).toMatch(/\^t1 is already the id of line 10/);
  });

  it('reports a time that is not one', () => {
    for (const time of ['00:61:00', '00:00:60', '1:02', '1:02:03', '::']) {
      const { errors } = read(`**A** [${time}] hi ^t1`);
      expect(errors, time).toHaveLength(1);
      expect(errors[0]?.message, time).toMatch(/is not a time like 00:09:44/);
    }
  });

  it('reports a block that is not a turn', () => {
    const { turns, errors } = read('Transcript, 2 October\n\n**A** hi ^t1\n\n** ** blank ^t2');
    expect(turns).toHaveLength(1);
    expect(errors.map((error) => error.line)).toEqual([10, 14]);
    expect(errors[0]?.message).toMatch(/is not a turn/);
  });

  it('reports a turn with an id and no words', () => {
    expect(read('**A** ^t1').errors[0]?.message).toMatch(/is not a turn/);
  });

  it('reports an empty transcript on its heading’s line', () => {
    for (const section of ['', '\n\n  \n']) {
      const { turns, errors } = read(section);
      expect(turns).toEqual([]);
      expect(errors).toEqual([expect.objectContaining({ field: 'Transcript', line: 9 })]);
      expect(errors[0]?.message).toMatch(/Transcript is empty/);
    }
  });
});

describe('the fixtures’ transcripts', () => {
  it('Gemini: real names, each turn at its section’s time', () => {
    const { turns, errors } = read(fixtureTranscript('gemini-platform-sync.md'));
    expect(errors).toEqual([]);
    expect(turns.map((turn) => [turn.writtenSpeaker, turn.time.kind, turn.blockId])).toEqual([
      ['Mara Quill', 'section', 't0001'],
      ['Tobias Fenn', 'section', 't0002'],
      ['Mara Quill', 'section', 't0003'],
      ['Tobias Fenn', 'section', 't0004'],
    ]);
  });

  it('Granola: You and the unnamed, each turn at its own time', () => {
    const { turns, errors } = read(fixtureTranscript('granola-vendor-call.md'));
    expect(errors).toEqual([]);
    expect(turns.map((turn) => [turn.speaker, turn.time.kind])).toEqual([
      [{ kind: 'self', name: 'James Hoffman' }, 'turn'],
      [{ kind: 'unknown' }, 'turn'],
      [{ kind: 'self', name: 'James Hoffman' }, 'turn'],
      [{ kind: 'unknown' }, 'turn'],
    ]);
  });
});
