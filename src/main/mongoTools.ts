// DB Client, MongoDB (the pure part): a mongosh script run inside the container through
// `docker exec`, whose last expression (a cursor, a document, a count…) becomes a table.
import type { ExecPlan, SqlConn, SqlResult } from './sqlTools';

/** Put before the result line, so warnings mongosh prints do not get in the way. */
export const MARK = '__STACKRUN_RESULT__';

/** Statements that do not give a value: they run, there is nothing to show. */
const NOT_AN_EXPRESSION =
  /^(const|let|var|function|class|if|for|while|do|switch|try|return|throw|import|export|use|show|async\s+function)\b|^\{/;

const CONTINUES_BEFORE = /[,([{+\-*/%&|^!~?:=<>.]$/; // a line ending like this goes on
const CONTINUES_AFTER = /^[.,)\]}+\-*/%&|^?:=<>]/; // a line starting like this goes on

const meaningful = (s: string) =>
  s.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').trim();

/**
 * Where statements end: at `;` or (like JS does) at a new line that does not go on -
 * not inside brackets, strings or comments.
 */
const statementEnds = (code: string) => {
  const ends: number[] = []; // offsets where a statement ends
  let depth = 0;
  let lastChar = ''; // last character that is not space / comment
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];
    if (ch === '/' && next === '/') {
      const nl = code.indexOf('\n', i);
      i = nl < 0 ? code.length : nl;
    } else if (ch === '/' && next === '*') {
      const close = code.indexOf('*/', i + 2);
      i = close < 0 ? code.length : close + 2;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < code.length && code[j] !== ch) j += code[j] === '\\' ? 2 : 1;
      i = j + 1;
      lastChar = ch;
    } else {
      if ('([{'.includes(ch)) depth += 1;
      else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
      if (depth === 0 && ch === ';') ends.push(i);
      else if (depth === 0 && ch === '\n' && lastChar) {
        const rest = code
          .slice(i + 1)
          .replace(/^(\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/, '');
        if (
          rest &&
          !CONTINUES_BEFORE.test(lastChar) &&
          !CONTINUES_AFTER.test(rest)
        )
          ends.push(i);
      }
      if (!/\s/.test(ch)) lastChar = ch;
      i += 1;
    }
  }
  return ends;
};

/** The statements of a script, with their offsets (Ctrl/⌘+Enter runs the one at the cursor). */
export const mongoStatements = (code: string) => {
  const out: { start: number; end: number; text: string }[] = [];
  let start = 0;
  [...statementEnds(code), code.length].forEach((end) => {
    const text = code.slice(start, end);
    if (meaningful(text)) out.push({ start, end, text: text.trim() });
    start = end + 1;
  });
  return out;
};

export const mongoStatementAt = (code: string, offset: number) => {
  const list = mongoStatements(code);
  return (
    list.find((s) => offset >= s.start && offset <= s.end + 1) ||
    [...list].reverse().find((s) => s.start <= offset) ||
    list[0] ||
    null
  );
};

/** The script split into what runs first and its last statement - the one whose value is shown. */
export const splitLast = (code: string): { head: string; last: string } => {
  const list = mongoStatements(code);
  const last = list[list.length - 1];
  return last
    ? { head: code.slice(0, last.start), last: last.text }
    : { head: code, last: '' };
};

/** The script mongosh runs: the user's code, then its last value printed as JSON. */
export const mongoScript = (code: string, maxRows: number) => {
  const { head, last } = splitLast(code);
  const capture = last && !NOT_AN_EXPRESSION.test(meaningful(last));
  return [
    head,
    // on lines of their own: a // comment at its end does not eat the )
    capture ? `let __r = (\n${last}\n);` : `${last}\nlet __r;`,
    'let __out = __r; let __more = false;',
    // a cursor (find, aggregate): its first rows
    `if (__r && typeof __r.hasNext === 'function') { __out = []; while (__out.length < ${maxRows} && __r.hasNext()) __out.push(__r.next()); __more = __r.hasNext(); }`,
    `print('${MARK}' + (typeof EJSON !== 'undefined' ? EJSON.stringify({ v: __out === undefined ? null : __out, more: __more }, { relaxed: true }) : JSON.stringify({ v: __out === undefined ? null : __out, more: __more })));`,
  ].join('\n');
};

