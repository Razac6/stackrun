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
