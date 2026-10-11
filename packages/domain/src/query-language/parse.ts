/**
 * Reading a query's text into an {@link AtlasQuery} (ADR-0019).
 *
 * Recursive descent over the tokens, one function per rule of the grammar. A
 * word is a keyword only where the grammar expects one, so a property called
 * `group` or `limit` can still be named. Every problem is a
 * {@link QueryTextError} pointing at the token that caused it.
 */

import type {
  AtlasQuery,
  Comparison,
  Expression,
  FieldRef,
  Name,
  QueryValue,
  SortKey,
  Span,
} from './ast.ts';
import { MAX_GROUP_LEVELS } from './ast.ts';
import { MAX_QUERY_LIMIT } from '../query/view-query.ts';
import { QueryTextError } from './query-text-error.ts';
import { tokenize, type Token } from './tokens.ts';

const SYMBOL_COMPARISONS: ReadonlyMap<string, Comparison> = new Map([
  ['=', '='],
  ['!=', '!='],
  ['<>', '!='],
  ['<', '<'],
  ['<=', '<='],
  ['>', '>'],
  ['>=', '>='],
]);

const CLAUSES = 'WHERE, SORT BY, GROUP BY, SHOW, INCLUDE ARCHIVED or LIMIT';

type ClauseName = 'WHERE' | 'SORT' | 'GROUP' | 'SHOW' | 'INCLUDE' | 'LIMIT';
const CLAUSE_NAMES: readonly ClauseName[] = ['WHERE', 'SORT', 'GROUP', 'SHOW', 'INCLUDE', 'LIMIT'];

/** The query the text says, or a {@link QueryTextError} saying where it goes wrong. */
export function parseAtlasQuery(text: string): AtlasQuery {
  return new Parser(tokenize(text)).query();
}

type Draft = { -readonly [Key in keyof AtlasQuery]: AtlasQuery[Key] };

/**
 * How deep brackets and NOTs may nest. Far past anything a person writes, and
 * far short of the stack: a query pasted from somewhere hostile is a problem
 * in its text, not a crash.
 */
const MAX_DEPTH = 64;

class Parser {
  private at = 0;
  private depth = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  query(): AtlasQuery {
    if (this.peek().kind === 'end') {
      throw new QueryTextError('Write a query: FROM task.', this.peek().span);
    }
    this.keyword('FROM', 'A query starts with FROM and the types to list: FROM task.');
    const draft: Draft = {
      from: this.list(() => this.name('Name a type after FROM.')),
      where: null,
      sort: [],
      group: [],
      show: [],
      includeArchived: false,
      limit: null,
    };
    const seen = new Set<ClauseName>();
    while (this.peek().kind !== 'end') this.clause(draft, seen);
    return draft;
  }

  private clause(draft: Draft, seen: Set<ClauseName>): void {
    const token = this.peek();
    const name = CLAUSE_NAMES.find((clause) => isWord(token, clause));
    if (name === undefined) throw new QueryTextError(`Expected ${CLAUSES} here.`, token.span);
    if (seen.has(name)) {
      throw new QueryTextError(`${clauseLabel(name)} is already given.`, token.span);
    }
    seen.add(name);
    this.next();
    CLAUSE_READERS[name](this, draft);
  }

  where(): Expression {
    return this.or();
  }

  sort(): SortKey[] {
    this.keyword('BY', 'SORT is followed by BY: SORT BY due.');
    return this.list(() => {
      const field = this.field('Name a field to sort by.');
      if (this.accept('DESC')) return { field, direction: 'desc' };
      this.accept('ASC');
      return { field, direction: 'asc' };
    });
  }

  group(): FieldRef[] {
    this.keyword('BY', 'GROUP is followed by BY: GROUP BY status.');
    const levels = [this.field('Name a field to group by.')];
    while (isWord(this.peek(), 'THEN')) {
      const then = this.next();
      if (levels.length >= MAX_GROUP_LEVELS) {
        throw new QueryTextError('A query groups twice at most: GROUP BY a THEN b.', then.span);
      }
      levels.push(this.field('Name a field to group by after THEN.'));
    }
    return levels;
  }

  show(): FieldRef[] {
    return this.list(() => this.field('Name a field to show.'));
  }

