// JSON helpers for notes and the compare view: validation with a readable position,
// formatting, a tokenizer for syntax highlighting, a structural diff (by path) and a
// line diff of the pretty-printed documents.

export type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; line?: number; column?: number };

const positionOf = (text: string, index: number) => {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const column = index - before.lastIndexOf('\n');
  return { line, column };
};

export const parseJson = (text: string): JsonParseResult => {
  if (!text.trim()) return { ok: false, error: 'Empty document' };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e: any) {
    const message = String(e?.message || e);
    // V8: "... at position 42" or "(line 3 column 5)"
    const lc = message.match(/line (\d+) column (\d+)/);
    if (lc) {
      return {
        ok: false,
        error: message,
        line: Number(lc[1]),
        column: Number(lc[2]),
      };
    }
    const pos = message.match(/position (\d+)/);
    if (pos) {
      return { ok: false, error: message, ...positionOf(text, Number(pos[1])) };
    }
    return { ok: false, error: message };
  }
};

export const sortKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as object)
        .sort()
        .map((k) => [k, sortKeysDeep((value as any)[k])]),
    );
  }
  return value;
};

export const formatJson = (value: unknown, indent = 2, sortKeys = false) =>
  JSON.stringify(sortKeys ? sortKeysDeep(value) : value, null, indent);

// --- Highlighting ----------------------------------------------------------------------

export type TokenType =
  | 'key'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'punct'
  | 'text';

const TOKEN =
  /("(?:\\.|[^"\\])*"?)(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],:])/g;

/** Splits text into highlight tokens. Tolerant - works on invalid JSON while typing. */
export const tokenizeJson = (text: string) => {
  const tokens: { type: TokenType; text: string }[] = [];
  let last = 0;
  TOKEN.lastIndex = 0;
  let m = TOKEN.exec(text);
  while (m) {
    if (m.index > last)
      tokens.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) {
      tokens.push({ type: m[2] ? 'key' : 'string', text: m[1] });
      if (m[2]) tokens.push({ type: 'punct', text: m[2] });
    } else if (m[3] !== undefined) tokens.push({ type: 'number', text: m[3] });
    else if (m[4] !== undefined) tokens.push({ type: 'boolean', text: m[4] });
    else if (m[5] !== undefined) tokens.push({ type: 'null', text: m[5] });
    else tokens.push({ type: 'punct', text: m[6] });
    last = m.index + m[0].length;
    m = TOKEN.exec(text);
  }
  if (last < text.length) tokens.push({ type: 'text', text: text.slice(last) });
  return tokens;
};

// --- Structural diff ---------------------------------------------------------------------

