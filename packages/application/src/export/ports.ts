import type { ExportPageSize } from '@atlas/domain';

/** Where the person asked an export to go: one file, or a folder of files. */
export type DestinationRequest =
  | {
      readonly kind: 'file';
      /** The name the save dialog offers: "Kickoff.md". */
      readonly suggestedName: string;
      /** Without its dot: "md", "pdf". */
      readonly extension: string;
      /** Given when the file brings attachments: their folder is the file's name and this. */
      readonly companionSuffix: string | null;
    }
  | {
      readonly kind: 'folder';
      /** The folder made inside the one the person picks, numbered if the name is taken. */
      readonly folderName: string;
    };

/** A place the person picked, held by the host until the export is finished. */
export interface ExportDestination {
  readonly id: string;
  /** The file picked, or the folder made: what the toast says the export went to. */
  readonly path: string;
  /** The attachments folder beside a file, when one was asked for. */
  readonly companion: string | null;
}

/**
 * Files outside the vault, where the person said (#501). The webview never
 * names a path: the host asks with its own dialog, and holds what was
 * picked; writes name only a place inside it.
 */
export interface ExportFilesPort {
  /** Asks the person where the export goes; null when they cancel. */
  choose(request: DestinationRequest): Promise<ExportDestination | null>;
  /**
   * Writes one file, whole. `path` is "" for a picked file itself, and
   * otherwise a path inside the destination — or inside its attachments
   * folder, which a file's other paths start with.
   */
  write(args: { destination: ExportDestination; path: string; bytes: Uint8Array }): Promise<void>;
  /**
   * Lets go of the destination. With `discard`, an export that failed first
   * takes back every file and folder it made there — never one that was there before.
   */
  finish(destination: ExportDestination, outcome: { readonly discard: boolean }): Promise<void>;
}

/**
 * A page made a PDF by the system's own WebKit (#501): no browser is
 * bundled. `pagingScript` lays the page out on sheets before it is printed,
 * and sets how many there are.
 */
export interface PdfRendererPort {
  readonly pagingScript: string;
  render(args: { html: string; page: ExportPageSize }): Promise<Uint8Array>;
}

/** A Google Doc made in the person's Drive. */
export interface DriveDocument {
  readonly id: string;
  /** Where the doc opens in a browser. */
  readonly url: string;
}

/**
 * Google Drive, through the host's Google sign-in (ADR-0030): only files
 * this app made are within its reach (`drive.file`). Every call names its
 * vault, as a Calendar call does.
 */
export interface GoogleDrivePort {
  /** The folder of that name this app made, if it made one and it is not in the trash. */
  findFolder(args: { vault: string; name: string }): Promise<string | null>;
  createFolder(args: { vault: string; name: string }): Promise<string>;
  /** Uploads a page as HTML, converted by Google into a Doc of that title, in the folder. */
  uploadDocument(args: {
    vault: string;
    title: string;
    html: string;
    folderId: string;
  }): Promise<DriveDocument>;
}

/** Why an export could not be made, in the person's words. */
export type ExportProblemKind =
  'too-large' | 'google-not-set-up' | 'google-not-granted' | 'unreadable' | 'failed';

export class ExportError extends Error {
  readonly kind: ExportProblemKind;

  constructor(kind: ExportProblemKind, message: string) {
    super(message);
    this.name = 'ExportError';
    this.kind = kind;
  }
}

/**
 * Some of several Google Docs were made before one failed (#502): which, so
 * the person can open them, and what stopped the rest.
 */
export class PartlyExportedError extends ExportError {
  readonly documents: readonly { readonly title: string; readonly url: string }[];
  readonly total: number;
  readonly folder: string;
  override readonly cause: unknown;

  constructor({
    documents,
    total,
    folder,
    cause,
  }: {
    documents: readonly { readonly title: string; readonly url: string }[];
    total: number;
    folder: string;
    cause: unknown;
  }) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      'failed',
      `Made ${documents.length} of ${total} Google Docs in “${folder}” before it stopped: ${reason}`,
    );
    this.name = 'PartlyExportedError';
    this.documents = documents;
    this.total = total;
    this.folder = folder;
    this.cause = cause;
  }
}
