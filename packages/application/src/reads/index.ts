export { readNoteFacets } from './index-facets.ts';
export { reportingIndexWrites } from './reporting-index-writes.ts';
export {
  ARCHIVE_SCOPE,
  AUTOMATIONS_SCOPE,
  INBOX_CHOICES_SCOPE,
  INBOX_SCOPE,
  MENTIONS_SCOPE,
  notePaneScope,
  PEOPLE_SCOPE,
  PERSON_EMAILS_SCOPE,
  PROJECTS_SCOPE,
  QUERY_SCOPE,
  RULE_QUERY_SCOPE,
  scopeTouched,
  REVIEW_SCOPE,
  SEARCH_SCOPE,
  SECRETS_SCOPE,
  SYNC_SCOPE,
  TAGS_SCOPE,
  TERMS_SCOPE,
  typeTableScope,
  UNKNOWN_NEWS,
} from './scoped-reads.ts';
export type { IndexNews, PaneNote, ReadScope } from './scoped-reads.ts';
export {
  READS_ON_INDEX_NEWS,
  readsTouchedByNoteChanges,
  readsTouchedByPaths,
  VAULT_READS,
} from './vault-reads.ts';
export type { VaultRead } from './vault-reads.ts';
