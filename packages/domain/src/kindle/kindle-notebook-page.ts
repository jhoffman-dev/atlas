import { findAll, findFirst, parseHtmlDocument, withClass, withId, withTag } from './html-tree.ts';
import type { HtmlElement } from './html-tree.ts';
import type { KindlePageProblem, KindleRawPage } from './kindle-types.ts';

/**
 * What every notebook page is checked for before it is read: that Amazon
 * answered at all, and that it answered with the notebook rather than with
 * its sign-in page. The markers are the ones open-source notebook readers
 * key on; they are checked against fixtures made by hand, which must be
 * checked against a real page (#508).
 */

/** Amazon's sign-in, two-step and "verify it's you" pages live under `/ap/`. */
const SIGN_IN_PATH = /^\/ap\//;
/** A robot check: the person answers it in the Connect Kindle window; syncing on only makes it worse. */
const CAPTCHA_PATH = /\/errors\/validatecaptcha/i;

const UNAUTHORIZED = 401;

/** The page read into a tree, or why it cannot be read at all. */
export type CheckedPage = { readonly kind: 'page'; readonly tree: HtmlElement } | KindlePageProblem;

function parsed(address: string): URL | null {
  try {
    return new URL(address);
  } catch {
    // Not an absolute URL: there is nothing to judge by, which the caller says.
    return null;
  }
}

/** Another store's notebook host: `read.amazon.co.uk`, `read.amazon.de`, `read.amazon.com.au`. */
const OTHER_STORE_NOTEBOOK = /^read\.amazon\.(?:com?\.[a-z]{2}|[a-z]{2,3})$/;
const THIS_STORE_NOTEBOOK = 'read.amazon.com';

function redirectProblem(redirectedTo: string): KindlePageProblem {
  const url = parsed(redirectedTo);
  const host = url?.hostname.toLowerCase() ?? '';
  if (host !== THIS_STORE_NOTEBOOK && OTHER_STORE_NOTEBOOK.test(host)) {
    return { kind: 'unsupported_store', store: host };
  }
  const path = url?.pathname ?? null;
  if (path !== null && CAPTCHA_PATH.test(path)) return { kind: 'robot_check' };
  if (path !== null && SIGN_IN_PATH.test(path)) return { kind: 'sign_in_required' };
  return { kind: 'unrecognised', reason: 'Amazon sent the notebook somewhere else' };
}

function isCaptchaForm(element: HtmlElement): boolean {
  return element.tag === 'form' && CAPTCHA_PATH.test(element.attributes.get('action') ?? '');
}

function isSignInForm(element: HtmlElement): boolean {
  if (element.tag !== 'form') return false;
  if (element.attributes.get('name') === 'signIn') return true;
  return /\/ap\/signin/i.test(element.attributes.get('action') ?? '');
}

/** Whether the page asks the person to sign in. */
export function asksToSignIn(tree: HtmlElement): boolean {
  return (
    findFirst(tree, isSignInForm) !== null ||
    findFirst(tree, (element) => withId('ap_email')(element) || withId('ap_password')(element)) !==
      null
  );
}

/** Whether the page asks the person to prove they are one: Amazon's robot check. */
export function asksForRobotCheck(tree: HtmlElement): boolean {
  return findFirst(tree, isCaptchaForm) !== null;
}

const TOO_DEEP: KindlePageProblem = {
  kind: 'unrecognised',
  reason: 'the page nests deeper than a notebook page does',
};

/** Checks `page` is an answer that can be read, and reads it into a tree. */
export function checkKindlePage(page: KindleRawPage): CheckedPage {
  if (page.redirectedTo !== null) return redirectProblem(page.redirectedTo);
  if (page.status === UNAUTHORIZED) return { kind: 'sign_in_required' };
  if (page.status < 200 || page.status > 299) {
    return page.status >= 400
      ? { kind: 'unavailable', status: page.status }
      : { kind: 'unrecognised', reason: `Amazon answered ${page.status} with nowhere to go` };
  }
  const { tree, tooDeep } = parseHtmlDocument(page.html);
  // What is past the depth limit sits flat in the tree: a reader asking for it
  // would find it missing and call the book empty, so the page is refused.
  if (tooDeep) return TOO_DEEP;
  if (asksForRobotCheck(tree)) return { kind: 'robot_check' };
  if (asksToSignIn(tree)) return { kind: 'sign_in_required' };
  return { kind: 'page', tree };
}

/** The `value` of the first hidden input matching `matches`; null when there is none. */
export function inputValue(
  tree: HtmlElement,
  matches: (element: HtmlElement) => boolean,
): string | null {
  const input = findFirst(tree, (element) => withTag('input')(element) && matches(element));
  return input === null ? null : (input.attributes.get('value') ?? '').trim();
}

/** Every element with all of `classes`, under `tree`. */
export function allWithClass(tree: HtmlElement, ...classes: string[]): HtmlElement[] {
  return findAll(tree, withClass(...classes));
}
