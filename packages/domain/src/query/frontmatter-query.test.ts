import { describe, expect, it } from 'vitest';
import { asQuery } from './frontmatter-query.ts';

describe('asQuery columns', () => {
  it('reads a column listed twice in a hand-edited view once, in first-seen order', () => {
    const query = asQuery({ type: 'task', columns: ['status', 'due', ' status ', 'due', 'owner'] });
    expect(query?.columns).toEqual(['status', 'due', 'owner']);
  });
});
