import type { NavigationPlace } from '../panes/navigation-history.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { isPdfName } from './pdf-library.ts';

/** Where opening a file from Pages or search goes: a PDF to the reader, anything else to its note. */
export function placeOfFile(path: VaultPath): NavigationPlace {
  return isPdfName(path) ? { kind: 'document', path } : { kind: 'note', path };
}
