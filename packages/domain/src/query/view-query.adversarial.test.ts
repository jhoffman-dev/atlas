/**
 * Attacks on the query compiler.
 *
 * Every test here states an invariant the module already claims — "values are
 * always bound as parameters", "anything that is not a plain identifier is
 * refused" — and tries to break it. A failure is a bug in `view-query.ts`.
 */

import { describe, expect, it } from 'vitest';
import { compileViewQuery, relativeDateSql, type ViewQuery } from './view-query.ts';

const query = (overrides: Partial<ViewQuery> = {}): ViewQuery => ({
  type: 'company',
  columns: [],
  filters: [],
  sorts: [],
  limit: 100,
  ...overrides,
});

const compileWithValue = (value: string) =>
  compileViewQuery(query({ filters: [{ key: 'due', operator: 'is', value }] }));

/** Names every object carries, which a filter value is free to be. */
const INHERITED_NAMES = ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'];

describe('relativeDateSql', () => {
  it.each(INHERITED_NAMES)('says %j is not a relative date', (value) => {
    expect(relativeDateSql(value)).toBeNull();
  });
});

describe('compileViewQuery against filter values', () => {
  it.each(INHERITED_NAMES)('binds %j as a parameter rather than as SQL', (value) => {
    expect(compileWithValue(value).parameters).toContain(value);
  });

  it.each(INHERITED_NAMES)('keeps %j out of the text of the statement', (value) => {
    // One placeholder for the value and one for the limit. Anything else means
    // the value reached the statement instead of the parameter list.
    expect(compileWithValue(value).sql.match(/\?/g)).toHaveLength(2);
  });

  it('never writes a function body into the statement', () => {
    expect(compileWithValue('constructor').sql).not.toContain('native code');
  });
});
