/**
 * Expands a "Design Component" mockup (`design/target/*.dc.html`) into static
 * HTML, so it can be screenshotted without the design tool's runtime.
 *
 * The format, as far as the mockups use it:
 * - `<x-dc>` holds the markup; its `<helmet>` (fonts, styles) belongs in `<head>`.
 * - `{{dotted.path}}` holes in text and attributes. An attribute that is one
 *   whole hole takes the raw value, so `false`/`null` drop the attribute.
 * - `<sc-for list="{{items}}" as="item">` repeats its children, with `$index`.
 * - `<sc-if value="{{cond}}">` keeps its children when the value is truthy.
 * - `<dc-import name="Sidebar" theme="{{theme}}">` mounts `Sidebar.dc.html`
 *   with those attributes as props (kebab-case → camelCase, `hint-*` dropped).
 * - `<script type="text/x-dc" data-props='…'>` defines
 *   `class Component extends DCLogic { renderVals() {…} }`, reading
 *   `this.props`; each prop's `default` comes from `data-props`.
 *
 * DOM-only — the caller supplies the parser (jsdom in Node, the real one in a
 * browser), so this file has no I/O of its own.
 */

type Scope = Record<string, unknown>;

/** Reads a component's source by name, e.g. `Sidebar` → `Sidebar.dc.html`. */
export type LoadComponent = (name: string) => string;

export interface RenderRequest {
  name: string;
  props?: Scope;
  load: LoadComponent;
  parser: DOMParser;
}

export interface RenderedBoard {
  html: string;
  /** The board's own preview size, from `data-props.$preview`. */
  size: { width: number; height: number };
  /** Every hole that resolved to nothing, as `Component: path` — a mockup typo or a missing prop. */
  missing: string[];
}

interface Component {
  body: Element;
  helmet: Element | null;
  title: string;
  defaults: Scope;
  preview: { width: number; height: number };
  script: string;
}

interface Context {
  load: LoadComponent;
  parser: DOMParser;
  out: Document;
  helmets: Map<string, Element>;
  missing: string[];
  /** Components being rendered, outermost first, to refuse an import cycle. */
  stack: string[];
}

/** Where a hole is being filled: the values in reach, and the render it belongs to. */
interface Frame {
  scope: Scope;
  context: Context;
  /** The component whose markup this is, for naming a missing hole. */
  owner: string;
}

const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
const WHOLE_HOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;
const DEFAULT_PREVIEW = { width: 1440, height: 900 };

export function renderBoard(request: RenderRequest): RenderedBoard {
  const { name, props = {}, load, parser } = request;
  const out = parser.parseFromString(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body></body></html>',
    'text/html',
  );
  const context: Context = { load, parser, out, helmets: new Map(), missing: [], stack: [] };
  const component = parseComponent(name, context);
  out.title = component.title;
  out.body.append(mount(component, name, props, context));
  for (const helmet of context.helmets.values()) out.head.append(...helmet.childNodes);
  return {
    html: `<!doctype html>\n${out.documentElement.outerHTML}`,
    size: component.preview,
    missing: context.missing,
  };
}

/** The values a board's `theme` prop may take, or none when it has no theme prop. */
export function themesOf(source: string, parser: DOMParser): string[] {
  const options = declaredProps(parser.parseFromString(source, 'text/html'))['theme']?.options;
  return Array.isArray(options) ? options.map(String) : [];
}

type DeclaredProps = Record<
  string,
  { default?: unknown; options?: unknown; width?: number; height?: number }
>;

function declaredProps(source: Document): DeclaredProps {
  const script = source.querySelector('script[data-dc-script]');
  return JSON.parse(script?.getAttribute('data-props') ?? '{}') as DeclaredProps;
}

function parseComponent(name: string, context: Context): Component {
  const source = context.parser.parseFromString(context.load(name), 'text/html');
  const body = source.querySelector('x-dc');
  if (!body) throw new Error(`${name}: no <x-dc> element`);
  const declared = declaredProps(source);
  const defaults: Scope = {};
  for (const [key, spec] of Object.entries(declared)) {
    if (!key.startsWith('$') && spec.default !== undefined) defaults[key] = spec.default;
  }
  const preview = declared['$preview'];
  return {
    body,
    helmet: body.querySelector(':scope > helmet'),
    title: source.title,
    defaults,
    preview:
      preview?.width && preview.height
        ? { width: preview.width, height: preview.height }
        : DEFAULT_PREVIEW,
    script: source.querySelector('script[data-dc-script]')?.textContent ?? '',
  };
}

