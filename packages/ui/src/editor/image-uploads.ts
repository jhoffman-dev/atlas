import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/** Where an image came from: a paste names it generically, a dropped or picked file for real. */
export type ImageOrigin = 'clipboard' | 'file';

/** What the note writes to show an image once it is saved. */
export interface SavedImage {
  readonly src: string;
  readonly alt: string;
}

/**
 * Saves an image for the note and resolves to how the note should point at
 * it, or rejects with a message to show where it would have gone.
 */
export type EmbedImage = (file: File, origin: ImageOrigin) => Promise<SavedImage>;

export interface ImageUploadsOptions {
  /** Null when images cannot be added here: pastes and drops of files are left alone. */
  embed: EmbedImage | null;
}

interface Upload {
  readonly id: number;
  readonly name: string;
  /** Null while it is being saved; the reason once it has failed. */
  readonly failure: string | null;
}

type UploadAction =
  | { readonly kind: 'add'; readonly upload: Upload; readonly at: number }
  | { readonly kind: 'fail'; readonly id: number; readonly message: string }
  | { readonly kind: 'remove'; readonly id: number }
  /** The upload's image went in at `at`, taking `size`; its placeholder goes. */
  | { readonly kind: 'placed'; readonly id: number; readonly at: number; readonly size: number };

const uploadsKey = new PluginKey<DecorationSet>('imageUploads');

let nextUploadId = 1;

/**
 * Images coming in: pasted, dropped on the note, or picked. Each shows a
 * placeholder where it will go while it is saved, then the image in its
 * place; one that could not be saved leaves its reason there instead, and
 * nothing in the note.
 *
 * The placeholders are decorations, not nodes, so a save of the note while
 * an image is on its way never writes one into the file.
 */
export const ImageUploads = Extension.create<ImageUploadsOptions>({
  name: 'imageUploads',

  addOptions() {
    return { embed: null };
  },

  addProseMirrorPlugins() {
    const { editor } = this;
    const options = this.options;

    return [
      new Plugin<DecorationSet>({
        key: uploadsKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => applyUploadAction(tr, set.map(tr.mapping, tr.doc)),
        },
        props: {
          decorations: (state) => uploadsKey.getState(state),
          handlePaste: (view, event) => {
            const files = pastedFiles(event.clipboardData);
            const { embed } = options;
            if (embed === null || files.length === 0) return false;
            event.preventDefault();
            addImages(editor, { files, at: view.state.selection.from, origin: 'clipboard', embed });
            return true;
          },
          handleDrop: (view, event, _slice, moved) => {
            const files = [...(event.dataTransfer?.files ?? [])];
            const { embed } = options;
            if (embed === null || moved || files.length === 0) return false;
            event.preventDefault();
            const at =
              view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
              view.state.selection.from;
            addImages(editor, { files, at, origin: 'file', embed });
            return true;
          },
          handleDOMEvents: {
            // Taking the drag over makes the note a drop zone, so the window's
            // guard against stray file drops leaves it be.
            dragover: (_view, event) => {
              if (options.embed === null || event.dataTransfer?.types.includes('Files') !== true) {
                return false;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              return false;
            },
          },
        },
      }),
    ];
  },
});

/**
 * Saves each file and puts it into the note at `at`, in order, a placeholder
 * standing in for each until it has been saved.
 */
export function addImages(
  editor: Editor,
  {
    files,
    at,
    origin,
    embed,
  }: { files: readonly File[]; at: number; origin: ImageOrigin; embed: EmbedImage },
): void {
  for (const file of files) {
    const upload: Upload = { id: nextUploadId++, name: file.name, failure: null };
    dispatchAction(editor.view, { kind: 'add', upload, at });
    embed(file, origin).then(
      (image) => placeImage(editor, { upload, image }),
      (error: unknown) => {
        if (editor.isDestroyed) return;
        const message = error instanceof Error ? error.message : String(error);
        if (uploadPosition(editor.state, upload.id) === null) {
          // The note was re-read from disk meanwhile, taking the placeholder
          // with it: the reason is shown at the end of the note instead.
          tellAtEnd(editor, { ...upload, failure: message });
          return;
        }
        dispatchAction(editor.view, { kind: 'fail', id: upload.id, message });
      },
    );
  }
}

/**
 * Swaps an upload's placeholder for the image, where the placeholder has got
 * to. When the note was re-read from disk while the image was saved, the
 * placeholder went with the old text; the image, already in the vault, goes
 * at the end of the note instead, and a notice says so.
 */
