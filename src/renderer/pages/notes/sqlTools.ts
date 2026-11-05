// SQL helpers for notes and the compare view: a tokenizer that respects strings, quoted
// identifiers and comments, a readable formatter (keywords upper-cased, one clause per
// line, select lists and conditions indented), a minifier and a light syntax check
// (unbalanced brackets / quotes, with the line).

export type SqlToken = {
  type: 'word' | 'string' | 'ident' | 'comment' | 'number' | 'punct' | 'space';
  text: string;
};

const KEYWORDS = new Set(
  `select from where and or not in is null like ilike similar between exists as on join
  inner left right full outer cross natural using group by order having limit offset fetch
  first last next rows row only union all intersect except distinct insert into values
  update set delete merge create alter drop table view materialized index sequence trigger
  procedure function returns return begin end declare if else elsif case when then with
  recursive primary key foreign references unique check default constraint add column
  rename to asc desc nulls top over partition window cast coalesce count sum avg min max
  true false truncate grant revoke commit rollback transaction lateral returning conflict
  do nothing apply pivot unpivot interval language any some array filter within for each
  share nowait skip locked cascade restrict schema extension type enum replace or
  concurrently tablespace owner execute security definer invoker immutable stable volatile
  strict leakproof parallel safe integer int smallint bigint text varchar char
  character varying boolean bool timestamp timestamptz date time timetz uuid json jsonb
  numeric decimal real double precision serial bigserial bytea zone at local`
    .split(/\s+/)
    .filter(Boolean),
);

// Postgres (and other) multi-character operators, longest first
const OPERATORS = [
  '->>',
  '#>>',
  '!~~*',
  '~~*',
  '!~~',
  '!~*',
  '->',
  '#>',
  '@>',
  '<@',
  '?|',
  '?&',
  '&&',
  '||',
  '::',
  '<>',
  '<=',
  '>=',
  '!=',
  '~~',
  '~*',
  '!~',
  '=>',
  ':=',
  '<<',
  '>>',
];

/** The opening `$tag$` of a Postgres dollar-quoted string at the start of `rest`. */
const dollarTag = (rest: string) => /^\$([A-Za-z_][\w]*)?\$/.exec(rest)?.[0];

export const tokenizeSql = (sql: string): SqlToken[] => {
  const tokens: SqlToken[] = [];
  let i = 0;
  const push = (type: SqlToken['type'], end: number) => {
    tokens.push({ type, text: sql.slice(i, end) });
    i = end;
  };
  const lastSolid = () => {
    for (let k = tokens.length - 1; k >= 0; k -= 1)
      if (tokens[k].type !== 'space') return tokens[k];
    return null;
  };
  while (i < sql.length) {
    const c = sql[i];
    const rest = sql.slice(i);
    const tag = c === '$' ? dollarTag(rest) : undefined;
    if (/\s/.test(c)) {
      const m = rest.match(/^\s+/)!;
      push('space', i + m[0].length);
    } else if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i);
      push('comment', end === -1 ? sql.length : end);
    } else if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', i + 2);
      push('comment', end === -1 ? sql.length : end + 2);
    } else if (tag) {
      // $$ … $$ / $body$ … $body$ - a function body, kept as it is
      const end = sql.indexOf(tag, i + tag.length);
      push('string', end === -1 ? sql.length : end + tag.length);
    } else if (
      c === '[' &&
      /^\[[A-Za-z_][\w ]*\]/.test(rest) &&
      !(
        lastSolid() &&
        (['word', 'ident'].includes(lastSolid()!.type) ||
          [')', ']'].includes(lastSolid()!.text))
      )
    ) {
      // [quoted name] (SQL Server) - but not a subscript like arr[1] / text[]
      push('ident', i + rest.indexOf(']') + 1);
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c) {
          // doubled quote = escaped quote
          if (sql[j + 1] === c) j += 2;
          else break;
        } else j += 1;
      }
      push(c === "'" ? 'string' : 'ident', Math.min(j + 1, sql.length));
    } else if (/\d/.test(c)) {
      const m = rest.match(/^\d+(\.\d+)?([eE][+-]?\d+)?/)!;
      push('number', i + m[0].length);
    } else if (/^\$\d/.test(rest)) {
      push('word', i + rest.match(/^\$\d+/)![0].length); // $1 parameters
    } else if (/^(@@?|#)?[A-Za-z_]/.test(rest)) {
      // names, a.b, schema.table, @var, #temp
      const m = rest.match(
        /^(@@?|#)?[A-Za-z_][\w$]*(\.([A-Za-z_][\w$]*|\*))*/,
      )!;
      push('word', i + m[0].length);
    } else {
      const op = OPERATORS.find((o) => rest.startsWith(o));
      push('punct', i + (op ? op.length : 1));
    }
  }
  return tokens;
};

