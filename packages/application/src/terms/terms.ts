import {
  compileVocabularyQuery,
  linkTakeover,
  NEW_NOTE_CONTENTS,
  newTermProperties,
  newTermRefusal,
  nextAvailableNotePath,
  noteTitle,
  splitFrontmatter,
  TERM_TYPE,
  tidySpelling,
  VARIANTS_KEY,
  TITLE_KEY,
  VAULT_ROOT,
  createVaultPath,
  variantsFromInput,
  vocabulary,
  VOCABULARY_PAGE_SIZE,
  vocabularySourcesOf,
  type ObjectType,
  type TermKind,
  type TermNote,
  type VaultPath,
  type Vocabulary,
  type VocabularyRow,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { setNoteProperties } from '../query/set-property.ts';
import { findTypeTemplate, readTemplate, type NoteTemplate } from '../types/templates.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** The vault's terms, and the vocabulary they make with its people and companies. */
export interface TermsCatalog {
  /** In the order of their right spellings. */
  readonly terms: readonly TermNote[];
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
  return { terms: sources.terms, vocabulary: vocabulary(sources) };
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
export const TERMS_FOLDER = createVaultPath('Terms');

/**
 * Adds a term from the Terms page: a note of type term in `Terms/`, named
 * after its right spelling, from the vault's Term template when it has one.
 * `variants` is what was typed, commas between spellings.
 *
 * As with a person made from `@`, adding a term never changes what a
 * `[[link]]` already in the vault opens (A21-02): if the new note would win
 * links written to another, nothing is made and the reason is thrown.
 */
export async function addTerm({
  fs,
  markdown,
  term,
  types,
  templates,
  notePaths,
}: {
  fs: VaultFsPort;
  markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'updateFrontmatter'>;
  term: { readonly canonical: string; readonly variants: string; readonly kind: TermKind | null };
  types: readonly ObjectType[];
  templates: readonly NoteTemplate[];
  notePaths: readonly VaultPath[];
}): Promise<VaultPath> {
  const refusal = newTermRefusal(term.canonical);
  if (refusal !== null) throw new TermRefusedError(refusal);

  const spelling = tidySpelling(term.canonical);
  const folder = await termsFolder(fs);
  const path = nextAvailableNotePath({
    folder,
    name: spelling,
    taken: new Set<string>(notePaths),
  });
  const overtaken = linkTakeover(path, notePaths);
  if (overtaken !== null) {
    const title = noteTitle(path);
    throw new TermRefusedError(
      `“${title}” was not added: [[${title}]] already opens ${overtaken}, and would open the new term instead. Rename one of them first.`,
    );
  }

  const { frontmatter, body } = splitFrontmatter(await startingText({ fs, types, templates }));
  const properties = newTermProperties({
    canonical: spelling,
    fileTitle: noteTitle(path),
    startsTitled: TITLE_KEY in markdown.frontmatterProperties(frontmatter),
    variants: variantsFromInput(term.variants),
    kind: term.kind,
  });
  await fs.createNote({
    path,
    contents: markdown.updateFrontmatter(frontmatter, properties) + body,
  });
  return path;
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
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  path: VaultPath;
  variants: string;
}): Promise<void> {
  await setNoteProperties({ fs, markdown, path, values: termVariantsChange(variants) });
}

/** What changing a term's variants to what was typed writes into its frontmatter. */
export function termVariantsChange(variants: string): Readonly<Record<string, unknown>> {
  return { [VARIANTS_KEY]: variantsFromInput(variants) };
}
