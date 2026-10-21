import type { ExportPageSize } from '@atlas/domain';

/**
 * The script a page is laid out on sheets with before WebKit prints it
 * (#501). WebKit's `createPDF` pictures one rectangle of the page at a time,
 * so the host prints sheet after sheet of it, one page tall each; this moves
 * whatever would be cut by a sheet's edge — a line of text, a list item, a
 * table's row, a picture — down to the next sheet, below its top margin,
 * and says how many sheets there are in `<html data-pages>`.
 *
 * A row moves by splitting its table there, so a table that runs on keeps
 * its header on the next sheet. A heading too close to a sheet's foot goes
 * with what follows it. Anything taller than a sheet is left to be cut.
 *
 * It runs inside the page, so it is plain script, not a module. Layout, not
 * a rule of the note: what the page holds was decided before it was drawn.
 */
export function pagingScript({ height, margin }: ExportPageSize): string {
  return `(() => {
  const H = ${height}, M = ${margin};
  const UNITS = 'h1,h2,h3,h4,h5,h6,p,li,tr,pre,img,hr';
  const root = document.documentElement;
  document.body.style.margin = '0';
  document.body.style.paddingTop = M + 'px';
  document.body.style.paddingBottom = M + 'px';
  const isUnit = (el) =>
    el.closest('tr') === el || (el.closest('tr') === null && el.querySelector(UNITS) === null);
  const topOf = (el) => el.getBoundingClientRect().top + window.scrollY;
  const nudge = (el, by) => {
    const now = parseFloat(el.style.marginTop || '0') || 0;
    el.style.marginTop = now + by + 'px';
  };
  const targetOf = (el) => {
    const rect = el.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    const page = Math.floor(top / H);
    const offset = top - page * H;
    const foot = page * H + H - M;
    const next = (page + 1) * H + M;
    if (offset < M && top >= M) return page * H + M;
    if (offset > H - M) return next;
    const keepWithNext = /^H[1-6]$/.test(el.tagName) && top + rect.height + 36 > foot;
    if (rect.height <= H - 2 * M && (top + rect.height > foot || keepWithNext)) return next;
    return null;
  };
  const splitTable = (row) => {
    const table = row.closest('table');
    const section = row.parentElement;
    const rest = table.cloneNode(false);
    const head = table.querySelector('thead');
    if (head !== null && section !== head) rest.appendChild(head.cloneNode(true));
    const body = section.cloneNode(false);
    let moving = row;
    while (moving !== null) {
      const after = moving.nextElementSibling;
      body.appendChild(moving);
      moving = after;
    }
    rest.appendChild(body);
    table.after(rest);
    return rest;
  };
  const place = (el, target) => {
    for (let tries = 0; tries < 3; tries += 1) {
      const short = target - topOf(el);
      if (short <= 0.5) return;
      nudge(el, short);
    }
  };
  const units = [...document.querySelectorAll(UNITS)].filter(isUnit);
  for (const unit of units) {
    const target = targetOf(unit);
    if (target === null) continue;
    // A row moves with the rest of its table — all of it, from its first row; else split
    // there — and what moves starts at the next sheet's top margin, a repeated header first.
    const row = unit.tagName === 'TR';
    const first = row && unit.previousElementSibling === null;
    const moved = !row ? unit : first ? unit.closest('table') : splitTable(unit);
    place(moved, target);
  }
  const pages = Math.max(1, Math.ceil(document.body.scrollHeight / H));
  document.body.style.minHeight = pages * H + 'px';
  document.body.style.boxSizing = 'border-box';
  root.setAttribute('data-pages', String(pages));
})();`;
}
