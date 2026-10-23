import { HighlightCommentChangedError } from '@dfai/domain';

/*
 * What a person has typed into highlights' comment fields and not yet had
 * written (#534). The fields are drawn by the editor, which draws them again
 * whenever the note is read again, a sync or an edit in Obsidian included; the
 * words live here, per note, so a field drawn again picks them up where the
 * last one left off. Nothing here knows how a comment is written: the pane's
 * `write` does, and may refuse it.
 */

/** Writes highlight `id`'s comment over the one the field started from; rejects with why not. */
export type WriteComment = (edit: {
  readonly id: string;
  readonly comment: string;
  readonly base: string;
}) => Promise<void>;

/** One field's words, and where they stand. */
export interface CommentDraft {
  /** What the field holds. */
  text: string;
  /** The comment the field started from: the one on disk when `text` was last in step with it. */
  base: string;
  /** The comment now on disk when the write found it changed meanwhile; null otherwise. */
  conflict: string | null;
  /** Why the last write failed, when it did for any other reason. */
  problem: string | null;
  /** The write in flight, if any. */
  saving: Promise<void> | null;
}

/** A draft whose words were not written, with why: for telling the person. */
export interface LostDraft extends KeptComment {
  readonly why: string;
}

/** A comment typed and not written, with the comment it was typed over: to keep, or to put back. */
export interface KeptComment {
  readonly id: string;
  readonly comment: string;
  readonly base: string;
}

export class HighlightDrafts {
  private readonly drafts = new Map<string, CommentDraft>();
  /** Each field's redraw, told when its draft changes from outside it: a write the pane began. */
  private readonly watchers = new Map<string, Set<() => void>>();
  /** The field the person was in, to put them back in it when it is drawn again. */
  focus: { id: string; start: number; end: number } | null = null;

  /** Calls `changed` whenever draft `id`'s write begins or settles; answers how to stop. */
  watch(id: string, changed: () => void): () => void {
    const watching = this.watchers.get(id) ?? new Set();
    this.watchers.set(id, watching);
    watching.add(changed);
    return () => {
      watching.delete(changed);
      if (watching.size === 0) this.watchers.delete(id);
    };
  }

  private told(id: string): void {
    for (const changed of this.watchers.get(id) ?? []) changed();
  }

  /** The person is in field `id`, with this part of its words selected. */
  rememberFocus(id: string, start: number, end: number): void {
    this.focus = { id, start, end };
  }

  /** The person left field `id`. */
  forgetFocus(id: string): void {
    if (this.focus?.id === id) this.focus = null;
  }

  /**
   * Puts back comments kept from the last time the note closed, each over the
   * comment it was typed over, so writing one still checks the note has not
   * moved on. A field the person has typed in since keeps their words.
   */
  restore(kept: readonly KeptComment[]): void {
    for (const { id, comment, base } of kept) {
      const draft = this.drafts.get(id);
      if (draft !== undefined && (draft.text !== draft.base || draft.saving !== null)) continue;
      this.drafts.set(id, { text: comment, base, conflict: null, problem: null, saving: null });
      this.told(id);
    }
  }

  /** Highlight `id`'s draft, begun from `comment` when the field has none yet. */
  of(id: string, comment: string): CommentDraft {
    let draft = this.drafts.get(id);
    if (draft === undefined) {
      draft = { text: comment, base: comment, conflict: null, problem: null, saving: null };
      this.drafts.set(id, draft);
    }
    return draft;
  }

  /**
   * The note was read again with `comment` on disk. A field the person has not
   * typed in follows it; one they have keeps their words, which are written
   * only over the comment they started from; a conflict they are being told
   * of names the comment on disk now, so "Keep theirs" takes that one. Whether
   * the field must be drawn again.
   */
  follow(id: string, comment: string): boolean {
    const draft = this.drafts.get(id);
    if (draft === undefined || draft.saving !== null) return false;
    if (draft.text !== draft.base && draft.text !== comment) {
      if (draft.conflict === null) return false;
      // Back to the comment the words started from: nothing to choose between any more.
      const now = comment === draft.base ? null : comment;
      const changed = draft.conflict !== now;
      draft.conflict = now;
      return changed;
    }
    const changed = draft.text !== comment || draft.base !== comment || draft.conflict !== null;
    draft.text = comment;
    draft.base = comment;
    draft.conflict = null;
    draft.problem = null;
    return changed;
  }