function placeImage(editor: Editor, { upload, image }: { upload: Upload; image: SavedImage }) {
  // The note was closed while the image was saved: the file is in the vault,
  // and there is no note on screen to put it in.
  if (editor.isDestroyed) return;
  const placed = uploadPosition(editor.state, upload.id);
  const at = placed ?? editor.state.doc.content.size;

  const node = editor.schema.nodes['image']?.create({
    src: image.src,
    alt: image.alt === '' ? null : image.alt,
    title: null,
  });
  if (node === undefined) return;

  const $at = editor.state.doc.resolve(at);
  const content = $at.parent.inlineContent
    ? node
    : editor.schema.nodes['paragraph']?.create(null, node);
  if (content === undefined) return;

  const tr = editor.state.tr.insert(at, content);
  tr.setMeta(uploadsKey, {
    kind: 'placed',
    id: upload.id,
    at,
    size: content.nodeSize,
  } satisfies UploadAction);
  editor.view.dispatch(tr);
  if (placed === null) {
    const name = upload.name === '' ? 'The image' : upload.name;
    tellAtEnd(editor, {
      ...upload,
      failure: `${name} was added at the end of the note: the note changed on disk while it was being saved.`,
    });
  }
}

/** Shows `upload`'s message, dismissable, at the end of the note. */
function tellAtEnd(editor: Editor, upload: Upload) {
  dispatchAction(editor.view, { kind: 'add', upload, at: editor.state.doc.content.size });
}

function uploadPosition(state: EditorState, id: number): number | null {
  const found = uploadsKey
    .getState(state)
    ?.find(undefined, undefined, (spec) => (spec as { id?: number }).id === id);
  return found?.[0]?.from ?? null;
}

function dispatchAction(view: EditorView, action: UploadAction) {
  view.dispatch(view.state.tr.setMeta(uploadsKey, action));
}

function applyUploadAction(tr: Transaction, set: DecorationSet): DecorationSet {
  const action = tr.getMeta(uploadsKey) as UploadAction | undefined;
  if (action === undefined) return set;
  if (action.kind === 'add') {
    return set.add(tr.doc, [placeholder({ upload: action.upload, at: action.at })]);
  }
  const current = set.find(undefined, undefined, (spec) => (spec as Upload).id === action.id);
  // Read before `remove`, which empties the array it is handed.
  const at = current[0]?.from;
  const upload = current[0]?.spec as Upload | undefined;
  const without = set.remove(current);
  if (action.kind === 'remove') return without;
  if (action.kind === 'placed') return keepBatchOrder(tr, { set: without, placed: action });
  if (at === undefined || upload === undefined) return without;
  return without.add(tr.doc, [placeholder({ upload: { ...upload, failure: action.message }, at })]);
}

/**
 * Placeholders stay put when something is typed or inserted where they are,
 * so the text typed after a paste follows the placeholder. For images
 * dropped together that would put each one before the last: an image placed
 * where later ones are still waiting has those move on past it, while
 * earlier ones, still waiting, stay in front.
 */
function keepBatchOrder(
  tr: Transaction,
  { set, placed }: { set: DecorationSet; placed: Extract<UploadAction, { kind: 'placed' }> },
): DecorationSet {
  const later = set
    .find(placed.at, placed.at, (spec) => (spec as Upload).id > placed.id)
    .filter((decoration) => decoration.from === placed.at);
  // Made before `remove`, which empties the array it is handed.
  const moved = later.map((decoration) =>
    placeholder({ upload: decoration.spec as Upload, at: placed.at + placed.size }),
  );
  return set.remove(later).add(tr.doc, moved);
}

function placeholder({ upload, at }: { upload: Upload; at: number }): Decoration {
  return Decoration.widget(at, (view) => placeholderElement(view, upload), {
    ...upload,
    key: `image-upload-${upload.id}-${upload.failure === null ? 'saving' : 'failed'}`,
    // Before anything typed or inserted at the same place (see keepBatchOrder).
    side: -1,
    ignoreSelection: true,
  });
}

function placeholderElement(view: EditorView, upload: Upload): HTMLElement {
  const element = document.createElement('span');
  element.contentEditable = 'false';
  element.dataset['imageUpload'] = String(upload.id);
  if (upload.failure === null) {
    element.className = 'image-upload';
    element.setAttribute('role', 'status');
    const spinner = document.createElement('span');
    spinner.className = 'image-upload__spinner';
    spinner.setAttribute('aria-hidden', 'true');
    element.append(spinner, `Adding ${upload.name === '' ? 'image' : upload.name}…`);
    return element;
  }

  element.className = 'image-upload image-upload--failed';
  element.setAttribute('role', 'alert');
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'image-upload__dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.textContent = '×';
  dismiss.addEventListener('click', () => dispatchAction(view, { kind: 'remove', id: upload.id }));
  const message = document.createElement('span');
  message.textContent = upload.failure;
  element.append(message, dismiss);
  return element;
}

/**
 * The files a paste carries, when the paste is files rather than a document.
 *
 * A screenshot or a file copied in Finder arrives as files alone, perhaps with
 * its name as plain text. Copying from a word processor or a web page brings
 * HTML too, often with a picture of the selection beside it — that paste is
 * the HTML, and its picture is left alone.
 */
function pastedFiles(clipboard: DataTransfer | null): File[] {
  if (clipboard === null || clipboard.types.includes('text/html')) return [];
  return [...clipboard.files];
}
