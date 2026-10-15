export { attendeeKey, emailDomain, matchAttendees, matchSpeakers } from './attendee-matching.ts';
export type {
  AmbiguousAttendee,
  AttendeeMatching,
  DirectoryCompany,
  DirectoryPerson,
  GuessedCompany,
  LinkedAttendee,
  MatchedBy,
  MatchedCompany,
  UnknownAttendee,
} from './attendee-matching.ts';
export {
  MEETING_COMPANIES_KEY,
  MEETING_LINK_KEYS,
  MEETING_LINKS_MAKER,
  MEETING_PEOPLE_KEY,
  MEETING_PROJECT_KEY,
} from './meeting-link-keys.ts';
export {
  attendeesOf,
  linkedEntities,
  namedSpeakers,
  planMeetingLinks,
} from './meeting-link-plan.ts';
export type { MeetingLinkInput, MeetingLinkPlan, PassedOverAttendee } from './meeting-link-plan.ts';
export {
  compileLinkDirectoryQuery,
  compileProjectTiesQuery,
  LINK_DIRECTORY_PAGE_SIZE,
  linkDirectoryOf,
} from './meeting-link-queries.ts';
export type { LinkDirectory, LinkDirectoryRow } from './meeting-link-queries.ts';
export { meetingLinkReport } from './meeting-link-report.ts';
export type { MeetingLinkHappening } from './meeting-link-report.ts';
export { projectConfidence, rankProjects } from './project-ranking.ts';
export type { ProjectTie, RankedProject } from './project-ranking.ts';
export {
  isOwnerAttendee,
  isOwnerNote,
  ownerAddresses,
  ownerAddressesInUse,
  ownerNotAGroup,
  sameName,
} from './vault-owner.ts';
