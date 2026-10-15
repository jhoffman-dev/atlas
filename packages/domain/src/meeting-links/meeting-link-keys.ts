/** The meeting's relation to the people who were at it. */
export const MEETING_PEOPLE_KEY = 'people';

/** The meeting's relation to the companies it involved. */
export const MEETING_COMPANIES_KEY = 'companies';

/**
 * The meeting's relation to the project it was about: proposed, or set when
 * its twin or series surely says it and it holds nothing yet (#227).
 */
export const MEETING_PROJECT_KEY = 'project';

/** The meeting's relations to whom it involved: what its likely project is ranked by (P29-04). */
export const MEETING_LINK_KEYS = [MEETING_PEOPLE_KEY, MEETING_COMPANIES_KEY] as const;

/**
 * What linking a meeting declares it may write — and so all an undo of it
 * may put back: links added to its people and companies, and the project it
 * is filed under (#227), nothing else.
 */
export const MEETING_LINK_WRITTEN_KEYS = [...MEETING_LINK_KEYS, MEETING_PROJECT_KEY] as const;

/** What linking writes as the maker of its proposals. */
export const MEETING_LINKS_MAKER = 'meeting links';
