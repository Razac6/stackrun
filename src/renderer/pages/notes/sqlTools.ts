// SQL helpers for notes and the compare view: a tokenizer that respects strings, quoted
// identifiers and comments, a readable formatter (keywords upper-cased, one clause per
// line, select lists and conditions indented), a minifier and a light syntax check
// (unbalanced brackets / quotes, with the line).

export type SqlToken = {
  type: 'word' | 'string' | 'ident' | 'comment' | 'number' | 'punct' | 'space';
  text: string;
};

const KEYWORDS = new Set(
  `select from where and or not in is null like between exists as on join inner left right
  full outer cross natural using group by order having limit offset fetch first next rows
  only union all intersect except distinct insert into values update set delete merge
  create alter drop table view index sequence trigger procedure function returns return
  begin end declare if else case when then with recursive primary key foreign references
  unique check default constraint add column rename to asc desc nulls top over partition
  window cast coalesce count sum avg min max true false truncate grant revoke commit
  rollback transaction lateral returning conflict do nothing apply pivot unpivot`
    .split(/\s+/)
    .filter(Boolean),
);

export const tokenizeSql = (sql: string): SqlToken[] => {
  const tokens: SqlToken[] = [];
  let i = 0;
  const push = (type: SqlToken['type'], end: number) => {
    tokens.push({ type, text: sql.slice(i, end) });
    i = end;
  };
  while (i < sql.length) {
    const c = sql[i];
    const rest = sql.slice(i);
    if (/\s/.test(c)) {
      const m = rest.match(/^\s+/)!;
      push('space', i + m[0].length);
    } else if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i);
      push('comment', end === -1 ? sql.length : end);
    } else if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', i + 2);
      push('comment', end === -1 ? sql.length : end + 2);
    } else if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === close) {
          // doubled quote = escaped quote
          if (close !== ']' && sql[j + 1] === close) j += 2;
          else break;
        } else j += 1;
      }
      push(c === "'" ? 'string' : 'ident', Math.min(j + 1, sql.length));
    } else if (/\d/.test(c)) {
      const m = rest.match(/^\d+(\.\d+)?([eE][+-]?\d+)?/)!;
      push('number', i + m[0].length);
    } else if (/[\w$@#:]/.test(c)) {
      const m = rest.match(/^[\w$@#:.]+/)!;
      push('word', i + m[0].length);
    } else {
      const m = rest.match(/^(<>|<=|>=|!=|::|\|\||.)/)!;
      push('punct', i + m[0].length);
    }
  }
  return tokens;
};

const SPACED_BEFORE_PAREN = new Set(
  'in values as on and or not exists from join where into select using over with all any'.split(
    ' ',
  ),
);

const isKeyword = (t: SqlToken) =>
  t.type === 'word' && KEYWORDS.has(t.text.toLowerCase());

// Clauses that start a new line, longest first (multi-word ones)
const CLAUSES = [
  'insert into',
  'delete from',
  'group by',
  'order by',
  'partition by',
  'union all',
  'left outer join',
  'right outer join',
  'full outer join',
  'left join',
  'right join',
  'inner join',
  'full join',
  'cross join',
  'on conflict',
  'select',
  'from',
  'where',
  'having',
  'limit',
  'offset',
  'join',
  'union',
  'intersect',
  'except',
  'values',
  'update',
  'set',
  'returning',
  'with',
].map((c) => c.split(' '));

/** Upper-cases keywords and puts each clause on its own line. Strings/comments untouched. */
export const formatSql = (sql: string, indent = '  ') => {
  const tokens = tokenizeSql(sql).filter((t) => t.type !== 'space');
  const out: string[] = [];
  let line = '';
  let depth = 0; // parentheses
  let clause = '';
  const newLine = (extra = 0) => {
    if (line.trim()) out.push(line.replace(/\s+$/, ''));
    line = indent.repeat(Math.max(0, depth + extra));
  };
  const append = (text: string, glue = true) => {
    const noSpaceBefore =
      /^[,);.]$/.test(text) || line.endsWith('(') || line.endsWith('.');
    line += (glue && line.trim() && !noSpaceBefore ? ' ' : '') + text;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    // Multi-word clause starting here?
    const words = tokens
      .slice(i, i + 3)
      .map((x) => (x.type === 'word' ? x.text.toLowerCase() : ''));
    const match = CLAUSES.find((c) => c.every((w, k) => words[k] === w));
    if (match) {
      newLine();
      append(match.join(' ').toUpperCase(), false);
      clause = match.join(' ');
      i += match.length - 1;
      // select lists / set lists / values go one item per line
      if (
        ['select', 'set', 'group by', 'order by', 'returning'].includes(clause)
      ) {
        newLine(1);
      }
    } else if (
      t.type === 'word' &&
      /^(and|or)$/i.test(t.text) &&
      ['where', 'having', 'on'].includes(clause)
    ) {
      newLine(1);
      append(t.text.toUpperCase(), false);
    } else if (
      t.type === 'word' &&
      t.text.toLowerCase() === 'on' &&
      clause.endsWith('join')
    ) {
      newLine(1);
      append('ON', false);
      clause = 'on';
    } else if (t.text === ',') {
      append(',');
      if (
        depth === 0 &&
        ['select', 'set', 'group by', 'order by', 'returning'].includes(clause)
      ) {
        newLine(1);
      }
    } else if (t.text === '(') {
      // Function calls hug their bracket: COUNT(x), but IN (...), VALUES (...)
      const prev = tokens[i - 1];
      const call =
        prev &&
        (prev.type === 'word' || prev.type === 'ident') &&
        !SPACED_BEFORE_PAREN.has(prev.text.toLowerCase());
      if (call) line += '(';
      else append('(');
      depth += 1;
    } else if (t.text === ')') {
      depth = Math.max(0, depth - 1);
      append(')');
    } else if (t.text === ';') {
      append(';');
      newLine();
      out.push('');
      clause = '';
    } else if (t.type === 'comment') {
      if (t.text.startsWith('--')) {
        append(t.text);
        newLine();
      } else append(t.text);
    } else {
      append(isKeyword(t) ? t.text.toUpperCase() : t.text);
    }
  }
  newLine();
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/** One line, single spaces, comments dropped. */
export const minifySql = (sql: string) =>
  tokenizeSql(sql)
    .filter((t) => t.type !== 'comment')
    .map((t) => (t.type === 'space' ? ' ' : t.text))
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+([,)])/g, '$1')
    .trim();

