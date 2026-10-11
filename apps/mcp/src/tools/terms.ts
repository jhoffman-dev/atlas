/** The vocabulary: `/v1/terms`. Read-only — a term is a note, written as any note is. */

import { defineTool } from './define.ts';
import { noInput } from './inputs.ts';

export const terms = defineTool({
  name: 'atlas_terms',
  title: 'Terms and spellings',
  description:
    'How names in this vault are spelt: { terms, vocabulary, conflicts }. "terms" are the notes of ' +
    'type term: { path, canonical, variants, kind } — the right spelling, the ways a notetaker ' +
    'mishears it, and product, person, company, acronym or other. "vocabulary" is every spelling ' +
    "Atlas puts right, longest first, { form, canonical, claims }: each term's spelling and " +
    "variants, and each person's and company's name and aliases (a name is its own right " +
    'spelling). Match a form however it is cased or spaced, and write its canonical. "conflicts" ' +
    'are spellings two notes claim for two different right spellings; they are not used until ' +
    'one note lets go, so never correct one. To add a term, call atlas_create_note with ' +
    'properties { type: "term", variants: [...], kind }; to change its variants, ' +
    'atlas_update_properties. Read-only.',
  inputSchema: noInput,
  annotations: { readOnlyHint: true },
  call: (client) => client.terms(),
});

export const termTools = [terms];
