import { formatWikiLink, linkBreakingCharacter } from '../../packages/domain/src/index.ts';
import { notionIdIn } from './notion-relations.ts';

/** A markdown link, not an image: `[text](target)`, the target with no spaces, as Notion writes them. */
const LINK = /(!?)\[([^\]\n]*)\]\(([^)\s]+)\)/g;

/** A target that is another page of the export: its `.md` file, or its notion.so address. */
const isPageTarget = (target: string) =>
  /\.md(?:#.*)?$/i.test(target) || /^https?:\/\/(?:www\.)?notion\.so\//i.test(target);

/** The name a wiki link shows for a target: the note's name, without its folders. */
const nameOf = (target: string) => target.slice(target.lastIndexOf('/') + 1);

/**
 * The page's body with each link to another page of the export written as a
 * wiki link to that page's note, so it opens in Atlas rather than pointing
 * at a file that is not there. A link to a page this run does not know, an
 * image, and any other link are left exactly as written.
 */
export function withWikiLinks(body: string, linkFor: (id: string) => string | null): string {
  return body.replace(LINK, (whole, bang: string, text: string, target: string) => {
    const id = bang === '' && isPageTarget(target) ? notionIdIn(target) : null;
    const to = id === null ? null : linkFor(id);
    if (to === null) return whole;
    const shown = text.trim();
    const alias =
      shown === '' || shown === nameOf(to) || linkBreakingCharacter(shown) !== null ? null : shown;
    return formatWikiLink({ target: to, heading: null, alias });
  });
}