  includeArchived(): void {
    this.keyword('ARCHIVED', 'INCLUDE is followed by ARCHIVED.');
  }

  limit(): number {
    const token = this.next();
    const value = Number(token.text);
    if (token.kind !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new QueryTextError('LIMIT takes a whole number of rows: LIMIT 50.', token.span);
    }
    if (value > MAX_QUERY_LIMIT) {
      throw new QueryTextError(`LIMIT is at most ${MAX_QUERY_LIMIT} rows.`, token.span);
    }
    return value;
  }

  private or(): Expression {
    return this.joined('or', () => this.and());
  }

  private and(): Expression {
    return this.joined('and', () => this.unary());
  }

  private joined(kind: 'and' | 'or', operand: () => Expression): Expression {
    const operands = [operand()];
    while (this.accept(kind.toUpperCase())) operands.push(operand());
    if (operands.length === 1) return operands[0] as Expression;
    return { kind, operands, span: spanOf(operands[0], operands.at(-1)) };
  }

  private unary(): Expression {
    const token = this.peek();
    if (this.depth >= MAX_DEPTH) {
      throw new QueryTextError('This query nests too deeply to read.', token.span);
    }
    this.depth += 1;
    try {
      return this.unaryWithin(token);
    } finally {
      this.depth -= 1;
    }
  }

  private unaryWithin(token: Token): Expression {
    // `not = x` compares a property called `not`; `NOT x = 1` negates a condition.
    if (isWord(token, 'NOT') && !this.fieldNamedNot()) return this.negation(token);
    if (isSymbol(token, '(')) {
      this.next();
      const inner = this.or();
      if (!isSymbol(this.peek(), ')')) {
        throw new QueryTextError('This ( is never closed.', token.span);
      }
      this.next();
      return inner;
    }
    return this.condition();
  }

  /**
   * `NOT x = 1`, or — when NOT is followed by a word that is also an operator
   * (`not IS EMPTY`, `not CONTAINS x`) and cannot be read as a negation — a
   * condition on a property called `not`. A negation that reads wins.
   */
  private negation(token: Token): Expression {
    const start = this.at;
    const depth = this.depth;
    try {
      this.next();
      const operand = this.unary();
      return { kind: 'not', operand, span: { start: token.span.start, end: operand.span.end } };
    } catch (problem) {
      const after = this.tokens[start + 1];
      const operatorWord = ['IS', 'CONTAINS', 'STARTS'].some(
        (word) => after && isWord(after, word),
      );
      if (!(problem instanceof QueryTextError) || !operatorWord) throw problem;
      this.at = start;
      this.depth = depth;
      try {
        return this.condition();
      } catch {
        // The negation's problem is the one to show: it is how the text was first read.
        throw problem;
      }
    }
  }

  private fieldNamedNot(): boolean {
    const after = this.tokens[this.at + 1];
    return after?.kind === 'symbol' && after.text !== '(';
  }

  private condition(): Expression {
    if (this.atLinksTo()) return this.linksTo();
    const field = this.field('Expected a field to compare, like status.');
    const token = this.peek();
    if (isWord(token, 'IS')) return this.emptiness(field);
    const op = this.comparison();
    const value = this.value(opText(op));
    return { kind: 'compare', field, op, value, span: spanOf(field, value) };
  }

  /** `LINKS TO …`; `links = x` still compares a property called `links`. */
  private atLinksTo(): boolean {
    const after = this.tokens[this.at + 1];
    return isWord(this.peek(), 'LINKS') && after !== undefined && isWord(after, 'TO');
  }

  private linksTo(): Expression {
    const start = this.next().span.start;
    this.next();
    const value = this.value('LINKS TO');
    return { kind: 'linksTo', value, span: { start, end: value.span.end } };
  }

  private emptiness(field: FieldRef): Expression {
    this.next();
    const negated = this.accept('NOT');
    const empty = this.keyword('EMPTY', 'IS is followed by EMPTY or NOT EMPTY.');
    return { kind: 'empty', field, negated, span: { start: field.span.start, end: empty.end } };
  }

