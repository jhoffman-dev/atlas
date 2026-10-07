import { describe, expect, it } from 'vitest';
import { NO_SPAN, type AtlasQuery, type QueryValue } from './ast.ts';
import { blankBuilder, queryFromBuilder, valueFromInput, type BuilderQuery } from './builder.ts';
import { queryableFields, type QueryField } from './fields.ts';
import { parseAtlasQuery } from './parse.ts';
import { printAtlasQuery } from './print.ts';
import { QUERY_TEST_TYPES } from './query-fixtures.ts';
import { QueryTextError } from './query-text-error.ts';

/**
 * Adversarial: the printer is the builder's only way to text, and ADR-0019
 * saves that text. Whatever the printer writes has to read back as the query
 * it was written from, or the saved view means something else (or nothing).
 */

const FIELDS = queryableFields(QUERY_TEST_TYPES, ['task']);
const field = (text: string): QueryField => {
  const found = FIELDS.find((candidate) => candidate.text === text);
  if (found === undefined) throw new Error(`no field ${text}`);
  return found;
};

function whereValue(fieldName: string, value: QueryValue): AtlasQuery {
  const builder: BuilderQuery = {
    ...blankBuilder('task'),
    conditions: [{ field: fieldName, op: '=', value, negated: false }],
  };
  return queryFromBuilder(builder);
}

/** The value the printed text reads back as, without spans. */
function reparsedValue(query: AtlasQuery): unknown {
  const where = parseAtlasQuery(printAtlasQuery(query)).where;
  if (where?.kind !== 'compare') throw new Error('expected one comparison');
  return { ...where.value, span: undefined };
}

describe('printAtlasQuery → parseAtlasQuery round trip (adversarial)', () => {
  it('reads back a number too large for plain digits (String gives 1e+22)', () => {
    // Why: String(1e22) is "1e+22", which the tokenizer refuses at "+" — a saved view that cannot be read.
    const query = whereValue('estimate', { kind: 'number', number: 1e22, span: NO_SPAN });
    expect(reparsedValue(query)).toMatchObject({ kind: 'number', number: 1e22 });
  });

  it('reads back a number typed as long digits into the builder', () => {
    // Why: the builder accepts 23 digits as a number, then prints them in exponent form.
    const value = valueFromInput(field('estimate'), '=', '10000000000000000000000');
    expect(value?.kind).toBe('number');
    const query = whereValue('estimate', value as QueryValue);
    expect(() => parseAtlasQuery(printAtlasQuery(query))).not.toThrow();
  });

  it('reads back a tiny decimal as a number, not as the word 1e-7', () => {
    // Why: String(0.0000001) is "1e-7", which reads back as text — the check then refuses it on a number field.
    const value = valueFromInput(field('estimate'), '=', '0.0000001');
    expect(value).toMatchObject({ kind: 'number', number: 1e-7 });
    expect(reparsedValue(whereValue('estimate', value as QueryValue))).toMatchObject({
      kind: 'number',
      number: 1e-7,
    });
  });

  it('reads back text made of a letter outside the Basic Multilingual Plane', () => {
    // Why: print's /u regex calls "𠀀" a bare word, but the tokenizer tests one UTF-16 unit at a time and throws.
    const query = whereValue('notes', { kind: 'text', text: '𠀀', span: NO_SPAN });
    expect(reparsedValue(query)).toEqual({ kind: 'text', text: '𠀀' });
  });

  it('reads back a builder link typed with an alias as the same link', () => {
    // Why: valueFromInput keeps "Atlas|the app" as the target; printed as [[Atlas|the app]] it reads back as Atlas.
    const value = valueFromInput(field('project'), '=', '[[Atlas|the app]]') as QueryValue;
    const query = whereValue('project', value);
    expect(reparsedValue(query)).toEqual({ ...value, span: undefined });
  });

  it('reads back a condition on a property called "not"', () => {
    // Why: field names are printed bare, and NOT is read as negation wherever a condition starts.
    const query = whereValue('not', { kind: 'text', text: 'x', span: NO_SPAN });
    expect(() => parseAtlasQuery(printAtlasQuery(query))).not.toThrow();
  });
});

describe('queryFromBuilder limit (adversarial)', () => {
  it('brings a NaN limit within what the text can read back', () => {
    // Why: Math.min/Math.max/Math.floor all pass NaN through, so "LIMIT NaN" is printed and saved.
    const query = queryFromBuilder({ ...blankBuilder('task'), limit: Number.NaN });
    expect(() => parseAtlasQuery(printAtlasQuery(query))).not.toThrow();
  });
});

describe('parseAtlasQuery on hostile input (adversarial)', () => {
  it('reports deeply nested brackets as a QueryTextError, not a stack overflow', () => {
    // Why: recursive descent has no depth limit; a RangeError escapes compileText in run-atlas-query uncaught as a problem.
    const depth = 20_000;
    const text = `FROM task WHERE ${'('.repeat(depth)}status = done${')'.repeat(depth)}`;
    let thrown: unknown = null;
    try {
      parseAtlasQuery(text);
    } catch (error) {
      thrown = error;
    }
    expect(thrown === null || thrown instanceof QueryTextError ? 'ok' : String(thrown)).toBe('ok');
  });

  it('reports a long run of NOTs as a QueryTextError, not a stack overflow', () => {
    // Why: unary() recurses once per NOT.
    const text = `FROM task WHERE ${'NOT '.repeat(20_000)}status = done`;
    let thrown: unknown = null;
    try {
      parseAtlasQuery(text);
    } catch (error) {
      thrown = error;
    }
    expect(thrown === null || thrown instanceof QueryTextError ? 'ok' : String(thrown)).toBe('ok');
  });
});
