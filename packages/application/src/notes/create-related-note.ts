import {
  cleanEntryName,
  unlinkableNameReason,
  wikiLinkTargetFor,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import { quickAddNote } from '../quick-add/quick-add-note.ts';
import { findTypeTemplate, loadTemplates, readTemplate } from '../types/templates.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import type { MarkdownPort } from './ports.ts';

/** A note made from a relation's picker, and what the relation writes to link it. */
export interface RelatedNote {
  readonly path: VaultPath;
  /** The link's target, inside `[[…]]`, worked out from the note as made. */
  readonly target: string;
}

/** A note not made, for a reason the person is told in these words. */
export class RelatedNoteRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelatedNoteRefusedError';
  }
}

/**
 * "New company…" in a relation's picker: a new note of the type the relation
 * points at, made as the add button makes one — from the type's template when
 * the vault has one, which is read and never touched, at the usual place for
 * a new note, named as typed and numbered when the name is taken.
 *
 * A name no link could reach — one holding `#`, `^`, `[`, `]` or `|` — is
 * refused before anything is made, by the rule `newPersonRefusal` applies to
 * a new person, since the relation would otherwise write a link that misses.
 *
 * Before this, the picker offered the template itself (it declares the type),
 * and the person renamed and filled in the template thinking it new (issue #15).
 */
export async function createRelatedNote({
  fs,
  markdown,
  type,
  name,
  beside,
  notePaths,
  today,
}: {
  fs: VaultFsPort;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'updateFrontmatter'>;
  /** `YYYY-MM-DD`, from the injected clock: the task rules date by it. */
  today: string;
  type: ObjectType;
  name: string;
  /** The note whose relation is being set. */
  beside: VaultPath | null;
  notePaths: readonly VaultPath[];
}): Promise<RelatedNote> {
  const cleaned = cleanEntryName(name);
  if (cleaned === '') throw new RelatedNoteRefusedError(`Give the new ${type.label} a name.`);
  const unlinkable = unlinkableNameReason(cleaned);
  if (unlinkable !== null) throw new RelatedNoteRefusedError(unlinkable);
  const template = findTypeTemplate(await loadTemplates({ fs }), type);
  const path = await quickAddNote({
    fs,
    markdown,
    type,
    name: cleaned,
    values: {},
    template: template === null ? null : await readTemplate({ fs, template }),
    beside,
    notePaths,
    today,
  });
  return { path, target: wikiLinkTargetFor(path, [...notePaths, path]) };
}