/** Who to log in as: the official image (MONGO_INITDB_ROOT_*) or Bitnami's (MONGODB_*). */
export const mongoCredentials = (
  env: Record<string, string>,
  conn: SqlConn = {},
) => {
  if (conn.user?.trim())
    return {
      user: conn.user.trim(),
      password: conn.password || '',
      authDb: 'admin',
    };
  if (env.MONGO_INITDB_ROOT_USERNAME)
    return {
      user: env.MONGO_INITDB_ROOT_USERNAME,
      password: env.MONGO_INITDB_ROOT_PASSWORD || '',
      authDb: 'admin',
    };
  if (env.MONGODB_ROOT_PASSWORD)
    return {
      user: env.MONGODB_ROOT_USER || 'root',
      password: env.MONGODB_ROOT_PASSWORD,
      authDb: 'admin',
    };
  if (env.MONGODB_USERNAME)
    return {
      user: env.MONGODB_USERNAME,
      password: env.MONGODB_PASSWORD || '',
      authDb: env.MONGODB_DATABASE || 'admin',
    };
  return { user: '', password: '', authDb: '' };
};

export const mongoDefaultDatabase = (env: Record<string, string>) =>
  env.MONGO_INITDB_DATABASE || env.MONGODB_DATABASE || 'test';

/** --host / --port and the login, the same for mongosh, mongodump and mongorestore. */
const connArgs = (env: Record<string, string>, conn: SqlConn) => {
  const { user, password, authDb } = mongoCredentials(env, conn);
  return [
    ...(conn.host || conn.tcp || conn.port
      ? [
          '--host',
          conn.host && !conn.host.startsWith('/') ? conn.host : '127.0.0.1',
        ]
      : []),
    ...(conn.port ? ['--port', String(conn.port)] : []),
    ...(user
      ? ['-u', user, '-p', password, '--authenticationDatabase', authDb]
      : []),
  ];
};

export const mongoPlan = (
  env: Record<string, string>,
  db: string,
  code: string,
  maxRows: number,
  conn: SqlConn = {},
): ExecPlan => {
  const args = [
    '--quiet',
    '--norc',
    ...connArgs(env, conn),
    db || mongoDefaultDatabase(env),
    '--eval',
    mongoScript(code, maxRows),
  ];
  // mongosh; the old `mongo` shell in images before 6.0
  return {
    env: {},
    argv: ['mongosh', ...args],
    alt: ['mongo', ...args],
    stdin: '',
  };
};

export const mongoDumpPlan = (
  env: Record<string, string>,
  db: string,
  conn: SqlConn = {},
): ExecPlan => ({
  env: {},
  argv: [
    'mongodump',
    ...connArgs(env, conn),
    '--db',
    db,
    '--archive',
    '--quiet',
  ],
  stdin: '',
});

export const mongoRestorePlan = (
  env: Record<string, string>,
  db: string,
  conn: SqlConn = {},
): ExecPlan => ({
  env: {},
  argv: [
    'mongorestore',
    ...connArgs(env, conn),
    '--archive',
    '--drop',
    '--nsInclude',
    `${db}.*`,
    '--quiet',
  ],
  stdin: '',
});

/** Changes data (worth a snapshot first). */
export const mongoChanges = (code: string) =>
  /\.(insert|update|delete|remove|replace|drop|create|rename|bulkWrite|findOneAnd|findAndModify)\w*\s*\(|\$out\b|\$merge\b/.test(
    code,
  );

/** Could not reach the server at all - not a login / query error. */
export const mongoReachProblem = (stderr: string) =>
  /ECONNREFUSED|MongoNetworkError|MongoServerSelectionError|connect failed|Connection refused|couldn't connect/i.test(
    stderr,
  );

const SCALAR_KEYS = [
  '$oid',
  '$date',
  '$numberLong',
  '$numberDecimal',
  '$numberInt',
  '$numberDouble',
];

/** One value as a cell: ObjectId / Date as their text, documents and arrays as JSON. */
export const mongoCell = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v !== 'object') return String(v);
  const keys = Object.keys(v as object);
  if (keys.length === 1 && SCALAR_KEYS.includes(keys[0])) {
    const inner = (v as any)[keys[0]];
    if (keys[0] === '$date' && inner && typeof inner === 'object')
      return String(
        inner.$numberLong
          ? new Date(Number(inner.$numberLong)).toISOString()
          : JSON.stringify(inner),
      );
    return String(inner);
  }
  return JSON.stringify(v);
};

