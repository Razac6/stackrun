// SQL tool (renderer, pure): split a script into statements - so Ctrl/⌘+Enter runs the
// one under the cursor - without being fooled by ; inside quotes, comments or $$ bodies.

export interface Statement {
  start: number; // offsets in the script
  end: number;
  text: string;
}

export const splitStatements = (sql: string): Statement[] => {
  const out: Statement[] = [];
  let start = 0;
  let i = 0;
  const push = (end: number) => {
    const text = sql.slice(start, end);
    if (text.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim())
      out.push({ start, end, text: text.trim() });
    start = end + 1;
  };
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl < 0 ? sql.length : nl + 1;
    } else if (ch === '/' && next === '*') {
      const close = sql.indexOf('*/', i + 2);
      i = close < 0 ? sql.length : close + 2;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch && sql[j + 1] === ch) j += 2;
        else if (sql[j] === '\\' && ch !== '"') j += 2;
        else if (sql[j] === ch) break;
        else j += 1;
      }
      i = j + 1;
    } else if (ch === '$') {
      // postgres dollar quoting: $$ … $$ or $tag$ … $tag$
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        i = close < 0 ? sql.length : close + tag[0].length;
      } else i += 1;
    } else if (ch === ';') {
      push(i);
      i += 1;
    } else i += 1;
  }
  if (start < sql.length) push(sql.length);
  return out;
};

/** The statement the cursor is in (or right after, on its `;`); the last one otherwise. */
export const statementAt = (sql: string, offset: number): Statement | null => {
  const list = splitStatements(sql);
  if (!list.length) return null;
  return (
    list.find((s) => offset >= s.start && offset <= s.end + 1) ||
    [...list].reverse().find((s) => s.start <= offset) ||
    list[0]
  );
};

/** Rows as CSV (to copy into a sheet). */
export const toCsv = (columns: string[], rows: string[][]) =>
  [columns, ...rows]
    .map((r) =>
      r
        .map((c) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
        .join(','),
    )
    .join('\n');

export const SQL_SETTINGS_KEY = 'sql_tool';

// ---------------- searching the result ----------------
/**
 * One filter on a cell: text it contains, or "=exact", "!not this", ">10", "<10",
 * ">=", "<=" (numbers), "null" / "!null". Case does not matter.
 */
export const cellMatches = (cell: string, filter: string) => {
  const f = filter.trim();
  if (!f) return true;
  const low = cell.toLowerCase();
  const isNull = cell === 'NULL' || cell === '';
  if (/^null$/i.test(f)) return isNull;
  if (/^!null$/i.test(f)) return !isNull;
  const cmp = /^(>=|<=|>|<)\s*(-?\d+(\.\d+)?)$/.exec(f);
  if (cmp) {
    const n = Number(cell);
    if (cell.trim() === '' || Number.isNaN(n)) return false;
    const v = Number(cmp[2]);
    if (cmp[1] === '>') return n > v;
    if (cmp[1] === '<') return n < v;
    if (cmp[1] === '>=') return n >= v;
    return n <= v;
  }
  if (f.startsWith('=')) return low === f.slice(1).trim().toLowerCase();
  if (f.startsWith('!')) return !low.includes(f.slice(1).trim().toLowerCase());
  return low.includes(f.toLowerCase());
};

/** Indexes of the rows that match the search (any cell) and every column filter. */
export const filterRows = (
  rows: string[][],
  search: string,
  byColumn: Record<number, string>,
) => {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const filters = Object.entries(byColumn).filter(([, f]) => f.trim());
  const out: number[] = [];
  rows.forEach((row, i) => {
    if (
      words.length &&
      !words.every((w) => row.some((c) => c.toLowerCase().includes(w)))
    )
      return;
    if (filters.some(([j, f]) => !cellMatches(row[Number(j)] ?? '', f))) return;
    out.push(i);
  });
  return out;
};

// ---------------- timings: the same query before / after a change ----------------
export const TIMINGS_KEY = 'sql_timings';
const MAX_PER_QUERY = 30;
const MAX_QUERIES = 200;

export interface SavedTiming {
  at: number;
  label: string; // "before the index"
  ms: number;
  minMs: number;
  maxMs: number;
  method: 'server' | 'roundtrip';
}

export type Timings = Record<string, SavedTiming[]>;

/** The same query on the same database, however it is spaced or ended. */
export const timingKey = (container: string, db: string, sql: string) =>
  `${container}|${db}|${sql.replace(/\s+/g, ' ').trim().replace(/;$/, '').trim()}`;

export const parseTimings = (raw?: string | null): Timings => {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (e) {
    return {};
  }
};

/** Adds a measurement (newest last); old queries go when there are too many. */
export const addTiming = (all: Timings, key: string, t: SavedTiming) => {
  const next: Timings = {
    ...all,
    [key]: [...(all[key] || []), t].slice(-MAX_PER_QUERY),
  };
  const keys = Object.keys(next);
  if (keys.length > MAX_QUERIES) {
    const lastAt = (k: string) => next[k][next[k].length - 1]?.at || 0;
    keys
      .sort((a, b) => lastAt(a) - lastAt(b))
      .slice(0, keys.length - MAX_QUERIES)
      .forEach((k) => delete next[k]);
  }
  return next;
};

/** "-42%" / "+8%" against an earlier time; null when there is nothing to compare. */
export const change = (now: number, before?: number) => {
  if (before === undefined || before <= 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return { pct, text: `${pct > 0 ? '+' : ''}${pct}%`, faster: pct < 0 };
};

/** Short time: 0.42 ms, 12.3 ms, 1.24 s. */
export const msText = (ms: number) => {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  if (ms >= 10) return `${ms.toFixed(1)} ms`;
  return `${ms.toFixed(2)} ms`;
};
