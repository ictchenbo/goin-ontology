// 受限规则 DSL：比较、布尔组合、聚合、对象关系查询、时间区间与简单算术
// 安全性：自研词法/语法分析 + 解释执行，不使用 eval / Function
// 表达式必须能枚举依赖字段（analyzeDeps）与读取范围

import { AppError } from './errors';

// ===== 词法 =====
type TokenType =
  | 'number' | 'string' | 'ident' | 'op' | 'lparen' | 'rparen' | 'lbracket' | 'rbracket'
  | 'comma' | 'eof';

interface Token { type: TokenType; value: string; pos: number }

const OPS = ['==', '!=', '>=', '<=', '>', '<', '+', '-', '*', '/', '&&', '||', '!'];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') { tokens.push({ type: 'lparen', value: c, pos: i++ }); continue; }
    if (c === ')') { tokens.push({ type: 'rparen', value: c, pos: i++ }); continue; }
    if (c === '[') { tokens.push({ type: 'lbracket', value: c, pos: i++ }); continue; }
    if (c === ']') { tokens.push({ type: 'rbracket', value: c, pos: i++ }); continue; }
    if (c === ',') { tokens.push({ type: 'comma', value: c, pos: i++ }); continue; }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== quote) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const n = src[j + 1];
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n;
          j += 2;
        } else { s += src[j++]; }
      }
      if (j >= src.length) throw new AppError('VALIDATION_ERROR', `字符串未闭合 @${i}`);
      tokens.push({ type: 'string', value: s, pos: i });
      i = j + 1;
      continue;
    }
    // 数字
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i;
      while (j < src.length && /[0-9._eE+-]/.test(src[j])) {
        // 避免把减号吞进数字（1-2 应为减法）
        if ((src[j] === '+' || src[j] === '-') && !/[eE]/.test(src[j - 1] || '')) break;
        if (src[j] === '.' && src.slice(i, j).includes('.')) break;
        j++;
      }
      tokens.push({ type: 'number', value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    // 标识符（支持 a.b.c 与 a[0].b / a['key'] 路径作为单个 ident）
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length) {
        const ch = src[j];
        if (/[A-Za-z0-9_.]/.test(ch)) { j++; continue; }
        // 下标： [0] 或 ['key'] 或 ["key"]
        if (ch === '[') {
          let k = j + 1;
          if (src[k] === "'" || src[k] === '"') {
            const q = src[k]; k++;
            while (k < src.length && src[k] !== q) k++;
            k++; // 跳过闭合引号
          } else {
            while (k < src.length && src[k] !== ']') k++;
          }
          if (src[k] === ']') { j = k + 1; continue; }
        }
        break;
      }
      tokens.push({ type: 'ident', value: src.slice(i, j), pos: i });
      i = j;
      continue;
    }
    // 运算符
    const two = src.slice(i, i + 2);
    const op2 = OPS.find((o) => o.length === 2 && o === two);
    if (op2) { tokens.push({ type: 'op', value: op2, pos: i }); i += 2; continue; }
    const op1 = OPS.find((o) => o.length === 1 && o === c);
    if (op1) { tokens.push({ type: 'op', value: op1, pos: i }); i++; continue; }
    throw new AppError('VALIDATION_ERROR', `非法字符 '${c}' @${i}`);
  }
  tokens.push({ type: 'eof', value: '', pos: src.length });
  return tokens;
}

// ===== 语法树 =====
type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'null' }
  | { k: 'list'; items: Node[] }
  | { k: 'path'; path: string[] }
  | { k: 'unary'; op: string; arg: Node }
  | { k: 'binary'; op: string; left: Node; right: Node }
  | { k: 'call'; name: string; args: Node[] };

class Parser {
  private tokens: Token[];
  private pos = 0;
  constructor(tokens: Token[]) { this.tokens = tokens; }

