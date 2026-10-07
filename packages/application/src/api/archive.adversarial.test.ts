/**
 * Adversarial pass on Phase 23 (A23). P23-03 promises archive and unarchive
 * "through the API + MCP, so an AI can find and restore archived items later";
 * the contract is where a route is first declared.
 */
import { describe, expect, it } from 'vitest';
import { API_ROUTES } from './contract.ts';

const routes = API_ROUTES.map((route) => `${route.method} ${route.path}`);

describe('the API reaches the Archive (A23, P23-03)', () => {
  it('declares a route that archives a note', () => {
    expect(routes.some((route) => /^POST .*\/archive$/.test(route))).toBe(true);
  });

  it('declares a route that unarchives a note', () => {
    expect(routes.some((route) => /^POST .*\/unarchive$/.test(route))).toBe(true);
  });
});
