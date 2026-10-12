/** The meeting's relation to the people who were at it. */
export const MEETING_PEOPLE_KEY = 'people';

/** The meeting's relation to the companies it involved. */
export const MEETING_COMPANIES_KEY = 'companies';

/** The meeting's relation to the project it was about: only ever proposed, never set. */
export const MEETING_PROJECT_KEY = 'project';

/**
 * What linking a meeting declares it may write — and so all an undo of it
 * may put back: links added to these two relations of the meeting, nothing
 * else (P29-04).
 */
export const MEETING_LINK_KEYS = [MEETING_PEOPLE_KEY, MEETING_COMPANIES_KEY] as const;

/** What linking writes as the maker of its proposals. */
export const MEETING_LINKS_MAKER = 'meeting links';
