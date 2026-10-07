import {
  ARTIFACT_ENTRY,
  ARTIFACT_TEMPLATE,
  ARTIFACTS_FOLDER,
  artifactCopyPlan,
  artifactKind,
  artifactPlacement,
  artifactProperties,
  joinFrontmatter,
  NEW_NOTE_CONTENTS,
  splitFrontmatter,
  VAULT_ROOT,
  type ArtifactFileInput,
  type VaultPath,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import type { Clock } from '../ports.ts';
import { findTemplateNamed, loadTemplates, readTemplate } from '../types/templates.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { ArtifactRefusedError, writeArtifactCopy, type SkippedFile } from './artifact-copy.ts';

/** An artifact on its way into the vault. */
export interface NewArtifact {
  readonly title: string;
  /** Its claude.ai link, or wherever else it lives. */
  readonly url?: string | undefined;
  /** One of `ARTIFACT_KINDS`; guessed from the page, then the link, when not given. */
  readonly kind?: string | undefined;
  /** The project it belongs to, by name. */
  readonly project?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  /** Markdown for the note's body; the template's body when not given. */
  readonly body?: string | undefined;
  /** The files of a saved copy, as picked or sent. None keeps only the link. */
  readonly files?: readonly ArtifactFileInput[] | undefined;
}

export interface SavedArtifact {
  readonly path: VaultPath;
  /** The saved copy's folder, or null when only the link was kept. */
  readonly saved: VaultPath | null;
  /** Files that were picked but cannot be in a copy, and why. */
  readonly skipped: readonly SkippedFile[];
}

/**
 * Saves an artifact: its note in `artifacts/`, and its copy beside it when
 * there are files to copy.
 *
 * The note is written first and the copy after it, so a copy always has a
 * note that owns it: a note the disk refuses leaves no folder behind to take
 * the name the next save would use. Where both go is chosen together
 * (`artifactPlacement`), so a copy never lands in another artifact's folder.
 */
export async function saveArtifact({
  fs,
  markdown,
  clock,
  artifact,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  clock: Clock;
  artifact: NewArtifact;
}): Promise<SavedArtifact> {
  const plan = planOf(artifact.files);
  await ensureArtifactsFolder(fs);
  const siblings = await fs.listDirectory(ARTIFACTS_FOLDER);
  const taken = new Set<string>(siblings.map((entry) => entry.path));
  const { notePath, copyFolder } = artifactPlacement({ title: artifact.title, taken });

  const page = plan === null ? undefined : pageText(plan.files);
  const today = clock.today();
  const copy = plan === null ? null : { saved: copyFolder, savedAt: today };

  const properties = artifactProperties({
    url: artifact.url,
    kind: artifactKind({ asked: artifact.kind, html: page, url: artifact.url }),
    project: artifact.project,
    tags: artifact.tags ?? [],
    copy,
  });
  const start = await templateText(fs);
  await fs.createNote({
    path: notePath,
    contents: composeNote({ markdown, start, properties, body: artifact.body }),
  });
  if (plan !== null) await writeArtifactCopy({ fs, folder: copyFolder, files: plan.files, today });
  return { path: notePath, saved: copy?.saved ?? null, skipped: plan?.skipped ?? [] };
}

function planOf(files: readonly ArtifactFileInput[] | undefined) {
  if (files === undefined || files.length === 0) return null;
  const plan = artifactCopyPlan(files);
  if (plan === null) {
    throw new ArtifactRefusedError(
      'There is no page to open: choose one .html file, or name the page index.html',
    );
  }
  return plan;
}

/** The copy's page, as text, for guessing what the artifact is. */
function pageText(files: readonly ArtifactFileInput[]): string | undefined {
  const page = files.find((file) => file.name === ARTIFACT_ENTRY);
  return page === undefined ? undefined : new TextDecoder().decode(page.bytes);
}

async function ensureArtifactsFolder(fs: VaultFsPort): Promise<void> {
  const top = await fs.listDirectory(VAULT_ROOT);
  const found = top.find((entry) => entry.path.toLowerCase() === ARTIFACTS_FOLDER);
  if (found === undefined) await fs.createFolder({ path: ARTIFACTS_FOLDER });
  else if (found.kind !== 'directory') {
    throw new ArtifactRefusedError(
      `${ARTIFACTS_FOLDER} is a file, so artifacts have nowhere to go`,
    );
  }
}

async function templateText(fs: VaultFsPort): Promise<string> {
  const template = findTemplateNamed(await loadTemplates({ fs }), ARTIFACT_TEMPLATE);
  return template === null ? NEW_NOTE_CONTENTS : readTemplate({ fs, template });
}

function composeNote({
  markdown,
  start,
  properties,
  body,
}: {
  markdown: MarkdownPort;
  start: string;
  properties: Readonly<Record<string, unknown>>;
  body: string | undefined;
}): string {
  const document = splitFrontmatter(start);
  const frontmatter = markdown.updateFrontmatter(document.frontmatter, properties);
  return joinFrontmatter(frontmatter, body ?? document.body);
}
