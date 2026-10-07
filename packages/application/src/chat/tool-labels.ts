import type { ToolCall } from '@atlas/domain';

/**
 * A tool call in a few words, as the transcript shows it and the chat note
 * records it: "Searched for “Sam”", "Read Projects/Q3.md".
 */
export function describeToolCall(call: ToolCall): string {
  const text = (key: string) => inputText(call, key);
  const archived = call.input['includeArchived'] === true ? ', archive included' : '';
  switch (call.name) {
    case 'atlas_search':
      return `Searched for “${text('q')}”${archived}`;
    case 'atlas_read_note':
      return `Read ${text('path')}`;
    case 'atlas_list_notes':
      return text('folder') === '' ? 'Listed notes' : `Listed notes in ${text('folder')}`;
    case 'atlas_backlinks':
      return `Found what links to ${text('path')}`;
    case 'atlas_list_types':
      return 'Listed the types';
    case 'atlas_list_views':
      return 'Listed the views';
    case 'atlas_list_type_views':
      return `Listed the views of ${text('type')}`;
    case 'atlas_list_templates':
      return 'Listed the templates';
    case 'atlas_read_template':
      return `Read the ${text('name')} template`;
    case 'atlas_run_view':
      return `Ran ${text('path')}${archived}`;
    case 'atlas_run_query':
      return `Ran the query “${text('query')}”`;
    case 'atlas_calendar':
      return `Read the calendar of ${text('path')}`;
    case 'atlas_tags':
      return 'Listed the tags';
    case 'atlas_tagged_notes':
      return `Found notes tagged #${text('tag').replace(/^#/, '')}`;
    case 'atlas_archived':
      return 'Listed the archive';
    case 'propose_edit':
      return `Proposed an edit to ${text('path')}`;
    case 'propose_note':
      return `Proposed a new note, “${text('title')}”`;
    default:
      return `Tried a tool that does not exist (${call.name})`;
  }
}

/**
 * A tool call that failed, in a few words: a proposal that was refused says
 * no proposal was made, so neither the pane nor the chat note claims one was.
 */
export function describeFailedToolCall(call: ToolCall): string {
  const text = (key: string) => inputText(call, key);
  switch (call.name) {
    case 'propose_edit':
      return `Could not propose an edit to ${text('path')}`;
    case 'propose_note':
      return `Could not propose a new note, “${text('title')}”`;
    default:
      return `Failed: ${describeToolCall(call)}`;
  }
}

function inputText(call: ToolCall, key: string): string {
  const value = call.input[key];
  return typeof value === 'string' ? value : '';
}