  private peek(): Token { return this.tokens[this.pos]; }
  private next(): Token { return this.tokens[this.pos++]; }
  private expect(type: TokenType, value?: string): Token {
    const t = this.next();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new AppError('VALIDATION_ERROR', `语法错误：期望 ${value ?? type}，得到 '${t.value}' @${t.pos}`);
    }
    return t;
  }

  parse(): Node {
    const n = this.parseOr();
    if (this.peek().type !== 'eof') {
      throw new AppError('VALIDATION_ERROR', `表达式尾部有多余内容 '${this.peek().value}'`);
    }
    return n;
  }

  // 布尔关键字（词法层把 and/or/not 收成 ident，这里统一识别）
  private matchKeyword(word: string): boolean {
    const t = this.peek();
    return t.type === 'ident' && t.value.toLowerCase() === word;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (
      (this.peek().type === 'op' && this.peek().value === '||') ||
      this.matchKeyword('or')
    ) {
      this.next();
      left = { k: 'binary', op: 'or', left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseNot();
    while (
      (this.peek().type === 'op' && this.peek().value === '&&') ||
      this.matchKeyword('and')
    ) {
      this.next();
      left = { k: 'binary', op: 'and', left, right: this.parseNot() };
    }
    return left;
  }

  private parseNot(): Node {
    if (
      (this.peek().type === 'op' && this.peek().value === '!') ||
      this.matchKeyword('not')
    ) {
      this.next();
      return { k: 'unary', op: 'not', arg: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Node {
    const left = this.parseAdd();
    const t = this.peek();
    if (t.type === 'op' && ['==', '!=', '>=', '<=', '>', '<'].includes(t.value)) {
      this.next();
      return { k: 'binary', op: t.value, left, right: this.parseAdd() };
    }
    return left;
  }

  private parseAdd(): Node {
    let left = this.parseMul();
    while (this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.next().value;
      left = { k: 'binary', op, left, right: this.parseMul() };
    }
    return left;
  }

  private parseMul(): Node {
    let left = this.parseUnary();
    while (this.peek().type === 'op' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.next().value;
      left = { k: 'binary', op, left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): Node {
    if (this.peek().type === 'op' && this.peek().value === '-') {
      this.next();
      return { k: 'unary', op: 'neg', arg: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const t = this.peek();
    if (t.type === 'number') { this.next(); return { k: 'num', v: Number(t.value) }; }
    if (t.type === 'string') { this.next(); return { k: 'str', v: t.value }; }
    if (t.type === 'lbracket') {
      this.next();
      const items: Node[] = [];
      if (this.peek().type !== 'rbracket') {
        items.push(this.parseOr());
        while (this.peek().type === 'comma') { this.next(); items.push(this.parseOr()); }
      }
      this.expect('rbracket');
      return { k: 'list', items };
    }
    if (t.type === 'lparen') {
      this.next();
      const n = this.parseOr();
      this.expect('rparen');
      return n;
    }
    if (t.type === 'ident') {
      this.next();
      const lower = t.value.toLowerCase();
      if (lower === 'true') return { k: 'bool', v: true };
      if (lower === 'false') return { k: 'bool', v: false };
      if (lower === 'null') return { k: 'null' };
      // 函数调用
      if (this.peek().type === 'lparen') {
        this.next();
        const args: Node[] = [];
        if (this.peek().type !== 'rparen') {
          args.push(this.parseOr());
          while (this.peek().type === 'comma') { this.next(); args.push(this.parseOr()); }
        }
        this.expect('rparen');
        return { k: 'call', name: lower, args };
      }
      // 路径：解析 a.b、a[0].b、a['key'].b
      return { k: 'path', path: parsePathSegments(t.value) };
    }
    throw new AppError('VALIDATION_ERROR', `无法解析 '${t.value}' @${t.pos}`);
  }
}

export function parseExpression(src: string): Node {
  return new Parser(tokenize(src)).parse();
}

// 危险路径段：防止原型污染
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

// 把 proposed[0].serviceScore / a['x'].b 解析为路径段数组
function parsePathSegments(raw: string): string[] {
  const normalized = raw.replace(/\[(['"]?)([^\]'"]+)\1\]/g, '.$2');
  const segments = normalized.split('.').filter((s) => s.length);
  for (const seg of segments) {
    if (FORBIDDEN_SEGMENTS.has(seg)) {
      throw new AppError('VALIDATION_ERROR', `路径段不允许: ${seg}`);
    }
  }
  return segments;
}

// ===== 依赖分析：枚举表达式读取的字段 =====
export function analyzeDeps(node: Node): string[] {
  const deps = new Set<string>();
  const walk = (n: Node) => {
    switch (n.k) {
      case 'path': deps.add(n.path.join('.')); break;
      case 'list': n.items.forEach(walk); break;
      case 'unary': walk(n.arg); break;
      case 'binary': walk(n.left); walk(n.right); break;
      case 'call': n.args.forEach(walk); break;
      default: break;
    }
  };
  walk(node);
  return [...deps].sort();
}

export function depsOfExpression(src: string): string[] {
  return analyzeDeps(parseExpression(src));
}

// ===== 求值上下文 =====
export type EvalContext = Record<string, unknown>;

function getPath(ctx: EvalContext, path: string[]): unknown {
  let cur: unknown = ctx;
  for (const key of path) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    // 数组下标用数字访问
    if (Array.isArray(cur) && /^\d+$/.test(key)) {
      cur = cur[Number(key)];
    } else {
      cur = (cur as Record<string, unknown>)[key];
    }
  }
  return cur;
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  if (v instanceof Date) return v.getTime();
  return Number.NaN;
}

function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (v === 0 || v === '') return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

const ALLOWED_FUNCS = new Set([
  'now', 'today', 'abs', 'round', 'floor', 'ceil', 'min', 'max', 'sum', 'avg', 'count',
  'coalesce', 'in', 'contains', 'startswith', 'endswith', 'len', 'days_between', 'hours_between',
  'minutes_between', 'date_diff', 'between', 'clamp', 'if', 'is_null', 'is_number', 'to_number',
  'to_string', 'lower', 'upper', 'exists', 'any', 'all', 'first', 'date_add',
]);

type CustomFunctionResolver = (name: string, args: unknown[]) => unknown;
let customFunctionResolver: CustomFunctionResolver | null = null;

export function isBuiltinFunction(name: string): boolean {
  return ALLOWED_FUNCS.has(name.toLowerCase());
}

export function setCustomFunctionResolver(resolver: CustomFunctionResolver): void {
  customFunctionResolver = resolver;
}

function callFunc(name: string, args: unknown[]): unknown {
  if (!ALLOWED_FUNCS.has(name)) {
    if (customFunctionResolver) return customFunctionResolver(name, args);
    throw new AppError('VALIDATION_ERROR', `未定义函数: ${name}`);
  }
  switch (name) {
    case 'now': return new Date().toISOString();
    case 'today': return new Date().toISOString().slice(0, 10);
    case 'abs': return Math.abs(toNumber(args[0]));
    case 'round': {
      const digits = args.length > 1 ? toNumber(args[1]) : 0;
      const p = Math.pow(10, digits);
      return Math.round(toNumber(args[0]) * p) / p;
    }
    case 'floor': return Math.floor(toNumber(args[0]));
    case 'ceil': return Math.ceil(toNumber(args[0]));
    case 'min': return Math.min(...args.map(toNumber));
    case 'max': return Math.max(...args.map(toNumber));
    case 'sum': {
      const arr = Array.isArray(args[0]) ? args[0] : args;
      return arr.reduce((a: number, b: unknown) => a + (toNumber(b) || 0), 0);
    }
    case 'avg': {
      const arr = Array.isArray(args[0]) ? args[0] : args;
      if (!arr.length) return 0;
      return arr.reduce((a: number, b: unknown) => a + (toNumber(b) || 0), 0) / arr.length;
    }
    case 'count': {
      const v = args[0];
      if (Array.isArray(v)) return v.length;
      if (v === null || v === undefined) return 0;
      return 1;
    }
    case 'coalesce': {
      for (const a of args) if (a !== null && a !== undefined && a !== '') return a;
      return null;
    }
    case 'in': return Array.isArray(args[1]) ? args[1].includes(args[0]) : false;
    case 'contains': {
      const [hay, needle] = args;
      if (Array.isArray(hay)) return hay.includes(needle);
      return String(hay ?? '').includes(String(needle ?? ''));
    }
    case 'startswith': return String(args[0] ?? '').startsWith(String(args[1] ?? ''));
    case 'endswith': return String(args[0] ?? '').endsWith(String(args[1] ?? ''));
    case 'len': {
      const v = args[0];
      if (Array.isArray(v)) return v.length;
      if (v && typeof v === 'object') return Object.keys(v).length;
      return String(v ?? '').length;
    }
    case 'days_between': return timeDiffDays(args[0], args[1]);
    case 'hours_between': return timeDiffDays(args[0], args[1]) * 24;
    case 'minutes_between': return timeDiffDays(args[0], args[1]) * 24 * 60;
    case 'date_diff': return timeDiffDays(args[0], args[1]);
    case 'between': {
      const x = toNumber(args[0]);
      return x >= toNumber(args[1]) && x <= toNumber(args[2]);
    }
    case 'clamp': {
      const x = toNumber(args[0]);
      return Math.min(Math.max(x, toNumber(args[1])), toNumber(args[2]));
    }
    case 'if': return truthy(args[0]) ? args[1] : args[2];
    case 'is_null': return args[0] === null || args[0] === undefined;
    case 'is_number': return typeof args[0] === 'number' && Number.isFinite(args[0]);
    case 'to_number': return toNumber(args[0]);
    case 'to_string': return args[0] === null || args[0] === undefined ? '' : String(args[0]);
    case 'lower': return String(args[0] ?? '').toLowerCase();
    case 'upper': return String(args[0] ?? '').toUpperCase();
    case 'exists': return args[0] !== undefined && args[0] !== null;
    case 'any': {
      const arr = Array.isArray(args[0]) ? args[0] : [];
      return arr.some((x) => truthy(x));
    }
    case 'all': {
      const arr = Array.isArray(args[0]) ? args[0] : [];
      return arr.every((x) => truthy(x));
    }
    case 'first': return Array.isArray(args[0]) ? args[0][0] : null;
    case 'date_add': {
      const base = toDate(args[0]);
      const days = toNumber(args[1]);
      return new Date(base.getTime() + days * 86400000).toISOString();
    }
    default:
      throw new AppError('VALIDATION_ERROR', `未实现函数: ${name}`);
  }
}

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  const d = new Date(String(v ?? ''));
  if (Number.isNaN(d.getTime())) throw new AppError('VALIDATION_ERROR', `无法解析日期: ${String(v)}`);
  return d;
}

function timeDiffDays(a: unknown, b: unknown): number {
  return (toDate(a).getTime() - toDate(b).getTime()) / 86400000;
}

// ===== 解释执行 =====
function evalNode(node: Node, ctx: EvalContext): unknown {
  switch (node.k) {
    case 'num': return node.v;
    case 'str': return node.v;
    case 'bool': return node.v;
    case 'null': return null;
    case 'list': return node.items.map((n) => evalNode(n, ctx));
    case 'path': return getPath(ctx, node.path);
    case 'unary': {
      const v = evalNode(node.arg, ctx);
      if (node.op === 'not') return !truthy(v);
      return -toNumber(v);
    }
    case 'binary': {
      // 短路求值
      if (node.op === 'and') return truthy(evalNode(node.left, ctx)) ? truthy(evalNode(node.right, ctx)) : false;
      if (node.op === 'or') return truthy(evalNode(node.left, ctx)) ? true : truthy(evalNode(node.right, ctx));
      const l = evalNode(node.left, ctx);
      const r = evalNode(node.right, ctx);
      switch (node.op) {
        case '==': return looseEq(l, r);
        case '!=': return !looseEq(l, r);
        case '>': return toNumber(l) > toNumber(r);
        case '>=': return toNumber(l) >= toNumber(r);
        case '<': return toNumber(l) < toNumber(r);
        case '<=': return toNumber(l) <= toNumber(r);
        case '+': {
          if (typeof l === 'string' || typeof r === 'string') return String(l ?? '') + String(r ?? '');
          return toNumber(l) + toNumber(r);
        }
        case '-': return toNumber(l) - toNumber(r);
        case '*': return toNumber(l) * toNumber(r);
        case '/': {
          const d = toNumber(r);
          if (d === 0) throw new AppError('VALIDATION_ERROR', '除零错误');
          return toNumber(l) / d;
        }
        default: throw new AppError('VALIDATION_ERROR', `未知运算符 ${node.op}`);
      }
    }
    case 'call': return callFunc(node.name, node.args.map((a) => evalNode(a, ctx)));
    default: throw new AppError('VALIDATION_ERROR', '未知节点');
  }
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === 'number' || typeof b === 'number') {
    const na = toNumber(a); const nb = toNumber(b);
    if (Number.isNaN(na) || Number.isNaN(nb)) return String(a) === String(b);
    return na === nb;
  }
  return String(a) === String(b);
}

// 公开 API：编译并求值
const cache = new Map<string, Node>();

export function compileExpression(src: string): Node {
  const key = src.trim();
  let node = cache.get(key);
  if (!node) {
    node = parseExpression(key);
    cache.set(key, node);
  }
  return node;
}

export function evaluate(src: string, ctx: EvalContext): unknown {
  return evalNode(compileExpression(src), ctx);
}

export function evaluateBoolean(src: string, ctx: EvalContext): boolean {
  return truthy(evaluate(src, ctx));
}

export function expressionDependencies(src: string): string[] {
  return analyzeDeps(compileExpression(src));
}

// 清理缓存（测试用）
export function clearExpressionCache(): void {
  cache.clear();
}
