import type { ProposalNote } from './proposal.ts';

/**
 * A proposal's payload as the Edit form shows it: each thing Accept would
 * write, as text. A link proposal edits only its link; the note and the
 * relation it goes in are what was proposed.
 */
export type PayloadFields =
  | {
      readonly kind: 'note';
      readonly title: string;
      readonly body: string;
      /** Each property as text, in the payload's order. */
      readonly properties: readonly (readonly [key: string, text: string])[];
    }
  | { readonly kind: 'link'; readonly link: string };

/** The payload's fields as the Edit form starts them. */
export function payloadFields(proposal: ProposalNote): PayloadFields {
  if (proposal.kind === 'link') return { kind: 'link', link: proposal.payload.link };
  const { title, body, properties } = proposal.payload;
  return {
    kind: 'note',
    title,
    body,
    properties: Object.entries(properties).map(([key, value]) => [key, propertyText(value)]),
  };
}

/**
 * The payload as edited, ready to be read back through `readProposalPayload`
 * like any other. Each property keeps the shape it had: a list stays a list,
 * split at commas, and a number or a yes/no stays one when the text still
 * reads as one.
 */
export function editedPayload(proposal: ProposalNote, fields: PayloadFields): unknown {
  if (proposal.kind === 'link' || fields.kind === 'link') {
    return { ...proposal.payload, link: fields.kind === 'link' ? fields.link : '' };
  }
  const before = proposal.payload.properties;
  return {
    title: fields.title,
    folder: proposal.payload.folder,
    body: fields.body,
    properties: Object.fromEntries(
      fields.properties.map(([key, shown]) => [key, propertyFromText(shown, before[key])]),
    ),
  };
}

/** A property's value as one line of text. */
export function propertyText(value: unknown): string {
  if (Array.isArray(value)) return value.map(propertyText).join(', ');
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Text read back into the shape `before` had. */
export function propertyFromText(shown: string, before: unknown): unknown {
  const trimmed = shown.trim();
  if (Array.isArray(before)) {
    return trimmed === ''
      ? []
      : trimmed
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
  }
  if (typeof before === 'number' && trimmed !== '' && Number.isFinite(Number(trimmed))) {
    return Number(trimmed);
  }
  if (typeof before === 'boolean' && (trimmed === 'true' || trimmed === 'false')) {
    return trimmed === 'true';
  }
  return shown;
}
