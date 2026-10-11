import type { TermNote, VocabularyClaim, VocabularyConflict, VocabularyEntry } from '@atlas/domain';
import { loadTerms } from '../terms/terms.ts';
import type {
  ApiTerm,
  ApiVocabularyClaim,
  ApiVocabularyConflict,
  ApiVocabularyEntry,
} from './contract.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/*
 * The vocabulary through the local API (P28-05), read-only: what the Terms
 * page reads, by the use-case it runs. Terms are notes, so they are written
 * as any note is — `POST /v1/notes` with `type: term`, and their variants
 * with `PATCH /v1/notes/{path}/properties` — and no route here writes.
 */

/** `GET /v1/terms`: every term, every spelling Atlas puts right, and the spellings in conflict. */
export async function termsRoute(request: VaultRequest): Promise<RouteResult> {
  const { terms, vocabulary } = await loadTerms({ index: request.index });
  request.assertStillOpen();
  return {
    status: 200,
    body: {
      terms: terms.map(toApiTerm),
      vocabulary: vocabulary.entries.map(toApiEntry),
      conflicts: vocabulary.conflicts.map(toApiConflict),
    },
  };
}

function toApiTerm({ path, canonical, variants, kind }: TermNote): ApiTerm {
  return { path, canonical, variants, kind };
}

function toApiEntry({ form, canonical, claims }: VocabularyEntry): ApiVocabularyEntry {
  return { form, canonical, claims: claims.map(toApiClaim) };
}

function toApiConflict({ form, claims }: VocabularyConflict): ApiVocabularyConflict {
  return { form, claims: claims.map(toApiClaim) };
}

function toApiClaim({ form, canonical, path, source }: VocabularyClaim): ApiVocabularyClaim {
  return { form, canonical, path, source };
}
