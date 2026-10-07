import { describe, expect, it } from 'vitest';
import { parseObjectType } from '../types/property-def.ts';
import { NO_SPAN, type AtlasQuery, type QueryValue } from './ast.ts';
import {
  blankBuilder,
  queryFromBuilder,
  valueFromInput,
  type BuilderCondition,
} from './builder.ts';
import { checkAtlasQuery } from './check.ts';
import { queryableFields } from './fields.ts';
import { parseAtlasQuery } from './parse.ts';
import { printAtlasQuery } from './print.ts';
import { QUERY_TEST_TYPES } from './query-fixtures.ts';

/**
 * Adversarial, second pass: whatever the builder can make, the printer writes
 * as text that reads back as the same query — the text is what is saved
 * (ADR-0019), so a query that cannot be read back is a view that is lost.
 */

/** A type with a property called `not`, which is a plain identifier and so a field. */
const TYPES = [
  parseObjectType({ name: 'memo', properties: { not: 'text', body: 'text' } }),
  ...QUERY_TEST_TYPES,
];

function roundTrip(condition: BuilderCondition, type = 'memo'): AtlasQuery {
  const query = queryFromBuilder({ ...blankBuilder(type), conditions: [condition] });
  return parseAtlasQuery(printAtlasQuery(query));
}

describe('a property called "not" (adversarial)', () => {
  it('reads back "not IS EMPTY" from the builder', () => {
    // Why: fieldNamedNot() treats NOT as a field only when a symbol follows it;
    // IS is a word, so "not IS EMPTY" is read as NOT (IS …) and fails.
    expect(() =>
      roundTrip({ field: 'not', op: 'isEmpty', value: null, negated: false }),
    ).not.toThrow();
  });

  it('reads back "not CONTAINS x" from the builder', () => {
    // Why: same rule — CONTAINS is a word, so the field is taken for a negation.
    const value: QueryValue = { kind: 'text', text: 'x', span: NO_SPAN };
    expect(() => roundTrip({ field: 'not', op: 'contains', value, negated: false })).not.toThrow();
  });

  it('checks "not IS NOT EMPTY" typed by hand as the field it names', () => {
    const query = parseAtlasQuery('FROM memo WHERE not IS NOT EMPTY');
    expect(() => checkAtlasQuery(query, TYPES)).not.toThrow();
    expect(query.where).toMatchObject({
      kind: 'empty',
      negated: true,
      field: { name: { text: 'not' } },
    });
  });
});

describe('a text value made of letters outside the Basic Multilingual Plane (adversarial)', () => {
  it('reads back a word that starts with a digit and runs on into such a letter', () => {
    // Why: print calls "5𝓍" a bare word, but readNumber tests the next UTF-16 unit
    // alone — half of 𝓍 is no letter — so the text reads as 5, then a stray word.
    const value: QueryValue = { kind: 'text', text: '5𝓍', span: NO_SPAN };
    const reread = roundTrip({ field: 'body', op: '=', value, negated: false });
    expect(reread.where).toMatchObject({ kind: 'compare', value: { kind: 'text', text: '5𝓍' } });
  });
});

describe('a link typed into the builder (adversarial)', () => {
  it('prints a typed link it could not read as text that reads back', () => {
    // Why: valueFromInput keeps "|Atlas" whole when it names no note; printed as
    // [[|Atlas]] it is refused by the tokenizer: "A link needs the name of a note".
    const project = queryableFields(QUERY_TEST_TYPES, ['task']).find(
      (field) => field.text === 'project',
    );
    if (project === undefined) throw new Error('no project field');
    const value = valueFromInput(project, '=', '|Atlas');
    expect(value).not.toBeNull();
    expect(() =>
      roundTrip({ field: 'project', op: '=', value, negated: false }, 'task'),
    ).not.toThrow();
  });
});
