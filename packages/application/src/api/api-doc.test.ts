import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_ROUTES } from './contract.ts';

/**
 * The route table in `vault/docs/api/v1.md` is what people and other tools read
 * the API from, so it lists exactly the routes the contract serves: a route
 * added, renamed or dropped in one and not the other fails here.
 */

const DOC = new URL('../../../../vault/docs/api/v1.md', import.meta.url);
const ROW = /^\| (GET|POST|PUT|PATCH|DELETE) +\| `([^`]+)` +\|/;

function documentedRoutes(): string[] {
  return readFileSync(DOC, 'utf8')
    .split('\n')
    .map((line) => ROW.exec(line))
    .filter((match) => match !== null)
    .map((match) => `${match[1]} ${match[2]}`);
}

describe('vault/docs/api/v1.md', () => {
  it('lists every route the contract serves, once, and no other', () => {
    const served = API_ROUTES.map((route) => `${route.method} ${route.path}`);
    const documented = documentedRoutes();
    expect([...documented].sort()).toEqual([...served].sort());
    expect(new Set(documented).size).toBe(documented.length);
  });
});
