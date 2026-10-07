/** Tools that read and write single notes: `/v1/notes/...`. */

import { z } from 'zod';
import { defineTool, definedOnly } from './define.ts';
import { ifModified, limit, notePath } from './inputs.ts';

const READ_ONLY = { readOnlyHint: true } as const;

const properties = z
  .record(z.string(), z.unknown())
  .describe('Frontmatter properties by key. Call atlas_list_types to see which keys a type has.');

export const listNotes = defineTool({
  name: 'atlas_list_notes',
  title: 'List notes',
  description:
    'List notes in the Atlas vault, optionally only those in a folder or of a type. Returns ' +
    '{ notes: [{ path, title, type, modified }], next }. When "next" is not null, call again with ' +
    'it as "cursor" for the next page. To find notes by their words, use atlas_search instead; to ' +
    'filter by property values, use atlas_query.',
  inputSchema: z.object({
    folder: z.string().optional().describe('Vault-relative folder, e.g. "Projects".'),
    type: z.string().optional().describe('Only notes with this "type:" in their frontmatter.'),
    limit: limit.optional(),
    cursor: z.string().optional().describe('The "next" value from the previous page.'),
  }),
  annotations: READ_ONLY,
  call: (client, input) => client.listNotes(definedOnly(input)),
});

export const readNote = defineTool({
  name: 'atlas_read_note',
  title: 'Read a note',
  description:
    'Read one note: its frontmatter properties, its markdown body, and "modified". Read a note ' +
    'before changing it, and pass its "modified" back as "ifModified" to any write, so a change ' +
    'made in the meantime is not overwritten.',
  inputSchema: z.object({ path: notePath }),
  annotations: READ_ONLY,
  call: (client, { path }) => client.readNote(path),
});

export const createNote = defineTool({
  name: 'atlas_create_note',
  title: 'Create a note',
  description:
    'Create a new note, optionally from a template (e.g. "Task", "Project" — the names ' +
    'atlas_list_templates gives). "properties" are set on top of the template\'s frontmatter; "body" replaces ' +
    'the template\'s body. Fails with "exists" if a note with that name is already in the folder. ' +
    'Returns the created note, including its path. For a quick task, atlas_capture_task is simpler.',
  inputSchema: z.object({
    folder: z
      .string()
      .optional()
      .describe(
        'Vault-relative folder, which must already exist: Atlas does not create folders, and a missing one fails with "not_found". Omit for the vault root.',
      ),
    name: z
      .string()
      .optional()
      .describe('The note\'s name, without ".md". Omit for "Untitled", numbered if taken.'),
    template: z
      .string()
      .optional()
      .describe('A template name from atlas_list_templates, e.g. "Task".'),
    properties: properties.optional(),
    body: z.string().optional().describe('Markdown for the body.'),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  call: (client, input) => client.createNote(definedOnly(input)),
});

export const updateProperties = defineTool({
  name: 'atlas_update_properties',
  title: "Set a note's properties",
  description:
    'Set or remove frontmatter properties on a note, e.g. { "status": "done" }. Keys not named are ' +
    'left alone; a null value removes the key. Safe on a note open in Atlas: the change goes ' +
    'through its pane. Pass "ifModified" from your last read to refuse the write if the note ' +
    'changed since. Returns the updated note.',
  inputSchema: z.object({
    path: notePath,
    set: z.record(z.string(), z.unknown()).describe('Keys to set. A null value removes that key.'),
    ifModified: ifModified.optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  call: (client, { path, ...body }) => client.setProperties(path, definedOnly(body)),
});

export const appendToNote = defineTool({
  name: 'atlas_append_to_note',
  title: 'Append to a note',
  description:
    "Add markdown to the end of a note's body, after a blank line. Nothing already there is " +
    'changed. Refused with "unsaved_in_app" if the note has unsaved edits open in Atlas. Pass ' +
    '"ifModified" from your last read to refuse the write if the note changed since.',
  inputSchema: z.object({
    path: notePath,
    markdown: z.string().min(1).describe('Markdown to append.'),
    ifModified: ifModified.optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  call: (client, { path, ...body }) => client.append(path, definedOnly(body)),
});

export const replaceNoteBody = defineTool({
  name: 'atlas_replace_note_body',
  title: "Replace a note's body",
  description:
    'Replace everything after the frontmatter with new markdown; properties are kept. "ifModified" ' +
    'is required: call atlas_read_note first and pass its "modified", so edits made since cannot be ' +
    'lost. On "conflict", read the note again and redo the change. Refused with "unsaved_in_app" ' +
    'if the note has unsaved edits open in Atlas. To add to a note, prefer atlas_append_to_note.',
  inputSchema: z.object({
    path: notePath,
    markdown: z.string().describe('The whole new body, as markdown.'),
    ifModified: ifModified,
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  call: (client, { path, ...body }) => client.replaceBody(path, body),
});

export const backlinks = defineTool({
  name: 'atlas_backlinks',
  title: 'Backlinks',
  description:
    'List the notes that link to this one, by [[wiki link]] or relation property. Returns ' +
    '{ backlinks: [{ path, title, type, modified }] }.',
  inputSchema: z.object({ path: notePath }),
  annotations: READ_ONLY,
  call: (client, { path }) => client.backlinks(path),
});

export const noteTools = [
  listNotes,
  readNote,
  createNote,
  updateProperties,
  appendToNote,
  replaceNoteBody,
  backlinks,
];