const isDoc = (v: unknown) =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  mongoCell(v).startsWith('{');

const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;

/** What a write said (insertOne, updateMany, deleteMany…), in a line. */
const writeSummary = (r: Record<string, any>) => {
  if (r.acknowledged === undefined) return null;
  const parts: string[] = [];
  if (r.insertedCount !== undefined)
    parts.push(`${plural(Number(r.insertedCount), 'document')} inserted`);
  else if (r.insertedIds && typeof r.insertedIds === 'object')
    parts.push(
      `${plural(Object.keys(r.insertedIds).length, 'document')} inserted`,
    );
  else if (r.insertedId !== undefined && r.matchedCount === undefined)
    parts.push(`inserted ${mongoCell(r.insertedId)}`);
  if (r.matchedCount !== undefined)
    parts.push(
      `${Number(r.matchedCount)} matched, ${Number(r.modifiedCount || 0)} modified`,
    );
  if (r.upsertedCount) parts.push(`${Number(r.upsertedCount)} upserted`);
  if (r.deletedCount !== undefined)
    parts.push(`${plural(Number(r.deletedCount), 'document')} deleted`);
  return parts.join(' · ') || 'Done';
};

/** mongosh's printed result → the table the client shows. */
export const mongoResult = (
  stdout: string,
  maxRows: number,
  timeMs: number,
): SqlResult => {
  const base = {
    ok: true,
    truncated: false,
    timeMs,
    columns: [] as string[],
    rows: [] as string[][],
  };
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.startsWith(MARK));
  if (!line) return { ...base, message: stdout.trim() || 'Done' };
  let parsed: { v: unknown; more: boolean };
  try {
    parsed = JSON.parse(line.slice(MARK.length));
  } catch (e) {
    return { ...base, message: line.slice(MARK.length) };
  }
  const { v, more } = parsed;
  if (v === null || v === undefined) return { ...base, message: 'Done' };
  if (!Array.isArray(v)) {
    if (isDoc(v)) {
      const summary = writeSummary(v as Record<string, any>);
      if (summary) return { ...base, message: summary };
      const columns = Object.keys(v as object);
      return {
        ...base,
        columns,
        rows: [columns.map((k) => mongoCell((v as any)[k]))],
        message: '1 document',
      };
    }
    return {
      ...base,
      columns: ['value'],
      rows: [[mongoCell(v)]],
      message: '1 value',
    };
  }
  const list = v.slice(0, maxRows);
  const truncated = !!more || v.length > maxRows;
  const count = `${plural(list.length, list.every(isDoc) ? 'document' : 'value')}${truncated ? '+' : ''}`;
  if (!list.length) return { ...base, message: '0 documents' };
  if (!list.every(isDoc))
    return {
      ...base,
      columns: ['value'],
      rows: list.map((x) => [mongoCell(x)]),
      truncated,
      message: count,
    };
  // the columns: every field met, _id first
  const columns: string[] = [];
  list.forEach((d) =>
    Object.keys(d as object).forEach((k) => {
      if (!columns.includes(k)) columns.push(k);
    }),
  );
  if (columns.includes('_id')) {
    columns.splice(columns.indexOf('_id'), 1);
    columns.unshift('_id');
  }
  return {
    ...base,
    columns,
    rows: list.map((d) =>
      columns.map((k) => (k in (d as object) ? mongoCell((d as any)[k]) : '')),
    ),
    truncated,
    message: count,
  };
};

export const mongoListDatabases =
  "db.adminCommand({ listDatabases: 1, nameOnly: true }).databases.map((d) => d.name).filter((n) => !['admin', 'config', 'local'].includes(n)).sort()";

export const mongoListCollections = 'db.getCollectionNames().sort()';

/** What a click on a collection puts in the editor. */
export const mongoBrowse = (collection: string) =>
  /^[A-Za-z_$][\w$]*$/.test(collection)
    ? `db.${collection}.find({}).limit(100)`
    : `db.getCollection(${JSON.stringify(collection)}).find({}).limit(100)`;
