import {
  compileVocabularyQuery,
  linkTakeover,
  listedTerms,
  NEW_NOTE_CONTENTS,
  newTermProperties,
  newTermRefusal,
  nextAvailableNotePath,
  isVocabularyNote,
  noteTitle,
  pageTitle,
  resolveWikiLinkTarget,
  splitFrontmatter,
  TERM_TYPE,
  TERMS_FOLDER,
  tidySpelling,
  VARIANTS_KEY,
  TITLE_KEY,
  VAULT_ROOT,
  variantsFromInput,
  vocabulary,
  VOCABULARY_PAGE_SIZE,
  vocabularySourceOf,
  vocabularySourcesOf,
  withVariantsAdded,
  type ListedTerm,
  type ObjectType,
  type TermKind,
  type TermNote,
  type VaultPath,
  type Vocabulary,
  type VocabularyRow,
  type VocabularySource,
} from '@dfai/domain';
import type { OpenNotes } from '../api/ports.ts';
import type { IndexPort } from '../index/ports.ts';
import { FrontmatterRefusedError } from '../notes/frontmatter-refused-error.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { setNoteProperties } from '../query/set-property.ts';
import { findTypeTemplate, readTemplate, type NoteTemplate } from '../types/templates.ts';
import { VaultAccessError, type VaultFsPort } from '../vault/ports.ts';

/** The vault's terms, and the vocabulary they make with its people and companies. */
export interface TermsCatalog {
  /** In the order of their right spellings. */
  readonly terms: readonly TermNote[];
  /** What the Terms page lists: the terms, and the people and companies with misheard spellings. */
  readonly listed: readonly ListedTerm[];
  readonly vocabulary: Vocabulary;
}

/**
 * Every term, and the vocabulary built from the terms, people and companies,
 * read from the index a page at a time — never from the files themselves,
 * however many people the vault holds.
 */
export async function loadTerms({
  index,
}: {
  index: Pick<IndexPort, 'query'>;
}): Promise<TermsCatalog> {
  const sources = vocabularySourcesOf(await readVocabularyRows(index));
  return { terms: sources.terms, listed: listedTerms(sources), vocabulary: vocabulary(sources) };
}

async function readVocabularyRows(index: Pick<IndexPort, 'query'>): Promise<VocabularyRow[]> {
  const rows: VocabularyRow[] = [];
  for (let page = 0; ; page += 1) {
    const { sql, parameters } = compileVocabularyQuery(page);
    const result = await index.query(sql, parameters);
    const cell = (row: readonly unknown[], name: string) => row[result.columns.indexOf(name)];
    const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
    rows.push(
      ...result.rows.map((row) => ({
        path: String(cell(row, 'path')),
        title: String(cell(row, 'title') ?? ''),
        type: String(cell(row, 'type')),
        key: text(cell(row, 'key')),
        value: text(cell(row, 'value')),
      })),
    );
    if (result.rows.length < VOCABULARY_PAGE_SIZE && !result.truncated) return rows;
  }
}

/** A term not added, for a reason the person adding it is told in these words. */
export class TermRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'TermRefusedError';
  }
}

/** Where terms added from the Terms page are filed, made when the vault has no such folder. */
export { TERMS_FOLDER };

/** Where a term's misheard spellings went once added. */
export interface AddedTerm {
  /** A new term's note, or the person's or company's note the name already opens. */
  readonly path: VaultPath;
  readonly into: VocabularySource;
  /** The misheard spellings written there: none when that note already held every one. */
  readonly added: readonly string[];
}

/**
 * Adds a term from the Terms page: a note of type term in `Terms/`, named
 * after its right spelling, from the vault's Term template when it has one.
 * `variants` is what was typed, commas between spellings.
 *
 * A name that already opens a person's or a company's note is that note's to
 * spell (#400): the misheard spellings are added to its `variants`, and no
 * term is made. Otherwise, as with a person made from `@`, adding a term
 * never changes what a `[[link]]` already in the vault opens (A21-02): if the
 * new note would win links written to another, nothing is made and the
 * reason is thrown.
 */