/** The component's markup, expanded against its props and `renderVals()`, as nodes of the output document. */
function mount(
  component: Component,
  name: string,
  props: Scope,
  context: Context,
): DocumentFragment {
  if (context.stack.includes(name)) {
    throw new Error(`import cycle: ${[...context.stack, name].join(' → ')}`);
  }
  if (component.helmet) context.helmets.set(name, context.out.importNode(component.helmet, true));
  const withDefaults = { ...component.defaults, ...props };
  const scope = { ...withDefaults, ...renderVals(component.script, withDefaults) };

  const fragment = context.out.createDocumentFragment();
  for (const child of component.body.childNodes) {
    if (child !== component.helmet) fragment.append(context.out.importNode(child, true));
  }
  context.stack.push(name);
  expandChildren(fragment, { scope, context, owner: name });
  context.stack.pop();
  return fragment;
}

/** Runs the mockup's own logic class. The mockups are ours, checked into the repo. */
function renderVals(script: string, props: Scope): Scope {
  if (!script.trim()) return {};
  class DCLogic {
    props: Scope;
    constructor(given: Scope) {
      this.props = given;
    }
  }
  const define = new Function('DCLogic', `${script}\nreturn Component;`) as (
    base: typeof DCLogic,
  ) => new (given: Scope) => { renderVals?: () => Scope };
  const instance = new (define(DCLogic))(props);
  return instance.renderVals?.() ?? {};
}

function expandChildren(parent: ParentNode, frame: Frame): void {
  for (const child of [...parent.childNodes]) expandNode(child, frame);
}

function expandNode(node: ChildNode, frame: Frame): void {
  if (node.nodeType === node.TEXT_NODE) {
    node.textContent = interpolate(node.textContent ?? '', frame);
    return;
  }
  if (node.nodeType !== node.ELEMENT_NODE) return;
  const element = node as Element;
  switch (element.localName) {
    case 'sc-for':
      element.replaceWith(repeat(element, frame));
      return;
    case 'sc-if':
      element.replaceWith(keepIf(element, frame));
      return;
    case 'dc-import':
      element.replaceWith(importComponent(element, frame));
      return;
    default:
      fillAttributes(element, frame);
      expandChildren(element, frame);
  }
}

function repeat(element: Element, frame: Frame): DocumentFragment {
  const list = attributeValue(element, 'list', frame);
  const as = element.getAttribute('as') ?? 'item';
  const fragment = frame.context.out.createDocumentFragment();
  if (!Array.isArray(list)) return fragment;
  list.forEach((item: unknown, index) => {
    const copy = cloneChildren(element, frame.context.out);
    expandChildren(copy, { ...frame, scope: { ...frame.scope, [as]: item, $index: index } });
    fragment.append(copy);
  });
  return fragment;
}

function keepIf(element: Element, frame: Frame): DocumentFragment {
  // An absent flag is the ordinary way to say false, so it is not reported as missing.
  const quiet = { ...frame, context: { ...frame.context, missing: [] } };
  if (!attributeValue(element, 'value', quiet)) {
    return frame.context.out.createDocumentFragment();
  }
  const copy = cloneChildren(element, frame.context.out);
  expandChildren(copy, frame);
  return copy;
}

function importComponent(element: Element, frame: Frame): DocumentFragment {
  const name = element.getAttribute('name');
  if (!name) throw new Error(`${frame.owner}: <dc-import> without a name`);
  const props: Scope = {};
  for (const { name: attribute } of [...element.attributes]) {
    if (attribute === 'name' || attribute.startsWith('hint-')) continue;
    props[camelCase(attribute)] = attributeValue(element, attribute, frame);
  }
  return mount(parseComponent(name, frame.context), name, props, frame.context);
}

function fillAttributes(element: Element, frame: Frame): void {
  for (const { name, value } of [...element.attributes]) {
    if (!value.includes('{{')) continue;
    const filled = attributeValue(element, name, frame);
    if (filled === false || filled === null || filled === undefined) element.removeAttribute(name);
    else element.setAttribute(name, String(filled));
  }
}

/** An attribute that is one whole hole is the raw value; anything else is text. */
function attributeValue(element: Element, attribute: string, frame: Frame): unknown {
  const value = element.getAttribute(attribute) ?? '';
  const whole = WHOLE_HOLE.exec(value);
  if (whole?.[1]) return lookup(whole[1], frame);
  return interpolate(value, frame);
}

function interpolate(text: string, frame: Frame): string {
  return text.replace(HOLE, (_hole, path: string) => {
    const value = lookup(path, frame);
    return value === undefined || value === null ? '' : String(value);
  });
}

function lookup(path: string, frame: Frame): unknown {
  let value: unknown = frame.scope;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object' || !(key in value)) {
      frame.context.missing.push(`${frame.owner}: ${path}`);
      return undefined;
    }
    value = (value as Scope)[key];
  }
  return value;
}

function cloneChildren(element: Element, out: Document): DocumentFragment {
  const fragment = out.createDocumentFragment();
  for (const child of element.childNodes) fragment.append(child.cloneNode(true));
  return fragment;
}

function camelCase(attribute: string): string {
  return attribute.replace(/-([a-z])/g, (_dash, letter: string) => letter.toUpperCase());
}