export type DiffKind = 'added' | 'removed' | 'changed';
export interface JsonDifference {
  path: string;
  kind: DiffKind;
  left?: unknown;
  right?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const childPath = (path: string, key: string | number) => {
  if (typeof key === 'number') return `${path}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
};

/** Differences by JSON path ($.a.b[0]); arrays are compared index by index. */
export const diffJson = (
  left: unknown,
  right: unknown,
  path = '$',
  out: JsonDifference[] = [],
): JsonDifference[] => {
  if (isObject(left) && isObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    keys.forEach((key) => {
      const p = childPath(path, key);
      if (!(key in right))
        out.push({ path: p, kind: 'removed', left: left[key] });
      else if (!(key in left))
        out.push({ path: p, kind: 'added', right: right[key] });
      else diffJson(left[key], right[key], p, out);
    });
    return out;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i += 1) {
      const p = childPath(path, i);
      if (i >= right.length)
        out.push({ path: p, kind: 'removed', left: left[i] });
      else if (i >= left.length)
        out.push({ path: p, kind: 'added', right: right[i] });
      else diffJson(left[i], right[i], p, out);
    }
    return out;
  }
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    out.push({ path, kind: 'changed', left, right });
  }
  return out;
};

// --- Line diff ---------------------------------------------------------------------------

export interface DiffRow {
  left?: string;
  right?: string;
  leftNo?: number;
  rightNo?: number;
  kind: 'same' | 'removed' | 'added' | 'changed';
}

/**
 * Side-by-side line diff (LCS). Adjacent removed+added runs are paired up as "changed"
 * rows so a modified value shows on one line on both sides.
 */
export const lineDiff = (leftText: string, rightText: string): DiffRow[] => {
  const a = leftText.split('\n');
  const b = rightText.split('\n');
  const n = a.length;
  const m = b.length;
  // Very large documents: skip the O(n*m) table and compare line by line
  if (n * m > 4_000_000) {
    return Array.from({ length: Math.max(n, m) }, (_, i) => ({
      left: a[i],
      right: b[i],
      leftNo: i < n ? i + 1 : undefined,
      rightNo: i < m ? i + 1 : undefined,
      kind: a[i] === b[i] ? 'same' : 'changed',
    }));
  }
  const lcs: Uint32Array[] = Array.from(
    { length: n + 1 },
    () => new Uint32Array(m + 1),
  );
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let removed: DiffRow[] = [];
  let added: DiffRow[] = [];
  const flush = () => {
    const pairs = Math.min(removed.length, added.length);
    for (let k = 0; k < pairs; k += 1) {
      rows.push({
        left: removed[k].left,
        leftNo: removed[k].leftNo,
        right: added[k].right,
        rightNo: added[k].rightNo,
        kind: 'changed',
      });
    }
    rows.push(...removed.slice(pairs), ...added.slice(pairs));
    removed = [];
    added = [];
  };

  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      rows.push({
        left: a[i],
        right: b[j],
        leftNo: i + 1,
        rightNo: j + 1,
        kind: 'same',
      });
      i += 1;
      j += 1;
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      added.push({ right: b[j], rightNo: j + 1, kind: 'added' });
      j += 1;
    } else {
      removed.push({ left: a[i], leftNo: i + 1, kind: 'removed' });
      i += 1;
    }
  }
  flush();
  return rows;
};

// --- Repair ------------------------------------------------------------------------------

type RToken =
  | { t: 'str'; v: string } // already a valid JSON string literal
  | { t: 'num'; v: string }
  | { t: 'lit'; v: 'true' | 'false' | 'null' }
  | { t: 'word'; v: string } // bare identifier (key candidate)
  | { t: 'p'; v: '{' | '}' | '[' | ']' | ':' | ',' };

const LITERALS: Record<string, 'true' | 'false' | 'null'> = {
  true: 'true',
  false: 'false',
  null: 'null',
  True: 'true',
  False: 'false',
  None: 'null',
  undefined: 'null',
  NaN: 'null',
  Infinity: 'null',
};

// Turns the raw inside of a '…' or "…" literal into its string value
const unescapeLoose = (raw: string) =>
  raw.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (m, e: string) => {
    if (e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
    return (
      (
        { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<
          string,
          string
        >
      )[e] ?? e
    );
  });

/**
 * Best-effort fix for "almost JSON": JS object literals, Python dicts, logs. Handles
 * comments, single quotes, unquoted keys, trailing / missing / double commas, Python and
 * JS literals, smart quotes, raw newlines in strings, text around the JSON, several
 * top-level values (wrapped in an array) and unclosed brackets / strings.
 * Returns the repaired text (pretty-printed when it parses) and what was changed.
 */
export const repairJson = (input: string) => {
  const fixes = new Set<string>();
  let s = input.replace(/^\uFEFF/, '');
  if (/[\u201C\u201D\u2018\u2019]/.test(s)) {
    s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
    fixes.add('Replaced smart quotes');
  }
  // Text before the JSON (e.g. "response = {", "data: [")
  const start = s.search(/[{[]/);
  if (start > 0 && /[A-Za-z=:]/.test(s.slice(0, start))) {
    s = s.slice(start);
    fixes.add('Removed text before the JSON');
  }

  // Tokenize leniently
  const tokens: RToken[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i += 1;
    } else if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i += 1;
      fixes.add('Removed comments');
    } else if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end === -1 ? s.length : end + 2;
      fixes.add('Removed comments');
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      let raw = '';
      while (j < s.length && s[j] !== c) {
        if (s[j] === '\\' && j + 1 < s.length) {
          raw += s[j] + s[j + 1];
          j += 2;
        } else {
          raw += s[j];
          j += 1;
        }
      }
      if (j >= s.length) fixes.add('Closed an unterminated string');
      if (c === "'") fixes.add('Converted single quotes to double quotes');
      if (/[\n\r\t]/.test(raw)) fixes.add('Escaped line breaks inside strings');
      tokens.push({ t: 'str', v: JSON.stringify(unescapeLoose(raw)) });
      i = j + 1;
    } else if ('{}[]:,'.includes(c)) {
      tokens.push({ t: 'p', v: c as '{' });
      i += 1;
    } else if (/[-+.\d]/.test(c)) {
      const m = s.slice(i).match(/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/);
      if (m) {
        const n = Number(m[0]);
        const v = Number.isFinite(n) ? String(n) : 'null';
        if (v !== m[0]) fixes.add('Normalised numbers');
        tokens.push({ t: 'num', v });
        i += m[0].length;
      } else {
        i += 1;
        fixes.add('Removed unexpected characters');
      }
    } else if (/[A-Za-z_$]/.test(c)) {
      const m = s.slice(i).match(/^[A-Za-z_$][\w$-]*/)!;
      const lit = LITERALS[m[0]];
      if (lit && !/^(true|false|null)$/.test(m[0])) {
        fixes.add('Converted Python / JavaScript literals');
      }
      tokens.push(lit ? { t: 'lit', v: lit } : { t: 'word', v: m[0] });
      i += m[0].length;
    } else {
      i += 1;
      if (c !== ';') fixes.add('Removed unexpected characters');
    }
  }

  // Rebuild with structural fixes
  const out: string[] = [];
  const stack: ('{' | '[')[] = [];
  let prev: RToken | null = null;
  let topLevelValues = 1;
  const endsValue = (t: RToken | null) =>
    !!t &&
    (t.t === 'str' ||
      t.t === 'num' ||
      t.t === 'lit' ||
      t.t === 'word' ||
      (t.t === 'p' && (t.v === '}' || t.v === ']')));
  const startsValue = (t: RToken) => t.t !== 'p' || t.v === '{' || t.v === '[';

  tokens.forEach((tok, k) => {
    let token = tok;
    if (token.t === 'word') {
      const inObject = stack[stack.length - 1] === '{';
      const expectingKey =
        inObject &&
        (!prev || (prev.t === 'p' && (prev.v === '{' || prev.v === ',')));
      fixes.add(expectingKey ? 'Quoted unquoted keys' : 'Quoted bare words');
      token = { t: 'str', v: JSON.stringify(token.v) };
    }

    if (token.t === 'p' && token.v === ',') {
      const next = tokens[k + 1];
      if (!next || (next.t === 'p' && (next.v === '}' || next.v === ']'))) {
        fixes.add('Removed trailing commas');
        return;
      }
      if (!prev || (prev.t === 'p' && ['{', '[', ',', ':'].includes(prev.v))) {
        fixes.add('Removed extra commas');
        return;
      }
      if (!stack.length) {
        // a comma between top-level values: wrap them in an array below
        topLevelValues += 1;
      }
    } else if (startsValue(token) && endsValue(prev)) {
      out.push(',');
      if (stack.length) fixes.add('Added missing commas');
      else topLevelValues += 1;
    }

    if (token.t === 'p' && (token.v === '}' || token.v === ']')) {
      const open = stack.pop();
      if (!open) {
        fixes.add('Removed unmatched closing brackets');
        return;
      }
      const want = open === '{' ? '}' : ']';
      if (want !== token.v) fixes.add('Fixed mismatched brackets');
      out.push(want);
      prev = { t: 'p', v: want };
      return;
    }
    if (token.t === 'p' && (token.v === '{' || token.v === '[')) {
      stack.push(token.v);
    }
    out.push(token.v);
    prev = token;
  });

  while (out.length && out[out.length - 1] === ',') out.pop();
  if (stack.length) {
    fixes.add('Closed unclosed brackets');
    while (stack.length) out.push(stack.pop() === '{' ? '}' : ']');
  }
  let text = out.join('');
  if (topLevelValues > 1) {
    text = `[${text}]`;
    fixes.add('Wrapped several values in an array');
  }
  const parsed = parseJson(text);
  return {
    ok: parsed.ok,
    text: parsed.ok ? formatJson(parsed.value) : text,
    fixes: [...fixes],
  };
};
