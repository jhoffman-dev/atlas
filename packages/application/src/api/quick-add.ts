import { quickAddChoice, quickAddFields, type ObjectType } from '@atlas/domain';
import { quickAddNote } from '../quick-add/quick-add-note.ts';
import { loadQuickAddSetting } from '../quick-add/vault-settings.ts';
import { loadObjectTypes } from '../types/load-types.ts';
import { findTypeTemplate, loadTemplates, readTemplate } from '../types/templates.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import { ApiError } from './api-error.ts';
import type { ApiQuickAddType } from './contract.ts';
import { bodyObject, isRecord, requiredText, type Fields } from './fields.ts';
import { answerWithNote } from './note-io.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/** The types the add button offers, as the vault's settings list them, with what each asks for. */
export async function quickAddTypesRoute(request: VaultRequest): Promise<RouteResult> {
  const [configured, types] = await Promise.all([
    loadQuickAddSetting({ fs: request.fs, markdown: request.markdown }),
    loadObjectTypes({ fs: request.fs, markdown: request.markdown }),
  ]);
  const offered = quickAddChoice({ configured, types }).types;
  return { status: 200, body: { types: offered.map(toQuickAddType) } };
}

/**
 * Adds a note of a type as the add button does: from the type's template when
 * the vault has one, with the fields written into it as their kinds store
 * them, in the folder the button would put it, numbered if the name is taken.
 * Any type the vault defines may be added, as its table's "New" adds one; the
 * button's list only says which it offers.
 */
export async function quickAddRoute(request: VaultRequest): Promise<RouteResult> {
  const fields = bodyObject(request.body);
  const typeName = requiredText(fields, 'type').trim();
  const name = requiredText(fields, 'name').trim();
  const values = valuesOf(fields);

  const { fs, markdown } = request;
  const [types, templates, notePaths] = await Promise.all([
    loadObjectTypes({ fs, markdown }),
    loadTemplates({ fs }),
    listVaultNotes({ fs }),
  ]);
  const type = types.find((candidate) => candidate.name === typeName);
  if (type === undefined)
    throw new ApiError('not_found', `No type called ${JSON.stringify(typeName)}`);
  const template = findTypeTemplate(templates, type);

  const contents = template === null ? null : await readTemplate({ fs, template });
  request.assertStillOpen();
  const path = await quickAddNote({
    fs,
    markdown,
    type,
    name,
    values,
    template: contents,
    beside: null,
    notePaths,
    today: request.clock.today(),
  });
  return answerWithNote(request, { path, status: 201 });
}

function toQuickAddType(type: ObjectType): ApiQuickAddType {
  return {
    name: type.name,
    label: type.label,
    fields: quickAddFields(type).map((field) => field.key),
  };
}

/** The fields as typed: text by property key, as the add button's inputs hold them. */
function valuesOf(fields: Fields): Readonly<Record<string, string>> {
  const values = fields['values'];
  if (values === undefined) return {};
  if (!isRecord(values) || Object.values(values).some((value) => typeof value !== 'string')) {
    throw new ApiError('invalid', 'values must be an object of text by property key');
  }
  return values as Readonly<Record<string, string>>;
}
