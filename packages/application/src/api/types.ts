import type { ObjectType } from '@atlas/domain';
import { loadObjectTypes } from '../types/load-types.ts';
import type { ApiType } from './contract.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/** The vault's object types and their properties, as the type editor reads them. */
export async function typesRoute(request: VaultRequest): Promise<RouteResult> {
  const types = await loadObjectTypes({ fs: request.fs, markdown: request.markdown });
  return { status: 200, body: { types: types.map(toApiType) } };
}

function toApiType(type: ObjectType): ApiType {
  return {
    name: type.name,
    label: type.label,
    properties: type.properties.map((property) => ({
      key: property.key,
      kind: property.kind,
      label: property.label,
      required: property.required,
      options: property.options,
      target: property.target,
      many: property.many,
    })),
  };
}
