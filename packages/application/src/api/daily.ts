import { captureToInbox } from '../inbox/capture.ts';
import { ensureDailyNote } from '../notes/daily-note.ts';
import { findTaskTemplate, loadTemplates, readTemplate } from '../types/templates.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import { bodyObject, requiredText } from './fields.ts';
import { answerWithNote } from './note-io.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/** Today's note, made from the Daily template if it is not there yet: 201 if it was made. */
export async function dailyRoute(request: VaultRequest): Promise<RouteResult> {
  const { fs } = request;
  const [notePaths, templates] = await Promise.all([listVaultNotes({ fs }), loadTemplates({ fs })]);
  request.assertStillOpen();
  const { path, created } = await ensureDailyNote({
    fs,
    today: request.clock.today(),
    notePaths,
    templates,
  });
  return answerWithNote(request, { path, status: created ? 201 : 200 });
}

/**
 * A task, as quick capture makes one: named by what was typed, from the Task
 * template when there is one, and numbered rather than refused if the name is
 * taken. It waits in the Inbox, as everything captured does (P30-01), and
 * starts with the Inbox status when the vault's Task type has it (P30-02).
 */
export async function captureRoute(request: VaultRequest): Promise<RouteResult> {
  const text = requiredText(bodyObject(request.body), 'text');
  const { fs } = request;
  const [notePaths, templates] = await Promise.all([listVaultNotes({ fs }), loadTemplates({ fs })]);
  const template = findTaskTemplate(templates);
  const contents = template === null ? undefined : await readTemplate({ fs, template });

  request.assertStillOpen();
  const path = await captureToInbox({
    fs,
    markdown: request.markdown,
    today: request.clock.today(),
    name: text,
    notePaths,
    ...(contents === undefined ? {} : { contents }),
  });
  return answerWithNote(request, { path, status: 201 });
}
