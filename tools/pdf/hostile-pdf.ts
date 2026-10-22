/*
 * Hostile PDFs for the reader's attack tests (PR #515, #504): a page turned
 * a quarter, a password, links to the web, to files and to JavaScript, an
 * action run on open, an embedded file, a page far larger than paper, and a
 * broken table of where each object starts. Written byte by byte like
 * fixture-pdf.ts; every word in them is made up.
 */

const PAGE = '/MediaBox [0 0 612 792]';
const FONT = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

interface HostileSpec {
  /** Extra keys of the one page's dictionary. */
  readonly page?: string;
  /** The page's drawing; one line of text at the top left by default. */
  readonly content?: string;
  /** Extra keys of the catalog. */
  readonly catalog?: string;
  /** Objects after the page's own, numbered from 6. */
  readonly extra?: readonly string[];
  /** Extra keys of the trailer. */
  readonly trailer?: string;
  /** Where the trailer says the table starts: wrong on purpose for a damaged file. */
  readonly startxref?: (real: number) => number;
}

const LINE = 'BT /F1 12 Tf 72 720 Td (The tide bell rang over the grey harbour.) Tj ET';

/**
 * Objects: 1 catalog, 2 pages, 3 font, 4 content, 5 page, then `extra`.
 */
export function hostilePdf(spec: HostileSpec = {}): Buffer {
  const content = spec.content ?? LINE;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${spec.catalog ?? ''} >>`,
    '<< /Type /Pages /Kids [5 0 R] /Count 1 >>',
    FONT,
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    `<< /Type /Page /Parent 2 0 R ${spec.page ?? PAGE} /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>`,
    ...(spec.extra ?? []),
  ];
  let body = '%PDF-1.7\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((object, at) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${at + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${spec.trailer ?? ''} >>\n` +
    `startxref\n${spec.startxref?.(xref) ?? xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** One page turned a quarter (`/Rotate 90`), its one line of text along the paper's width. */
export const rotatedPagePdf = () => hostilePdf({ page: `${PAGE} /Rotate 90` });

/**
 * Locked with a password: the standard handler with an owner and a user
 * key that no empty password opens, as a "password to open" PDF is.
 */
export function passwordPdf(): Buffer {
  const key = (seed: number) =>
    Array.from({ length: 32 }, (_, at) =>
      ((at * 37 + seed) % 256).toString(16).padStart(2, '0'),
    ).join('');
  return hostilePdf({
    extra: [`<< /Filter /Standard /V 1 /R 2 /O <${key(11)}> /U <${key(97)}> /P -44 >>`],
    trailer:
      '/Encrypt 6 0 R /ID [<0123456789abcdef0123456789abcdef> <0123456789abcdef0123456789abcdef>]',
  });
}

/** Links over the line to the web, to a file, to JavaScript and to an app, and JavaScript run when it opens. */
export function linkedPdf(): Buffer {
  const link = (action: string, x: number) =>
    `<< /Type /Annot /Subtype /Link /Rect [${x} 700 ${x + 100} 740] /Border [0 0 0] /A ${action} >>`;
  return hostilePdf({
    page: `${PAGE} /Annots [6 0 R 7 0 R 8 0 R 9 0 R]`,
    catalog:
      '/OpenAction << /S /JavaScript /JS (app.launchURL\\("https://example.com/opened", true\\);) >>',
    extra: [
      link('<< /S /URI /URI (https://example.com/clicked) >>', 72),
      link('<< /S /URI /URI (file:///etc/hosts) >>', 172),
      link('<< /S /JavaScript /JS (app.alert\\("clicked"\\);) >>', 272),
      link('<< /S /Launch /F (/System/Applications/Calculator.app) >>', 372),
    ],
  });
}

/** A file embedded in the PDF, which the reader has no reason to unpack. */
export function embeddedFilePdf(): Buffer {
  const inner = 'echo invented payload';
  return hostilePdf({
    catalog: '/Names << /EmbeddedFiles << /Names [(run.sh) 7 0 R] >> >>',
    extra: [
      `<< /Type /EmbeddedFile /Length ${inner.length} >>\nstream\n${inner}\nendstream`,
      '<< /Type /Filespec /F (run.sh) /EF << /F 6 0 R >> >>',
    ],
  });
}

/** A page as large as a PDF may be: 200 inches square. */
export const hugePagePdf = () => hostilePdf({ page: '/MediaBox [0 0 14400 14400]' });

/** A PDF whose table of where each object starts is somewhere it is not. */
export const brokenXrefPdf = () => hostilePdf({ startxref: (real) => real + 977 });
