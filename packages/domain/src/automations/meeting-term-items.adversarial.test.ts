import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import type { AnsweredNote, AnswerContext } from './proposal-schema.ts';
import { proposalSchemaNamed } from './proposal-schemas.ts';

/**
 * Adversarial pass on PR #553 (#19): term items in one answer are each held
 * to the vault, never to one another, so one answer can claim one heard
 * spelling for two right spellings. Accepted, both claim the variant: a
 * vocabulary conflict, and neither puts the words right.
 */

const fixture = readFileSync(
  new URL('../meetings/fixtures/valid/gemini-platform-sync.md', import.meta.url),
  'utf8',
);
const SYNC: AnsweredNote = {
  path: createVaultPath('Inbox/Meetings/Platform weekly sync.md'),
  text: fixture.replace('start with the cache?', 'start with the Larks Purr cache?'),
  meeting: {
    identity: { provider: 'gemini', externalId: 'gemini-7f3a9c21' },
    date: '2026-09-29',
    attendees: [{ name: 'Mara Quill', email: 'mara.quill@example.com', group: false }],
  },
};
const CONTEXT: AnswerContext = {
  notes: [SYNC],
  vault: {
    selfName: 'Mara Quill',
    selfEmails: [],
    people: [],
    notePaths: [SYNC.path],
    terms: [],
    vocabulary: { entries: [], conflicts: [] },
  },
};
const termItem = (title: string) => ({
  kind: 'term',
  title,
  heard: 'Larks Purr',
  owner: '',
  source_block: 't0001',
  confidence: 'medium',
});

describe('one answer’s term items', () => {
  it('never propose one heard spelling as two different terms', () => {
    const reading = proposalSchemaNamed('meeting-items')!.read(
      JSON.stringify({ items: [termItem('Larkspur'), termItem('Larkspar')] }),
      CONTEXT,
    );
    if (!reading.ok) throw new Error(reading.problem);

    const heard = reading.value.flatMap((proposal) => proposal.payload.properties['variants']);
    expect(heard).toEqual(['Larks Purr']);
  });
});