export async function addTerm({
  fs,
  markdown,
  openNotes,
  term,
  types,
  templates,
  notePaths,
  today,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  /** The panes: a person or company open in one is written through it. */
  openNotes: Pick<OpenNotes, 'setPropertiesIfOpen'>;
  term: { readonly canonical: string; readonly variants: string; readonly kind: TermKind | null };
  types: readonly ObjectType[];
  templates: readonly NoteTemplate[];
  notePaths: readonly VaultPath[];
  /** `YYYY-MM-DD`, for the task rules every property write is held to (ADR-0029). */
  today: string;
}): Promise<AddedTerm> {
  const refusal = newTermRefusal(term.canonical);
  if (refusal !== null) throw new TermRefusedError(refusal);

  const spelling = tidySpelling(term.canonical);
  const variants = variantsFromInput(term.variants);
  const named = await namedNoteOpenedBy({ fs, markdown, name: spelling, notePaths });
  if (named !== null) {
    return addToNamedNote({ fs, markdown, openNotes, today, ...named, variants });
  }

  const folder = await termsFolder(fs);
  const path = nextAvailableNotePath({
    folder,
    name: spelling,
    taken: new Set<string>(notePaths),
  });
  const overtaken = linkTakeover(path, notePaths);
  if (overtaken !== null) {
    throw new TermRefusedError(
      `[[${noteTitle(path)}]] already opens ${overtaken}, and would open the new term instead. Rename one of them first.`,
    );
  }

  const { frontmatter, body } = splitFrontmatter(await startingText({ fs, types, templates }));
  const properties = newTermProperties({
    canonical: spelling,
    fileTitle: noteTitle(path),
    startsTitled: TITLE_KEY in markdown.frontmatterProperties(frontmatter),
    variants,
    kind: term.kind,
  });
  await fs.createNote({
    path,
    contents: markdown.updateFrontmatter(frontmatter, properties) + body,
  });
  return { path, into: TERM_TYPE, added: variants };
}

/**
 * The person's or company's note `[[name]]` opens, read from the file; null
 * when it opens no such note, or one the vocabulary does not read — archived,
 * a template, in a hidden folder — whose spellings would correct nothing.
 *
 * Its right spelling is its title, and corrections match case and all, so a
 * name typed in another case is refused rather than corrected to the note's.
 */
async function namedNoteOpenedBy({
  fs,
  markdown,
  name,
  notePaths,
}: {
  fs: VaultFsPort;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'frontmatterProblem'>;
  name: string;
  notePaths: readonly VaultPath[];
}): Promise<{ path: VaultPath; into: 'person' | 'company' } | null> {
  const path = resolveWikiLinkTarget(name, notePaths);
  if (path === null || !isVocabularyNote(path)) return null;
  const { frontmatter } = splitFrontmatter(await readNamedNote(fs, path));
  const properties = readTypeOf(markdown, frontmatter);
  // Whatever its type: a block that cannot be read may well say person or company.
  const problem = markdown.frontmatterProblem(frontmatter);
  if (problem !== null) {
    throw new TermRefusedError(`${path} has properties DFAI can't change safely: ${problem}`);
  }
  const into = vocabularySourceOf(properties['type']);
  if (into !== 'person' && into !== 'company') return null;

  const title = pageTitle({ fileTitle: noteTitle(path), properties });
  const spelt = tidySpelling(title.text);
  if (spelt !== name)
    throw misspeltRefusal({ path, spelt, name, titled: title.source === 'property' });
  if (withVariantsAdded(properties[VARIANTS_KEY], []) === null) throw variantsShapeRefusal(path);
  return { path, into };
}

/**
 * Why a name is not the note's own spelling, and what to do. A note titled
 * other than its file name is reached by the file name, so adding the term
 * as the title would make a second note claiming it: the two are to agree.
 */
function misspeltRefusal({
  path,
  spelt,
  name,
  titled,
}: {
  path: VaultPath;
  spelt: string;
  name: string;
  titled: boolean;
}): TermRefusedError {
  return new TermRefusedError(
    titled
      ? `${path} is titled “${spelt}”, but [[${name}]] opens it by its file name. Rename the note or change its title so the two agree, then add the term again.`
      : `${path} is spelt “${spelt}”. Add the term as “${spelt}”, or rename the note first.`,
  );
}

/** The note's text; a note gone since the vault was listed is a refusal, not a fault. */
async function readNamedNote(fs: VaultFsPort, path: VaultPath): Promise<string> {
  try {
    return (await fs.readTextFile(path)).text;
  } catch (cause) {
    // The host says a missing file this way; the add is simply refused, to be tried again.
    if (cause instanceof VaultAccessError) {
      throw new TermRefusedError(`${path} could not be read (${cause.message}). Try again.`);
    }
    throw cause;
  }
}