const SPACED_BEFORE_PAREN = new Set(
  'in values as on and or not exists from join where into select using over with all conflict filter within returns table'.split(
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

const LIST_CLAUSES = ['select', 'set', 'group by', 'order by', 'returning'];

/** Each statement on one line, keywords upper-cased (for short ones). */
const oneLine = (tokens: SqlToken[]) => {
  let out = '';
  let glue = false;
  tokens.forEach((t) => {
    const text = isKeyword(t) ? t.text.toUpperCase() : t.text;
    const tight =
      glue ||
      /^([,);.\]]|::|\[)$/.test(text) ||
      out.endsWith('(') ||
      out.endsWith('.') ||
      (text === '(' &&
        /[\w"`\]]$/.test(out) &&
        !/\b(IN|VALUES|AS|ON|USING|EXISTS|FROM|JOIN|WHERE|INTO|AND|OR|NOT)$/i.test(
          out,
        ));
    out += (out && !tight ? ' ' : '') + text;
    glue = text === '::' || text === '[';
  });
  return out;
};

const SHORT = 72;

/**
 * Upper-cases keywords and puts each clause on its own line; subqueries are indented
 * and close on their own line; a short statement stays on one line. Strings, $$ bodies
 * and comments are left as they are.
 */
export const formatSql = (sql: string, indent = '  ') => {
  const all = tokenizeSql(sql).filter((t) => t.type !== 'space');
  // statement by statement: short ones on one line, the rest laid out
  const statements: SqlToken[][] = [[]];
  all.forEach((t) => {
    statements[statements.length - 1].push(t);
    if (t.text === ';') statements.push([]);
  });
  return statements
    .filter((st) => st.length)
    .map((st) => {
      const flat = oneLine(st);
      const nested =
        st.filter((t) => /^(select|with)$/i.test(t.text)).length > 1;
      const commented = st.some((t) => t.type === 'comment');
      return flat.length <= SHORT && !nested && !commented
        ? flat
        : layout(st, indent);
    })
    .join('\n\n');
};

const layout = (tokens: SqlToken[], indent: string) => {
  const out: string[] = [];
  let line = '';
  // open brackets: a subquery (SELECT …) breaks into lines, anything else stays inline
  const stack: { sub: boolean; clause: string }[] = [];
  let clause = '';
  const depth = () => stack.filter((b) => b.sub).length;
  const inline = () => stack.length > 0 && !stack[stack.length - 1].sub;
  const newLine = (extra = 0) => {
    if (line.trim()) out.push(line.replace(/\s+$/, ''));
    line = indent.repeat(Math.max(0, depth() + extra));
  };
  let glueNext = false; // no space after the previous token (::, [, unary)
  const append = (text: string, glue = true) => {
    const noSpaceBefore =
      glueNext ||
      /^([,);.\]]|::|\[)$/.test(text) ||
      line.endsWith('(') ||
      line.endsWith('.');
    line += (glue && line.trim() && !noSpaceBefore ? ' ' : '') + text;
    glueNext = text === '::' || text === '[';
  };
  const word = (k: number) =>
    tokens[k]?.type === 'word' ? tokens[k].text.toLowerCase() : '';
  /** A comma at this level before the next clause: the list has several items. */
  const hasManyItems = (from: number) => {
    let level = 0;
    for (let k = from; k < tokens.length; k += 1) {
      const x = tokens[k].text;
      if (x === '(') level += 1;
      else if (x === ')') {
        if (level === 0) return false;
        level -= 1;
      } else if (x === ';') return false;
      else if (level === 0 && x === ',') return true;
      else if (
        level === 0 &&
        CLAUSES.some((c) => c.every((w, n) => word(k + n) === w))
      )
        return false;
    }
    return false;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    // Multi-word clause starting here?
    const words = [word(i), word(i + 1), word(i + 2)];
    let match = inline()
      ? undefined
      : CLAUSES.find((c) => c.every((w, k) => words[k] === w));
    // ON CONFLICT … DO UPDATE SET: "DO UPDATE" stays together
    if (match?.join(' ') === 'update' && word(i - 1) === 'do')
      match = undefined;
    if (match) {
      newLine();
      append(match.join(' ').toUpperCase(), false);
      clause = match.join(' ');
      i += match.length - 1;
      // select lists / set lists go one item per line
      if (LIST_CLAUSES.includes(clause) && hasManyItems(i + 1)) newLine(1);
    } else if (
      !inline() &&
      t.type === 'word' &&
      /^(and|or)$/i.test(t.text) &&
      ['where', 'having', 'on'].includes(clause) &&
      // BETWEEN a AND b keeps its AND
      !tokens
        .slice(Math.max(0, i - 4), i)
        .some((x) => x.text.toLowerCase() === 'between')
    ) {
      newLine(1);
      append(t.text.toUpperCase(), false);
    } else if (
      !inline() &&
      t.type === 'word' &&
      t.text.toLowerCase() === 'on' &&
      clause.endsWith('join')
    ) {
      newLine(1);
      append('ON', false);
      clause = 'on';
    } else if (t.text === ',') {
      append(',');
      if (!inline() && clause === 'columns') newLine();
      else if (!inline() && LIST_CLAUSES.includes(clause)) newLine(1);
    } else if (t.text === '(') {
      const sub = ['select', 'with', 'values'].includes(word(i + 1));
      // CREATE TABLE t ( one column per line )
      const cols = !inline() && ['table', 'exists'].includes(word(i - 2));
      // Function calls hug their bracket: COUNT(x), but IN (...), INSERT INTO t (...)
      const prev = tokens[i - 1];
      const call =
        prev &&
        (prev.type === 'word' || prev.type === 'ident') &&
        !SPACED_BEFORE_PAREN.has(prev.text.toLowerCase()) &&
        !['into', 'table', 'exists', 'view'].includes(word(i - 2)) &&
        !(clause === 'insert into' && !inline());
      if (call && !sub && !cols) {
        line += '(';
        glueNext = false;
      } else append('(');
      stack.push({ sub: sub || cols, clause });
      if (cols) clause = 'columns';
      if (sub || cols) newLine();
    } else if (t.text === ')') {
      const open = stack.pop();
      if (open?.sub) {
        newLine();
        line = `${indent.repeat(depth())})`;
        clause = open.clause;
      } else append(')');
    } else if (t.text === ';') {
      append(';');
      stack.length = 0;
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

/** What closes a string / quoted name: ' " ` ] or the $tag$ it opened with. */
const closer = (text: string) =>
  text[0] === '[' ? ']' : text[0] === '$' ? dollarTag(text) || '$$' : text[0];

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
      const close = closer(t.text);
      if (t.text.length < close.length * 2 || !t.text.endsWith(close)) {
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
      const close = closer(text);
      if (text.length < close.length * 2 || !text.endsWith(close)) {
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