  /** The person typed `text` in the field. */
  type(id: string, text: string): void {
    const draft = this.drafts.get(id);
    if (draft === undefined) return;
    draft.text = text;
    draft.problem = null;
  }

  /** Puts the field back as the note has it: Escape. */
  revert(id: string, comment: string): void {
    const draft = this.drafts.get(id);
    if (draft === undefined) return;
    Object.assign(draft, { text: comment, base: comment, conflict: null, problem: null });
  }

  /** "Use mine": the words stay, and are written over the comment now in the note. */
  useMine(id: string): boolean {
    const draft = this.drafts.get(id);
    if (draft?.conflict === undefined || draft.conflict === null) return false;
    draft.base = draft.conflict;
    draft.conflict = null;
    return true;
  }

  /** "Keep theirs": the field takes the comment now in the note. */
  keepTheirs(id: string): void {
    const draft = this.drafts.get(id);
    if (draft?.conflict === undefined || draft.conflict === null) return;
    Object.assign(draft, { text: draft.conflict, base: draft.conflict, conflict: null });
  }

  /** Lets go of a draft that holds nothing the person typed. */
  release(id: string): void {
    const draft = this.drafts.get(id);
    if (draft !== undefined && draft.text === draft.base && draft.saving === null) {
      this.drafts.delete(id);
    }
  }

  /**
   * Writes the draft if it holds words not yet written. A write already in
   * flight is waited for first: the field stays open to typing meanwhile, and
   * words typed during it are written after it, over the comment it put down.
   * Settles when it is over; what came of it is in the draft (`conflict`,
   * `problem`), not thrown.
   */
  async write(id: string, write: WriteComment): Promise<void> {
    let draft = this.drafts.get(id);
    let waited = false;
    while (draft?.saving !== undefined && draft.saving !== null) {
      waited = true;
      await draft.saving;
      draft = this.drafts.get(id);
    }
    if (draft === undefined) return;
    if (draft.text === draft.base || draft.conflict !== null) return;
    // The write just waited for failed: trying the same disk again at once would only fail again.
    if (waited && draft.problem !== null) return;
    const comment = draft.text;
    draft.problem = null;
    draft.saving = write({ id, comment, base: draft.base })
      .then(() => {
        draft.base = comment;
      })
      .catch((error: unknown) => {
        if (error instanceof HighlightCommentChangedError) draft.conflict = error.current;
        else draft.problem = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        draft.saving = null;
        this.told(id);
      });
    this.told(id);
    return draft.saving;
  }

  /**
   * Every pane's work is being written — another vault is opening, the window
   * is closing — while the person may still be in a field: writes each draft
   * holding words not yet written, over the comment it started from, and keeps
   * every draft and the field's words. What came of each is in its draft.
   */
  async writeUnwritten(write: WriteComment): Promise<void> {
    await Promise.all(this.unwritten().map((id) => this.write(id, write)));
  }

  /**
   * The note is closing, or another is taking its place: writes every draft
   * that holds words not yet written, and answers the ones that could not be.
   * Each is the person's, so none is dropped without being said.
   */
  async flush(write: WriteComment): Promise<LostDraft[]> {
    const pending = [...this.drafts.keys()];
    await Promise.all(pending.map((id) => this.write(id, write)));
    const lost: LostDraft[] = [];
    for (const id of pending) {
      const draft = this.drafts.get(id);
      if (draft === undefined || draft.text === draft.base) continue;
      lost.push({ id, comment: draft.text, base: draft.base, why: whyNotWritten(draft) });
    }
    this.drafts.clear();
    this.focus = null;
    return lost;
  }

  /** The drafts holding words not yet written. */
  unwritten(): readonly string[] {
    return [...this.drafts.entries()]
      .filter(([, draft]) => draft.text !== draft.base)
      .map(([id]) => id);
  }
}

function whyNotWritten(draft: CommentDraft): string {
  if (draft.conflict !== null) {
    return 'The comment changed in the note meanwhile, so it was not written over.';
  }
  return draft.problem ?? 'It was not written.';
}
