import { templateEditRefusal } from '@atlas/domain';

/** A note flow was about to change a template; nothing was touched. */
export class TemplateEditRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateEditRefusedError';
  }
}

/**
 * Throws before a note flow changes a template at any of `paths` — the note
 * it acts on, and where it would land (issue #15).
 */
export function guardTemplateEdit(paths: readonly string[]): void {
  for (const path of paths) {
    const refusal = templateEditRefusal(path);
    if (refusal !== null) throw new TemplateEditRefusedError(refusal);
  }
}
