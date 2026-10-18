// `pnpm design:refs` — renders every mockup in design/target to a PNG, once per
// theme, so each UI v2 slice can be judged against it (see design/README.md).
//
// The mockups use the system font stack and load nothing from the network, so
// the render needs none.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { chromium, webkit } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { boardRenders, loadBoard, renderName } from './boards.ts';
import { renderBoard } from './dc-render.ts';

const OUT = join(import.meta.dirname, '..', '..', 'design', 'out', 'refs');

/** WebKit is the engine the app ships in; Chromium only when WebKit will not start. */
async function launch(): Promise<Browser> {
  try {
    return await webkit.launch();
  } catch (error) {
    console.warn(`WebKit would not start, using Chromium: ${String(error)}`);
    return chromium.launch();
  }
}

async function main(): Promise<void> {
  const { window } = new JSDOM();
  const parser = new window.DOMParser();
  await mkdir(join(OUT, 'html'), { recursive: true });
  const browser = await launch();
  try {
    for (const render of boardRenders(parser)) {
      const { board, theme } = render;
      const name = renderName(render);
      const rendered = renderBoard({
        name: board,
        load: loadBoard,
        parser,
        ...(theme ? { props: { theme } } : {}),
      });
      for (const hole of new Set(rendered.missing)) console.warn(`${name}: empty hole ${hole}`);
      const html = join(OUT, 'html', `${name}.html`);
      await writeFile(html, rendered.html);
      const page = await browser.newPage({ viewport: rendered.size, deviceScaleFactor: 2 });
      await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
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
