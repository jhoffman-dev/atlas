import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { personChipFor, rankMentionSuggestions, type KnownPerson } from './index.ts';

/**
 * Attacks on who `@` offers (P21-02): names spelled with composed or
 * decomposed accents, names with characters a wiki link reads specially,
 * names with dots, and `@@`.
 */

const person = (at: string): KnownPerson => ({ path: createVaultPath(at), modified: 0 });

function rankAmong(query: string, people: readonly KnownPerson[]) {
  return rankMentionSuggestions(query, { people, linkable: people.map((known) => known.path) });
}

describe('a name typed with its accents composed differently from the file’s', () => {
  // macOS keyboards type NFC; files synced from other tools are often NFD.
  const zoe = person('People/Zoe\u0308.md');

  it('still finds the person', () => {
    expect(rankAmong('Zo\u00eb', [zoe])[0]).toMatchObject({ kind: 'person', path: zoe.path });
  });

  it('does not offer to make them a second time', () => {
    expect(rankAmong('Zo\u00eb', [zoe]).some((item) => item.kind === 'create')).toBe(false);
  });

  it('draws a link typed to them as their chip', () => {
    expect(
      personChipFor('Zo\u00eb', { people: new Set([zoe.path]), notes: [zoe.path] }),
    ).not.toBeNull();
  });
});

describe('a person whose name holds a character a wiki link reads specially', () => {
  // No target opens them: the character sits in the name, and so in the path
  // too. They are offered, so nobody wonders where they went, but never as a
  // link — which would open some other note, or none (A21-02).
  it.each(['People/C# Guild.md', 'People/Bob [Ops].md', 'People/A|B.md', 'People/Up^Down.md'])(
    'is offered with the reason, never with a link that opens something else: %s',
    (at) => {
      const offered = rankAmong('', [person(at)]);
      expect(offered).toHaveLength(1);
      expect(offered[0]).toMatchObject({ kind: 'unlinkable', path: at });
      if (offered[0]?.kind !== 'unlinkable') return;
      expect(offered[0].reason).toMatch(/cannot be linked/);
    },
  );
});

describe('a person whose name has a dot in it', () => {
  it('is still offered once the dot is typed', () => {
    const jr = person('People/J.R. Hartley.md');
    expect(rankAmong('J.R', [jr])[0]).toMatchObject({ kind: 'person', path: jr.path });
  });
});

describe('@@', () => {
  it('offers no new person named "@"', () => {
    expect(rankAmong('@', []).some((item) => item.kind === 'create')).toBe(false);
  });
});
