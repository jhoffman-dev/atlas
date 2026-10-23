/**
 * The names of the chat's read tools (P27-03): the read routes of the local
 * API a model may call. The application holds what each one asks; the names
 * are here because a rule's file names the ones its Claude step may use
 * (P29-03), and reading a rule is the domain's.
 */
export const CHAT_READ_TOOLS = [
  'atlas_search',
  'atlas_read_note',
  'atlas_list_notes',
  'atlas_backlinks',
  'atlas_list_types',
  'atlas_list_views',
  'atlas_list_type_views',
  'atlas_list_templates',
  'atlas_read_template',
  'atlas_run_view',
  'atlas_run_query',
  'atlas_calendar',
  'atlas_tags',
  'atlas_tagged_notes',
  'atlas_archived',
  'atlas_brief',
  'atlas_open_loops',
  'atlas_meeting_quotes',
] as const;

export type ChatReadTool = (typeof CHAT_READ_TOOLS)[number];

export function isChatReadTool(name: string): name is ChatReadTool {
  return (CHAT_READ_TOOLS as readonly string[]).includes(name);
}
