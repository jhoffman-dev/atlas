// `pnpm design:refs` — renders every mockup in design/target to a PNG, once per
// theme, so each Phase 16 slice can be judged against it (see design/README.md).
//
// Fonts come from Google Fonts, as the mockups link them, so this needs the
// network; without it the render falls back to system-ui and says so.
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { chromium, webkit } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { renderBoard, themesOf } from './dc-render.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const TARGET = join(ROOT, 'design', 'target');
const OUT = join(ROOT, 'design', 'out', 'refs');
const SUFFIX = '.dc.html';

interface Job {
  board: string;
  theme: string | null;
}

async function jobs(parser: DOMParser): Promise<Job[]> {
  const boards = (await readdir(TARGET)).filter((file) => file.endsWith(SUFFIX)).sort();
  return boards.flatMap((file): Job[] => {
    const board = file.slice(0, -SUFFIX.length);
    const themes = themesOf(readFileSync(join(TARGET, file), 'utf8'), parser);
    return themes.length ? themes.map((theme) => ({ board, theme })) : [{ board, theme: null }];
  });
}

/** WebKit is the engine the app ships in; Chromium only when WebKit will not start. */
async function launch(): Promise<Browser> {
  try {
    return await webkit.launch();
  } catch (error) {
    console.warn(`WebKit would not start, using Chromium: ${String(error)}`);
    return chromium.launch();
  }
}

async function shoot(browser: Browser, html: string, size: { width: number; height: number }) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(html).href, { waitUntil: 'networkidle' });
  const fontLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check("700 16px 'Manrope'");
  });
  return { page, fontLoaded };
}

async function main(): Promise<void> {
  const { window } = new JSDOM();
  const parser = new window.DOMParser();
  const load = (name: string) => readFileSync(join(TARGET, `${name}${SUFFIX}`), 'utf8');
  await mkdir(join(OUT, 'html'), { recursive: true });
  const browser = await launch();
  try {
    for (const { board, theme } of await jobs(parser)) {
      const name = theme ? `${board}-${theme}` : board;
      const rendered = renderBoard({
        name: board,
        load,
        parser,
        ...(theme ? { props: { theme } } : {}),
      });
      for (const hole of new Set(rendered.missing)) console.warn(`${name}: empty hole ${hole}`);
      const html = join(OUT, 'html', `${name}.html`);
      await writeFile(html, rendered.html);
      const { page, fontLoaded } = await shoot(browser, html, rendered.size);
      if (!fontLoaded) console.warn(`${name}: Manrope did not load — rendered in a fallback font`);
      const png = join(OUT, `${name}.png`);
      await page.screenshot({ path: png, animations: 'disabled' });
      await page.close();
      console.log(png);
    }
  } finally {
    await browser.close();
  }
}

await main();
