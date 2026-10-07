import { splitFrontmatter, type TemplateUse } from '@atlas/domain';
import { loadTemplateCatalog, type TemplateRow } from '../types/manage-templates.ts';
import { loadObjectTypes } from '../types/load-types.ts';
import { findTemplateNamed } from '../types/templates.ts';
import { VaultAccessError } from '../vault/ports.ts';
import { ApiError } from './api-error.ts';
import type { ApiTemplate, ApiTemplateUse } from './contract.ts';
import { decodeSegment } from './paths.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/*
 * The templates, read-only (ADR-0026, ADR-0016 "Templates"). What a template
 * is for is the domain's `templateUses`, read through the same catalogue the
 * Templates page lists; which template a name means is `findTemplateNamed`,
 * the lookup `POST /v1/notes { template }` makes, so reading one by name
 * answers exactly what a note made from it would start as. Nothing here
 * writes: templates live in `.atlas`, which the API never writes.
 */

/** Every template, with what makes notes from each, and the types none serves. */
export async function templatesRoute(request: VaultRequest): Promise<RouteResult> {
  const catalog = await catalogOf(request);
  return {
    status: 200,
    body: {
      templates: catalog.templates.map(toApiTemplate),
      typesWithoutTemplate: catalog.typesWithout.map((type) => type.name),
    },
  };
}

/** One template by name, its frontmatter parsed and its body as written. */
export async function templateRoute(request: VaultRequest): Promise<RouteResult> {
  const name = decodeSegment(request.nameParam, 'name');
  const { templates } = await catalogOf(request);
  const row = findTemplateNamed(templates, name);
  if (row === null) throw new ApiError('not_found', `No template called ${JSON.stringify(name)}`);
  const text = await readTemplateText(request, row);
  const { frontmatter, body } = splitFrontmatter(text);
  return {
    status: 200,
    body: {
      template: {
        ...toApiTemplate(row),
        properties: request.markdown.frontmatterProperties(frontmatter),
        body,
      },
    },
  };
}

async function catalogOf(request: VaultRequest) {
  const { fs, markdown } = request;
  const types = await loadObjectTypes({ fs, markdown });
  const catalog = await loadTemplateCatalog({ fs, types });
  request.assertStillOpen();
  return catalog;
}

/** Reads a listed template; one gone since it was listed is not_found, as a note would be. */
async function readTemplateText(request: VaultRequest, row: TemplateRow): Promise<string> {
  let text: string;
  try {
    ({ text } = await request.fs.readTextFile(row.path));
  } catch (error) {
    request.assertStillOpen();
    if (error instanceof VaultAccessError) {
      throw new ApiError('not_found', `No template called ${JSON.stringify(row.name)}`);
    }
    throw error;
  }
  request.assertStillOpen();
  return text;
}

function toApiTemplate({ name, path, uses }: TemplateRow): ApiTemplate {
  return { name, path, uses: uses.map(toApiUse) };
}

function toApiUse(use: TemplateUse): ApiTemplateUse {
  return use.kind === 'type' ? { kind: 'type', type: use.typeName, label: use.typeLabel } : use;
}
