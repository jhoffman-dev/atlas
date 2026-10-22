import type { ExportedDocs } from './export-google-docs.ts';
import type { FileFormat, SavedExport } from './save-export.ts';

/** What an export that went somewhere did. */
export type ExportOutcome = Extract<SavedExport, { kind: 'saved' }> | ExportedDocs;

const FORMAT_WORDS: Readonly<Record<FileFormat, string>> = {
  markdown: 'Markdown',
  standalone: 'standalone Markdown',
  pdf: 'a PDF',
};

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** What could not come along, said after the rest; "" when everything did. */
function leftOutWords(count: number): string {
  if (count === 0) return '';
  return ` ${plural(count, 'picture')} could not come along: not in the vault, unreadable or too large.`;
}

/** The export in the person's words: what went, and where — for its toast and for Activity. */
export function exportSummary(outcome: ExportOutcome): string {
  if (outcome.kind === 'uploaded') {
    const made = plural(outcome.documents.length, 'Google Doc');
    return `Made ${made} in “${outcome.folder}” in your Drive.${leftOutWords(outcome.picturesLeftOut)}`;
  }
  const what = outcome.notes === 1 ? '1 note' : `${outcome.notes} notes`;
  const as = outcome.format === 'pdf' && outcome.notes > 1 ? 'PDFs' : FORMAT_WORDS[outcome.format];
  const attachments =
    outcome.attachments === 0 ? '' : `, with ${plural(outcome.attachments, 'attachment')}`;
  return `Exported ${what} as ${as} to ${outcome.where}${attachments}.${leftOutWords(outcome.picturesLeftOut)}`;
}