/** Normalised form for comparing: formatted, keywords upper-cased, comments optional. */
export const normalizeSql = (sql: string, dropComments = false) =>
  formatSql(
    dropComments
      ? tokenizeSql(sql)
          .filter((t) => t.type !== 'comment')
          .map((t) => t.text)
          .join('')
      : sql,
  );

export type SqlCheck =
  | { ok: true }
  | { ok: false; error: string; line: number };

/** Unbalanced brackets or an unterminated string / quoted name / comment. */
export const checkSql = (sql: string): SqlCheck => {
  const lineAt = (index: number) => sql.slice(0, index).split('\n').length;
  const stack: number[] = [];
  let index = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const t of tokenizeSql(sql)) {
    if (t.type === 'string' || t.type === 'ident') {
      const close = t.text[0] === '[' ? ']' : t.text[0];
      if (t.text.length < 2 || !t.text.endsWith(close)) {
        return {
          ok: false,
          error: 'Unterminated string or quoted name',
          line: lineAt(index),
        };
      }
    }
    if (
      t.type === 'comment' &&
      t.text.startsWith('/*') &&
      !t.text.endsWith('*/')
    ) {
      return {
        ok: false,
        error: 'Unterminated /* comment',
        line: lineAt(index),
      };
    }
    if (t.text === '(') stack.push(index);
    if (t.text === ')') {
      if (!stack.length)
        return { ok: false, error: 'Unexpected )', line: lineAt(index) };
      stack.pop();
    }
    index += t.text.length;
  }
  if (stack.length) {
    return {
      ok: false,
      error: 'Missing )',
      line: lineAt(stack[stack.length - 1]),
    };
  }
  return { ok: true };
};

/**
 * Best-effort SQL fix: closes an unterminated string / quoted name / block comment,
 * removes unmatched ")" and adds missing ones, drops a dangling comma before FROM / WHERE /
 * ")" / the end, then formats. Returns what changed.
 */
export const repairSql = (input: string) => {
  const fixes = new Set<string>();
  const tokens = tokenizeSql(input);
  const out: string[] = [];
  let depth = 0;
  tokens.forEach((t) => {
    let { text } = t;
    if (t.type === 'string' || t.type === 'ident') {
      const close = text[0] === '[' ? ']' : text[0];
      if (text.length < 2 || !text.endsWith(close)) {
        text += close;
        fixes.add('Closed an unterminated string');
      }
    }
    if (t.type === 'comment' && text.startsWith('/*') && !text.endsWith('*/')) {
      text += ' */';
      fixes.add('Closed a block comment');
    }
    if (text === '(') depth += 1;
    if (text === ')') {
      if (depth === 0) {
        fixes.add('Removed an unmatched )');
        return;
      }
      depth -= 1;
    }
    out.push(text);
  });
  let sql = out.join('');
  if (depth > 0) {
    sql = sql.replace(
      /\s*;?\s*$/,
      (end) => `${')'.repeat(depth)}${end.includes(';') ? ';' : ''}`,
    );
    fixes.add(`Added ${depth} missing )`);
  }
  const before = sql;
  sql = sql
    .replace(
      /,(\s*)(from|where|group\s+by|order\s+by|having|limit|\))/gi,
      '$1$2',
    )
    .replace(/,\s*;?\s*$/, '');
  if (sql !== before) fixes.add('Removed dangling commas');
  const formatted = formatSql(sql);
  if (formatted.trim() !== input.trim() && !fixes.size) fixes.add('Formatted');
  return { ok: checkSql(formatted).ok, text: formatted, fixes: [...fixes] };
};
