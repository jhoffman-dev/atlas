import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { messageWithoutPaths } from '../../packages/domain/src/index.ts';
import { stageFile } from './staged-file.ts';
import type { PagePlan } from './workspace-plan.ts';

type Create = Extract<PagePlan, { kind: 'create' }>;
type Update = Extract<PagePlan, { kind: 'update' }>;

/** What writing one page's note came to: written, or why not. */
export type Written = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const WRITTEN: Written = { ok: true };

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** The note's text now, or null when it is gone or no longer UTF-8: either way, not what was planned against. */
async function textNow(path: string): Promise<string | null> {
  try {
    return UTF8.decode(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof TypeError)
      return null;
    throw error;
  }
}

/**
 * A new note, written whole under a hidden name and then given its name only
 * if nothing has it: a file that took the name while the run was planning
 * is never written over.
 */
async function create(vault: string, plan: Create): Promise<Written> {
  const path = join(vault, plan.path);
  await mkdir(dirname(path), { recursive: true });
  const staged = await stageFile(dirname(path), plan.content);
  try {
    if (await staged.linkTo(path)) return WRITTEN;
    return { ok: false, reason: `a file took ${plan.path} while the run was planning: run again` };
  } finally {
    await staged.discard();
  }
}

/**
 * A note brought into step, written whole under a hidden name and put in
 * place of the note in one step — only while the note still holds what the
 * plan was made from. A note edited during the run is left as it is now.
 */
async function update(vault: string, plan: Update): Promise<Written> {
  const path = join(vault, plan.path);
  const staged = await stageFile(dirname(path), plan.after);
  try {
    if ((await textNow(path)) !== plan.before) {
      return { ok: false, reason: `${plan.path} changed while the run was planning: run again` };
    }
    await staged.replace(path);
    return WRITTEN;
  } finally {
    await staged.discard();
  }
}

/** Writes one planned note; a write the disk refuses is that note's refusal, and the run goes on. */
export async function writePlanned(vault: string, plan: Create | Update): Promise<Written> {
  try {
    return plan.kind === 'create' ? await create(vault, plan) : await update(vault, plan);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error)) throw error;
    return { ok: false, reason: `cannot write ${plan.path}: ${messageWithoutPaths(error)}` };
  }
}
