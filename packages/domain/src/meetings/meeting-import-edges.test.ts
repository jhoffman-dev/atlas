import { describe, expect, it } from 'vitest';
import type { FrontmatterReading, MeetingImportResult } from './meeting-import.ts';
import { validateMeetingImport } from './meeting-import.ts';
import { parseProviderNextSteps } from './next-steps.ts';
import { parseTranscript } from './transcript.ts';

/*
 * Edges of meeting/v1 the first tests did not reach (adversarial pass on
 * P28-01). Each test is one invariant of the contract
 * (vault/docs/contracts/meeting-import-v1.md, ADR-0027) that a file can
 * currently break without being refused or read right.
 */

const VALID: Readonly<Record<string, unknown>> = {
  type: 'meeting',
  atlas_import: 'meeting/v1',
  title: 'Platform weekly sync',
  date: '2026-09-29',
  start: '10:00',
  provider: 'gemini',
  external_id: 'gemini-7f3a9c21',
};

const FRONTMATTER = '---\nheld: by the fake reader\n---\n';

function validate(
  body: string,
  properties: Readonly<Record<string, unknown>> = VALID,
): MeetingImportResult {
  const readFrontmatter = (): FrontmatterReading => ({ properties, problem: null });
  return validateMeetingImport({ text: FRONTMATTER + body, readFrontmatter, selfName: 'Me' });
}

const transcriptOnly = (turns: string) => `## Transcript\n\n${turns}\n`;
const read = (section: string) => parseTranscript(section, { selfName: 'Me', firstLine: 1 });

describe('a block id is unique in the whole meeting file', () => {
  it('refuses a next step that carries the id of a transcript turn', () => {
    const body = [
      '## Provider next steps',
      '',
      '- [Mara] Flag the cache: before Friday. ^t0001',
      '',
      '## Transcript',
      '',
      '**Mara** [~00:00:00] Morning. ^t0001',
      '',
    ].join('\n');
    expect(validate(body).ok).toBe(false);
  });

  it('refuses a Summary paragraph that carries the id of a transcript turn', () => {
    const body = [
      '## Summary',
      '',
      'Agreed. ^t0001',
      '',
      '## Transcript',
      '',
      '**Mara** [~00:00:00] Morning. ^t0001',
      '',
    ].join('\n');
    expect(validate(body).ok).toBe(false);
  });
});

describe('every turn keeps its own block id', () => {
  it('refuses two turns written without a blank line between them, not one merged turn', () => {
    const result = validate(transcriptOnly('**Mara** hi ^t0001\n**Tobias** yo ^t0002'));
    // Today: ok, one turn by Mara whose words are "hi ^t0001\n**Tobias** yo", id t0002;
    // ^t0001 is silently lost, so nothing citing it resolves.
    expect(result.ok).toBe(false);
  });

  it('refuses a block id written in the middle of a turn', () => {
    const { errors } = read('**Mara** before ^t0001 after ^t0002');
    expect(errors).not.toEqual([]);
  });
});

describe('a time in a turn is a time, or refused', () => {
  it('refuses a timed turn with no words, rather than reading the time as its words', () => {
    const { turns, errors } = read('**Mara** [00:00:01] ^t1');
    // Today: no error; time { kind: none }, words "[00:00:01]".
    expect({ errors: errors.length > 0, words: turns[0]?.words }).toMatchObject({ errors: true });
  });

  it.each(['[00:09:44.500] hi', '[-00:00:01] hi', '[00:09:44]hi', '[~ 00:09:44] hi'])(
    'refuses time-shaped brackets that are not a time: %s',
    (rest) => {
      const { turns, errors } = read(`**Mara** ${rest} ^t1`);
      // Today: accepted, the bracket kept as the turn's words with no time.
      expect({ refused: errors.length > 0, words: turns[0]?.words }).toMatchObject({
        refused: true,
      });
    },
  );

  it.each(['24:00:00', '99:59:59'])(
    'refuses a time of day past 23:59:59 when transcript_clock is wall: %s',
    (time) => {
      const result = validate(transcriptOnly(`**You** [${time}] hi ^t0001`), {
        ...VALID,
        transcript_clock: 'wall',
      });
      expect(result.ok).toBe(false);
    },
  );
});

describe('turn ids are ^t0001, ^t0002, … in order', () => {
  it('refuses ids that run backwards', () => {
    expect(read('**A** one ^t0002\n\n**B** two ^t0001').errors).not.toEqual([]);
  });
});

