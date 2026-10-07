import { describe, expect, it } from 'vitest';
import { rankNoteSuggestions } from '../markdown/note-suggestions.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { noteLinks } from './note-links.ts';
import { buildVaultGraph } from './vault-graph.ts';

const TEMPLATE = '.atlas/templates/Company.md';

/**
 * A vault where the Company template holds a default relation and a body link
 * to Acme, and an older note's link was indexed while `[[Company]]` still
 * resolved to the template — an index built before issue #15's fix, which no
 * schema bump makes the app rebuild.
 */
const graph = buildVaultGraph({
  notes: [
    { path: 'Acme.md', title: 'Acme', type: 'company' },
    { path: 'Deal.md', title: 'Deal', type: null },
    { path: TEMPLATE, title: 'Company', type: 'company' },
  ],
  links: [
    { source: TEMPLATE, target: 'Acme.md' },
    { source: 'Deal.md', target: TEMPLATE },
  ],
  relations: [{ source: TEMPLATE, key: 'parent', value: '[[Acme]]' }],
});

describe('a template is never reached from a note (issue #15) — attacks', () => {
  it('leaves a template out of what links to a note, so "Links here" cannot open it', () => {
    const acme = noteLinks(graph, createVaultPath('Acme.md'));
    expect(acme.incoming.map((entry) => entry.path)).not.toContain(TEMPLATE);
  });

  it('draws no edge to a template, even from a link the index resolved before the fix', () => {
    expect(graph.edges.filter((edge) => edge.target === TEMPLATE)).toEqual([]);
  });

  it('leaves a template out of what a note links to, so its foot cannot open it', () => {
    const deal = noteLinks(graph, createVaultPath('Deal.md'));
    expect(deal.outgoing.map((entry) => entry.path)).not.toContain(TEMPLATE);
  });

  it('never offers a template after [[', () => {
    const notes = [createVaultPath('Acme.md'), createVaultPath(TEMPLATE)];
    const offered = rankNoteSuggestions('Comp', notes, { linkable: notes });
    expect(offered.map((suggestion) => suggestion.path)).not.toContain(TEMPLATE);
  });
});
