import {
  linkedPdf,
  whereHighlightOpens,
  type LinkedPdfPorts,
  type HighlightPlacePorts,
} from '@dfai/application';
import type { LinkPlaces } from '../workspace/open-place.ts';

/**
 * Where links lead when the files must be read to know (#506): a highlight
 * to its reader, `[[…pdf]]` to its PDF. The link rules are the
 * application's; this hands them the vault.
 */
export function linkPlacesOf(ports: HighlightPlacePorts & LinkedPdfPorts): LinkPlaces {
  return {
    blockOpening: (block) => whereHighlightOpens(ports, block),
    linkedPdf: (target) => linkedPdf(ports, target),
  };
}
