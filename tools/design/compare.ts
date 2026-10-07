// `pnpm design:compare` — one page per surface, mockup on the left and the app
// on the right at the same scale, in both themes. Reads what `design:refs` and
// `shots` wrote; a missing image is shown as missing rather than failing.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const OUT = join(import.meta.dirname, '..', '..', 'design', 'out');
const PAGES = join(OUT, 'compare');
const THEMES = ['light', 'dark'] as const;
/** Screenshots are taken at 2x; pages show them at this fraction of their CSS size. */
const SCALE = 0.5;

/** Each app surface, and the mockup board it is judged against (null: no mockup yet). */
const SURFACES: { surface: string; board: string | null }[] = [
  { surface: 'dashboard', board: 'Main' },
  { surface: 'board', board: 'Board' },
  { surface: 'all-tasks', board: 'Table' },
  { surface: 'note', board: 'Note' },
  { surface: 'sidebar', board: 'Sidebar' },
  { surface: 'empty', board: null },
  { surface: 'calendar', board: null },
  { surface: 'search', board: null },
  { surface: 'settings', board: null },
];

/** A PNG's width in CSS pixels, from its header, or null when there is no such file. */
async function cssWidth(path: string): Promise<number | null> {
  try {
    const header = await readFile(path);
    return header.readUInt32BE(16) / 2;
  } catch {
    // No file yet: that side of the pair is shown as missing.
    return null;
  }
}

async function figure(label: string, path: string | null): Promise<string> {
  const width = path ? await cssWidth(path) : null;
  const body =
    path && width
      ? `<a href="${relative(PAGES, path)}"><img src="${relative(PAGES, path)}" width="${width * SCALE}" alt="${label}"></a>`
      : `<p class="missing">${path ? `missing: ${relative(OUT, path)}` : 'no mockup for this surface'}</p>`;
  return `<figure><figcaption>${label}</figcaption>${body}</figure>`;
}

async function surfacePage(surface: string, board: string | null): Promise<string> {
  const rows = await Promise.all(
    THEMES.map(async (theme) => {
      const mockup = board ? join(OUT, 'refs', `${board}-${theme}.png`) : null;
      const shot = join(OUT, 'shots', `${surface}-${theme}.png`);
      const pair = [
        await figure(`mockup · ${board ?? '—'} · ${theme}`, mockup),
        await figure(`app · ${surface} · ${theme}`, shot),
      ];
      return `<h2>${theme}</h2><div class="pair">${pair.join('')}</div>`;
    }),
  );
  return layout(
    surface,
    `<p><a href="index.html">All surfaces</a></p><h1>${surface}</h1>${rows.join('')}`,
  );
}

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} — design compare</title>
<style>
body{margin:24px;font:14px system-ui,sans-serif;background:#f4f4f6;color:#1b1d26}
.pair{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}
figure{margin:0}figcaption{font-weight:600;margin-bottom:6px}
img{display:block;border:1px solid #ccd;height:auto}
.missing{width:360px;padding:40px 16px;border:1px dashed #99a;color:#667}
</style></head><body>${body}</body></html>`;
}

async function main(): Promise<void> {
  await mkdir(PAGES, { recursive: true });
  for (const { surface, board } of SURFACES) {
    await writeFile(join(PAGES, `${surface}.html`), await surfacePage(surface, board));
  }
  const links = SURFACES.map(
    ({ surface, board }) =>
      `<li><a href="${surface}.html">${surface}</a> — ${board ?? 'no mockup'}</li>`,
  );
  const index = join(PAGES, 'index.html');
  await writeFile(index, layout('Surfaces', `<h1>Mockup vs app</h1><ul>${links.join('')}</ul>`));
  console.log(index);
}

await main();
