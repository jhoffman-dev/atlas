import type { PropertyDef } from '../types/property-def.ts';
import { MEETING_TYPE } from './meeting-header.ts';
import {
  DUPLICATE_OF_KEY,
  IMPORT_ERROR_KEY,
  IMPORT_OUTCOME_KEY,
  IMPORT_OUTCOMES,
} from './meeting-arrival.ts';

const property = (key: string, kind: PropertyDef['kind'], label: string): PropertyDef => ({
  key,
  kind,
  label,
  required: false,
  options: [],
  target: null,
  many: false,
});

/**
 * What the meeting import writes into a file (ADR-0027), as the Meeting type
 * declares it, so a query can name it and the properties panel shows it.
 * The import works without them; a vault's Meeting type is offered them.
 */
export const MEETING_IMPORT_PROPERTIES: readonly PropertyDef[] = [
  { ...property(IMPORT_OUTCOME_KEY, 'select', 'Import'), options: [...IMPORT_OUTCOMES] },
  property(IMPORT_ERROR_KEY, 'text', 'Import error'),
  { ...property(DUPLICATE_OF_KEY, 'relation', 'Duplicate of'), target: MEETING_TYPE },
];