describe('a section the contract names is never silently skipped', () => {
  it('refuses a Transcript written as an H1, rather than reading a meeting with no turns', () => {
    const result = validate('# Transcript\n\n**Mara** [~00:00:00] Morning. ^t0001\n');
    // Today: ok, with transcript [] — the turns vanish without a word.
    expect(result.ok ? result.meeting.transcript.length : 'refused').not.toBe(0);
  });

  it('refuses a Transcript written as an H3, rather than reading a meeting with no turns', () => {
    const result = validate('### Transcript\n\n**Mara** [~00:00:00] Morning. ^t0001\n');
    expect(result.ok ? result.meeting.transcript.length : 'refused').not.toBe(0);
  });

  it('refuses an unclosed code fence that swallows the sections after it', () => {
    const body = [
      '## Notes',
      '',
      '```',
      'a stray fence from the provider',
      '',
      '## Transcript',
      '',
      '**Mara** [~00:00:00] Morning. ^t0001',
      '',
    ].join('\n');
    const result = validate(body);
    // Today: ok, with transcript [] and the turns inside notes.
    expect(result.ok ? result.meeting.transcript.length : 'refused').not.toBe(0);
  });

  it('closes a ``` fence only with ```, so a ~~~ line inside it does not expose a heading', () => {
    const body = ['## Notes', '', '```', '~~~', '## Example', '```', ''].join('\n');
    // CommonMark: `## Example` is code. Today: refused as an unknown section.
    expect(validate(body).ok).toBe(true);
  });
});

describe('an unnamed speaker is never guessed into a Person', () => {
  it.each(['Remote Speaker 2', 'Unknown Speaker 2'])('%s is unknown', (label) => {
    expect(read(`**${label}** hi ^t1`).turns[0]?.speaker).toEqual({ kind: 'unknown' });
  });
});

describe('a next step’s owner is who the provider named, or nobody', () => {
  it('does not read a checked box `- [x]` as an owner called x', () => {
    const { steps, errors } = parseProviderNextSteps('- [x] Send the contract: today.', 1);
    // `[ ]` is refused because it reads as a checkbox; `[x]` is the same checkbox.
    expect(errors.length > 0 || steps[0]?.owner !== 'x').toBe(true);
  });

  it('keeps an owner holding brackets, not folding it into the step text', () => {
    const { steps } = parseProviderNextSteps('- [Mara [PM]] Send it: today.', 1);
    expect(steps[0]?.owner).toBe('Mara [PM]');
  });

  it('reads a wikilinked owner as the owner', () => {
    const { steps } = parseProviderNextSteps('- [[Mara Quill]] Send it: today.', 1);
    expect(steps[0]?.owner).toMatch(/Mara Quill/);
  });

  it('keeps a confidence followed by a full stop, or refuses the line', () => {
    const { steps, errors } = parseProviderNextSteps(
      '- [Ann] Send it: today (confidence: high).',
      1,
    );
    expect(errors.length > 0 || steps[0]?.confidence === 'high').toBe(true);
  });
});

/*
 * Review findings on P28-01 that no test above reaches.
 */

describe('a bracket of digits after the speaker is always the turn’s time', () => {
  it.each(['[1:02]', '[1:02]hi', '[00:00:01]'])(
    'refuses %s rather than reading it as the words',
    (rest) => {
      const { turns, errors } = read(`**Mara** ${rest} ^t1`);
      expect(errors).not.toEqual([]);
      expect(turns[0]?.words ?? '').not.toContain('[');
    },
  );

  it('reads a time of day up to 23:59:59 when transcript_clock is wall', () => {
    const result = validate(transcriptOnly('**You** [23:59:59] hi ^t0001'), {
      ...VALID,
      transcript_clock: 'wall',
    });
    expect(result.ok ? [] : result.errors).toEqual([]);
  });
});

describe('a turn id is ^t and a number', () => {
  it('refuses a turn id of another shape', () => {
    const { errors } = read('**Mara** hi ^abc123');
    expect(errors.map((error) => error.message)).toEqual([expect.stringMatching(/\^t0001/)]);
  });

  it('reads ids that skip numbers, as long as they rise', () => {
    expect(read('**A** one ^t1\n\n**B** two ^t0003\n\n**C** three ^t10').errors).toEqual([]);
  });
});

describe('an unnamed speaker labelled by letter', () => {
  it.each(['Speaker A', 'Guest B'])('%s is unknown', (label) => {
    expect(read(`**${label}** hi ^t1`).turns[0]?.speaker).toEqual({ kind: 'unknown' });
  });
});

describe('an empty profile name is no name', () => {
  it('reads You as the owner with no name when selfName is blank', () => {
    const result = validateMeetingImport({
      text: FRONTMATTER + transcriptOnly('**You** hi ^t0001'),
      readFrontmatter: () => ({ properties: VALID, problem: null }),
      selfName: '',
    });
    expect(result.ok ? result.meeting.transcript[0]?.speaker : result.errors).toEqual({
      kind: 'self',
      name: null,
    });
  });
});

describe('a code fence closes as CommonMark closes it', () => {
  it('does not close a ```` fence with ```', () => {
    const body = ['## Notes', '', '````', '```', '## Example', '````', ''].join('\n');
    expect(validate(body).ok).toBe(true);
  });
});

describe('a long line is read in linear time', () => {
  // Quadratic patterns took seconds on lines this long and so hit the test's
  // timeout; linear ones take milliseconds. No clock is read here.
  const spaces = ' '.repeat(200_000);

  it('reads a heading line of 200,000 spaces', () => {
    const result = validate(`## Notes\n\n## a${spaces}x\n`);
    expect(result.ok ? [] : result.errors.map((error) => error.line)).toEqual([6]);
  });

  it('reads a next step of 200,000 spaces', () => {
    const { steps } = parseProviderNextSteps(`- a${spaces}b`, 1);
    expect(steps[0]?.text).toBe(`a${spaces}b`);
  });
});
