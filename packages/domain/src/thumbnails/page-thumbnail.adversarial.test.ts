/**
 * Attacks on the thumbnail property's rules (U-15).
 *
 * Each test states something `page-thumbnail.ts` already claims — "empty or
 * `auto` means Atlas pictures the page", "a cleared one falls back to the
 * note's cover or first image", "pictured once it rests" — and feeds it a
 * value the vault can really hold. A failure is a bug in the rules.
 */

import { describe, expect, it } from 'vitest';
import { needsThumbnail } from '../artifacts/artifact-thumbnail.ts';
import type { EditorDocument } from '../markdown/editor-node.ts';
import { notePropertyKind } from '../page/new-property.ts';
import type { PropertyDef } from '../types/property-def.ts';
import { validatePropertyValue } from '../types/property-value.ts';
import {
  cardFront,
  noteThumbnailKey,
  PAGE_THUMBNAIL_QUIET_MS,
  pageThumbnailWait,
  THUMBNAIL_KEY,
} from './page-thumbnail.ts';

const WITH_IMAGE: EditorDocument = {
  type: 'doc',
  content: [{ type: 'image', attrs: { src: 'attachments/sand.png' } }],
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** The longest delay a timer honours; past it, `setTimeout` fires at once. */
const TIMER_MAX_MS = 2 ** 31 - 1;

describe('pageThumbnailWait', () => {
  it('never waits longer than the quiet period for a note dated in the future', () => {
    // A note synced from a machine whose clock runs ahead, or unpacked from an
    // archive, can be dated after now. It has not been typed in for a month.
    const now = 1_790_000_000_000;
    const wait = pageThumbnailWait({
      noteModified: now + 30 * DAY_MS,
      picturedAt: now - DAY_MS,
      now,
    });
    expect(wait).not.toBeNull();
    expect(wait).toBeLessThanOrEqual(PAGE_THUMBNAIL_QUIET_MS);
  });

  it('never asks for a wait a timer cannot hold', () => {
    // Past 2^31-1 ms `setTimeout` fires immediately, and the refresh hook
    // re-arms it on every tick: a render loop, not a wait.
    const now = 1_790_000_000_000;
    const wait = pageThumbnailWait({
      noteModified: now + 30 * DAY_MS,
      picturedAt: now - DAY_MS,
      now,
    });
    expect(wait ?? 0).toBeLessThanOrEqual(TIMER_MAX_MS);
  });
});

describe('cardFront', () => {
  it('a thumbnail kept under `cover` and cleared as the text "false" falls back to the first image', () => {
    // "Cover" is the natural label for a thumbnail property, and its key is
    // then `cover` — the very key `noteCover` falls back to. A value written
    // as text (the API's JSON, a hand edit `cover: "false"`) reads as cleared.
    const front = cardFront({
      properties: { cover: 'false' },
      doc: WITH_IMAGE,
      thumbnailKey: 'cover',
    });
    expect(front).toEqual({ kind: 'image', src: 'attachments/sand.png' });
  });
});

describe('a thumbnail left empty means auto', () => {
  const required: PropertyDef = {
    key: 'art',
    kind: 'thumbnail',
    label: 'Art',
    required: true,
    options: [],
    target: null,
    many: false,
  };

  it('a required thumbnail left empty is valid: Atlas pictures the page', () => {
    expect(validatePropertyValue({ def: required, value: undefined })).toBeNull();
  });

  it('a note’s own `thumbnail:` left empty is shown as the thumbnail it is treated as', () => {
    // `thumbnail:` with nothing after it reads as null. The note's card and
    // pane treat the key as its thumbnail (auto); its row must say so too,
    // not offer a text box.
    const properties = { thumbnail: null };
    expect(noteThumbnailKey({ type: null, properties })).toBe(THUMBNAIL_KEY);
    expect(notePropertyKind(properties.thumbnail, THUMBNAIL_KEY)).toBe('thumbnail');
  });
});

describe("the artifact type's cover, now declared a thumbnail", () => {
  it('an artifact whose cover is `auto` is pictured, as the thumbnail kind says auto means', () => {
    // `validatePropertyValue` tells an API or MCP writer that a thumbnail is
    // "auto, a picture in the vault, or false"; the artifact type's `cover`
    // is `kind: thumbnail`, so `cover: auto` is a value it invites.
    const artifact = { type: 'artifact', saved: 'artifacts/dune', cover: 'auto' };
    expect(needsThumbnail(artifact)).toBe(true);
  });
});