/**
 * The properties, read as a write reads them: a key listed twice is its last
 * copy, so a company is still known as one — but a repeated `type` is refused,
 * since which of the two it is would be a guess.
 */
function readTypeOf(
  markdown: Pick<MarkdownPort, 'frontmatterProperties'>,
  frontmatter: string | null,
): Record<string, unknown> {
  try {
    return markdown.frontmatterProperties(frontmatter, {
      forWriting: true,
      refusingDuplicated: ['type', VARIANTS_KEY],
    });
  } catch (cause) {
    if (cause instanceof FrontmatterRefusedError) throw new TermRefusedError(cause.message);
    throw cause;
  }
}

function variantsShapeRefusal(path: VaultPath): TermRefusedError {
  return new TermRefusedError(
    `${path} has a variants that is not a list, so misheard spellings can't be added to it. Make it a list first.`,
  );
}

/**
 * Adds misheard spellings to a person's or company's `variants`, through the
 * pane holding the note when one does, the rest of the note as it was.
 */
async function addToNamedNote({
  fs,
  markdown,
  openNotes,
  today,
  path,
  into,
  variants,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  openNotes: Pick<OpenNotes, 'setPropertiesIfOpen'>;
  today: string;
  path: VaultPath;
  into: 'person' | 'company';
  variants: readonly string[];
}): Promise<AddedTerm> {
  if (variants.length === 0) {
    throw new TermRefusedError(
      `${path} already spells it. Give the misheard spellings to add to it.`,
    );
  }
  // Merged against the note as the write reads it, so an edit since is not lost.
  let added: string[] = [];
  const values = (properties: Readonly<Record<string, unknown>>) => {
    const merged = withVariantsAdded(properties[VARIANTS_KEY], variants);
    // Reshaped since it was read: refused, and nothing written.
    if (merged === null) throw variantsShapeRefusal(path);
    added = merged.added;
    return added.length === 0 ? {} : { [VARIANTS_KEY]: merged.variants };
  };
  const takenByAPane = await openNotes.setPropertiesIfOpen({ path, values });
  if (!takenByAPane) await setNoteProperties({ fs, markdown, path, values, today });
  return { path, into, added };
}

/** The Term template's text, or an empty note when the vault has none. */
async function startingText({
  fs,
  types,
  templates,
}: {
  fs: VaultFsPort;
  types: readonly ObjectType[];
  templates: readonly NoteTemplate[];
}): Promise<string> {
  // The type is built in, but a vault may not define it yet.
  const type = types.find((known) => known.name === TERM_TYPE) ?? {
    name: TERM_TYPE,
    label: 'Term',
  };
  const template = findTypeTemplate(templates, type);
  return template === null ? NEW_NOTE_CONTENTS : readTemplate({ fs, template });
}

/** The vault's terms folder, as it is spelled there — made if there is none. */
async function termsFolder(fs: VaultFsPort): Promise<VaultPath> {
  const top = await fs.listDirectory(VAULT_ROOT);
  const found = top.find((entry) => entry.path.toLowerCase() === TERMS_FOLDER.toLowerCase());
  if (found === undefined) {
    await fs.createFolder({ path: TERMS_FOLDER });
    return TERMS_FOLDER;
  }
  if (found.kind !== 'directory') {
    throw new TermRefusedError(`${found.path} is a file, so terms have nowhere to go`);
  }
  return found.path;
}

/**
 * Changes a term's variants to what was typed, commas between spellings — in
 * its frontmatter only, the rest of the note left as it was. For a term not
 * open in a pane; one that is open is changed through the pane's own save.
 */
export async function setTermVariants({
  fs,
  markdown,
  path,
  variants,
  today,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  path: VaultPath;
  variants: string;
  /** `YYYY-MM-DD`, for the task rules every property write is held to (ADR-0029). */
  today: string;
}): Promise<void> {
  await setNoteProperties({ fs, markdown, path, values: termVariantsChange(variants), today });
}

/** What changing a term's variants to what was typed writes into its frontmatter. */
export function termVariantsChange(variants: string): Readonly<Record<string, unknown>> {
  return { [VARIANTS_KEY]: variantsFromInput(variants) };
}