  private comparison(): Comparison {
    const token = this.peek();
    const symbol = token.kind === 'symbol' ? SYMBOL_COMPARISONS.get(token.text) : undefined;
    if (symbol !== undefined) {
      this.next();
      return symbol;
    }
    if (this.accept('CONTAINS')) return 'contains';
    if (this.accept('STARTS')) {
      this.keyword('WITH', 'STARTS is followed by WITH.');
      return 'startsWith';
    }
    throw new QueryTextError(
      'Expected =, !=, <, <=, >, >=, CONTAINS, STARTS WITH or IS EMPTY here.',
      token.span,
    );
  }

  /** The value after `written`, the operator or words before it. */
  private value(written: string): QueryValue {
    const token = this.next();
    const span = token.span;
    switch (token.kind) {
      case 'number':
        return { kind: 'number', number: Number(token.text), text: token.text, span };
      case 'string':
        return { kind: 'text', text: token.text, span };
      case 'link':
        return { kind: 'link', target: token.text, span };
      case 'tag':
        return { kind: 'tag', name: token.text, span };
      case 'date':
        return { kind: 'relativeDate', name: token.text, span };
      case 'word':
        if (isWord(token, 'TRUE') || isWord(token, 'FALSE')) {
          return { kind: 'boolean', value: isWord(token, 'TRUE'), span };
        }
        if (isWord(token, 'THIS')) return { kind: 'this', span };
        return { kind: 'text', text: token.text, span };
      default:
        throw new QueryTextError(`Expected a value after ${written}.`, span);
    }
  }

  private field(problem: string): FieldRef {
    const first = this.name(problem);
    if (!isSymbol(this.peek(), '.')) return { via: null, name: first, span: first.span };
    this.next();
    const second = this.name(`Name a field of ${first.text} after the dot.`);
    if (isSymbol(this.peek(), '.')) {
      throw new QueryTextError(
        'A field reaches one relation deep: project.owner.',
        this.peek().span,
      );
    }
    return { via: first, name: second, span: { start: first.span.start, end: second.span.end } };
  }

  private name(problem: string): Name {
    const token = this.peek();
    if (token.kind !== 'word') throw new QueryTextError(problem, token.span);
    this.next();
    return { text: token.text, span: token.span };
  }

  private list<Item>(item: () => Item): Item[] {
    const items = [item()];
    while (isSymbol(this.peek(), ',')) {
      this.next();
      items.push(item());
    }
    return items;
  }

  private keyword(word: string, problem: string): Span {
    const token = this.peek();
    if (!isWord(token, word)) throw new QueryTextError(problem, token.span);
    this.next();
    return token.span;
  }

  private accept(word: string): boolean {
    if (!isWord(this.peek(), word)) return false;
    this.next();
    return true;
  }

  private peek(): Token {
    return this.tokens[this.at] ?? (this.tokens.at(-1) as Token);
  }

  private next(): Token {
    const token = this.peek();
    if (token.kind !== 'end') this.at += 1;
    return token;
  }
}

const CLAUSE_READERS: Readonly<Record<ClauseName, (parser: Parser, draft: Draft) => void>> = {
  WHERE: (parser, draft) => {
    draft.where = parser.where();
  },
  SORT: (parser, draft) => {
    draft.sort = parser.sort();
  },
  GROUP: (parser, draft) => {
    draft.group = parser.group();
  },
  SHOW: (parser, draft) => {
    draft.show = parser.show();
  },
  INCLUDE: (parser, draft) => {
    parser.includeArchived();
    draft.includeArchived = true;
  },
  LIMIT: (parser, draft) => {
    draft.limit = parser.limit();
  },
};

function clauseLabel(name: ClauseName): string {
  if (name === 'SORT' || name === 'GROUP') return `${name} BY`;
  return name === 'INCLUDE' ? 'INCLUDE ARCHIVED' : name;
}

function isWord(token: Token, word: string): boolean {
  return token.kind === 'word' && token.text.toUpperCase() === word;
}

function isSymbol(token: Token, symbol: string): boolean {
  return token.kind === 'symbol' && token.text === symbol;
}

function spanOf(first: { span: Span } | undefined, last: { span: Span } | undefined): Span {
  return { start: first?.span.start ?? 0, end: last?.span.end ?? 0 };
}

/** How a comparison is written, for a problem to quote it. */
export function opText(op: Comparison): string {
  if (op === 'contains') return 'CONTAINS';
  return op === 'startsWith' ? 'STARTS WITH' : op;
}
