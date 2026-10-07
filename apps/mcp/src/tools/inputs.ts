/** Input fields several tools share, described once so every tool words them the same. */

import { z } from 'zod';

export const notePath = z
  .string()
  .min(1)
  .describe(
    'Vault-relative path of the note, forward slashes, including ".md" — e.g. "Tasks/Call Sam.md". ' +
      'Use a path exactly as another tool returned it.',
  );

export const ifModified = z
  .number()
  .describe(
    'The note\'s "modified" value from your last read. The write is refused with "conflict" if the ' +
      'note changed since, so you never overwrite edits you have not seen. Read the note again and retry.',
  );

export const limit = z.number().int().positive().describe('At most this many results.');

export const includeArchived = z
  .boolean()
  .describe(
    'Include archived notes (those under Archive/). Default false: the Archive is out of the way ' +
      'unless asked for, as it is in the app.',
  );

/** For tools that take no input. */
export const noInput = z.object({});
