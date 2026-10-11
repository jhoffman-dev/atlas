import { describe, expect, it } from 'vitest';
import { ImportRecordError, parseRecord, recordText } from './import-record.ts';

const ID = 'a1000000000000000000000000000001';
const OTHER = 'a1000000000000000000000000000002';

/** A record file holding `json` as its list of pages. */
const holding = (json: string) => `---\natlas: import\n---\n\n\`\`\`json\n${json}\n\`\`\`\n`;

describe('the import record', () => {
  it('reads back what it was written as, in the order of the ids', () => {
    const record = new Map([
      [OTHER, { fields: { status: 'abc' }, body: 'nothing' }],
      [ID, { fields: {}, body: 'def' }],
    ]);
    const text = recordText(record);
    expect(parseRecord(text)).toEqual(record);
    expect(text.indexOf(ID)).toBeLessThan(text.indexOf(OTHER));
    expect(text).toContain('# Notion workspace import');
  });

  it.each([
    ['no list of pages', 'just words', 'it has no list of pages'],
    ['a list that is not JSON', holding('{pages'), 'its list of pages is not JSON'],
    [
      'another version',
      holding('{"version":2,"pages":{}}'),
      'it is not a record this import wrote',
    ],
    [
      'pages that are not a map',
      holding('{"version":1,"pages":[]}'),
      'it is not a record this import wrote',
    ],
    [
      'a key that is no page id',
      holding('{"version":1,"pages":{"x":{"fields":{},"body":""}}}'),
      '"x" is not a Notion page id',
    ],
    [
      'a page with no body',
      holding(`{"version":1,"pages":{"${ID}":{"fields":{}}}}`),
      `what it says of ${ID}`,
    ],
    [
      'a property with no digest',
      holding(`{"version":1,"pages":{"${ID}":{"fields":{"a":1},"body":""}}}`),
      `a property of ${ID} has no digest`,
    ],
  ])('is refused, never half read, with %s', (_, text, reason) => {
    expect(() => parseRecord(text)).toThrow(ImportRecordError);
    expect(() => parseRecord(text)).toThrow(reason);
  });
});
