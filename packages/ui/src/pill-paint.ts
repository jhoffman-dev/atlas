import { isPillHue, type OptionColor } from '@atlas/domain';

/** The attribute a pill is painted by: `data-hue` for a hue, `data-tone` for a status's tone. */
export type PillPaint = { readonly 'data-hue': string } | { readonly 'data-tone': string };

/**
 * How the stylesheet is told a pill's colour. A tone and a hue are told apart
 * because a tone also carries its dot; no colour at all is the empty pill.
 */
export function pillPaint(color: OptionColor | null): PillPaint {
  if (color === null) return { 'data-tone': 'empty' };
  return isPillHue(color) ? { 'data-hue': color } : { 'data-tone': color };
}
