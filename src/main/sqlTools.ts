// SQL tool, the pure part: how a query is run inside a database container (psql /
// mysql / mariadb through `docker exec`) and how their output becomes a table.
import type { DbKind } from './dockerTools';

export const SQL_KINDS: DbKind[] = ['postgres', 'mysql', 'mariadb'];

export interface SqlResult {
  ok: boolean;
  columns: string[];
  rows: string[][];
  message: string; // "UPDATE 3", "3 rows affected", an error
  truncated: boolean; // more rows than shown
  timeMs: number;
}

export interface ExecPlan {
  env: Record<string, string>; // for `docker exec -e`
  argv: string[];
  alt?: string[]; // the other client binary (mysql / mariadb)
  stdin: string;
}

/** How to connect: typed in (Connection…) or set by the runner (TCP after a socket error). */
export interface SqlConn {
  user?: string;
  password?: string;
  schema?: string; // postgres: search_path for the query
  tcp?: boolean; // connect to 127.0.0.1 instead of the local socket
  host?: string; // a socket folder ("/tmp") or an address - found when the default fails
  port?: number; // the server's port inside the container, when not the default
}

/** -h / -p for psql, pg_dump, pg_restore. */
const pgWhere = (conn: SqlConn) => [
  ...(conn.host || conn.tcp ? ['-h', conn.host || '127.0.0.1'] : []),
  ...(conn.port ? ['-p', String(conn.port)] : []),
];

/** -h / -P for mysql, mysqldump. */
const myWhere = (conn: SqlConn) =>
  conn.host || conn.tcp || conn.port
    ? [
        '-h',
        conn.host && !conn.host.startsWith('/') ? conn.host : '127.0.0.1',
        '--protocol=TCP',
        ...(conn.port ? ['-P', String(conn.port)] : []),
      ]
    : [];

/** Where to look for the server's socket inside a container. */
export const PG_SOCKET_DIRS = [
  '/var/run/postgresql',
  '/run/postgresql',
  '/tmp',
  '/opt/bitnami/postgresql/tmp',
];

/** The shell line that lists the sockets in those folders (one path per line). */
export const listSocketsScript = (dirs = PG_SOCKET_DIRS) =>
  dirs.map((d) => `ls -a ${d} 2>/dev/null | sed 's|^|${d}/|'`).join('; ');

/** Postgres sockets (".s.PGSQL.5433") in what listSocketsScript printed. */
export const socketsFrom = (listing: string) => {
  const out: { host: string; port: number }[] = [];
  listing.split(/\r?\n/).forEach((line) => {
    const m = /^(\/.*)\/\.s\.PGSQL\.(\d+)$/.exec(line.trim());
    if (m && !out.some((x) => x.host === m[1] && x.port === Number(m[2])))
      out.push({ host: m[1], port: Number(m[2]) });
  });
  return out;
};

/** Ports the server may use instead of the default (env, `-p 5433` / `-c port=…`). */
export const portHints = (
  kind: DbKind,
  env: Record<string, string>,
  cmd: string[] = [],
) => {
  const found: number[] = [];
  const add = (v?: string) => {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0 && n < 65536 && !found.includes(n))
      found.push(n);
  };
  if (kind === 'postgres') {
    add(env.PGPORT);
    add(env.POSTGRESQL_PORT_NUMBER);
    add(env.POSTGRES_PORT);
  } else if (kind === 'mongo') {
    add(env.MONGODB_PORT_NUMBER);
    add(env.MONGO_PORT);
  } else {
    add(env.MYSQL_TCP_PORT);
    add(env.MARIADB_PORT_NUMBER);
    add(env.MYSQL_PORT_NUMBER);
  }
  cmd.forEach((arg, i) => {
    if (arg === '-p' || arg === '--port' || arg === '-P') add(cmd[i + 1]);
    const eq = /^(?:--port=|port=)(\d+)$/.exec(arg);
    if (eq) add(eq[1]);
  });
  return found;
};

/** The client could not reach a server at all (socket or TCP) - not a login / SQL error. */
export const reachProblem = (stderr: string) =>
  socketProblem(stderr) ||
  /connection to server at .* failed|Connection refused|could not connect|Can't connect to (MySQL|MariaDB) server/i.test(
    stderr,
  );

/**
 * Who to log in as, from the container env: the official images (POSTGRES_*, MYSQL_*,
 * MARIADB_*) and Bitnami's (POSTGRESQL_*); what you typed in wins.
 */
export const credentials = (
  kind: DbKind,
  env: Record<string, string>,
  conn: SqlConn = {},
) => {
  let found: { user: string; password: string };
  if (kind === 'postgres') {
    const user =
      env.POSTGRES_USER || env.POSTGRESQL_USERNAME || env.POSTGRESQL_USER || '';
    const password = env.POSTGRES_PASSWORD || env.POSTGRESQL_PASSWORD || '';
    // Bitnami: the admin "postgres" has its own password
    found =
      !user && env.POSTGRESQL_POSTGRES_PASSWORD
        ? { user: 'postgres', password: env.POSTGRESQL_POSTGRES_PASSWORD }
        : { user: user || 'postgres', password };
  } else {
    const get = (k: string) => env[`MARIADB_${k}`] || env[`MYSQL_${k}`] || '';
    const root = get('ROOT_PASSWORD');
    found =
      root || !get('USER')
        ? { user: 'root', password: root }
        : { user: get('USER'), password: get('PASSWORD') };
  }
  return {
    user: conn.user?.trim() || found.user,
    password: conn.user?.trim()
      ? conn.password || ''
      : conn.password || found.password,
  };
};

/** The database to connect to when none is picked yet (listing databases). */
export const defaultDatabase = (kind: DbKind, env: Record<string, string>) =>
  kind === 'postgres'
    ? env.POSTGRES_DB || env.POSTGRESQL_DATABASE || 'postgres'
    : env.MARIADB_DATABASE || env.MYSQL_DATABASE || '';

const SAFE_SCHEMA = /^[A-Za-z_][\w$-]{0,62}$/;

/** A socket that is not where the client looks (Bitnami, custom images): try TCP. */
export const socketProblem = (stderr: string) =>
  /could not connect to server|connection to server on socket|No such file or directory[^\n]*(socket|\.s\.PGSQL)|Can't connect to local (MySQL|MariaDB) server through socket/i.test(
    stderr,
  );

/** A friendlier line for a refused login. */
export const loginHint = (stderr: string) =>
  /password authentication failed|no password supplied|Access denied for user|role "[^"]+" does not exist|authentication failed|requires authentication/i.test(
    stderr,
  )
    ? ' - set the user / password under "Connection…"'
    : '';

/** Statements that give rows back; anything else reports what it changed. */
export const returnsRows = (sql: string) =>
  /^\s*(\(\s*)*(select|with|show|describe|desc|explain|values|table|pragma)\b/i.test(
    sql.replace(/^(\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/))*/, ''),
  );

/**
 * How to run `sql` against database `db` of a container of this kind. `dryRun` runs it
 * in a transaction that is always rolled back: you see the result, nothing is kept
 * (MySQL / MariaDB commit table changes - CREATE / ALTER / DROP - on their own anyway).
 */
export const sqlPlan = (
  kind: DbKind,
  env: Record<string, string>,
  db: string,
  sql: string,
  dryRun = false,
  conn: SqlConn = {},
): ExecPlan | null => {
  const { user, password } = credentials(kind, env, conn);
  if (kind === 'postgres') {
    const path =
      conn.schema && SAFE_SCHEMA.test(conn.schema)
        ? `SET search_path TO "${conn.schema}", public;\n`
        : '';
    const body = dryRun
      ? `${path}BEGIN;\n${sql.trim().replace(/;\s*$/, '')};\nROLLBACK;\n`
      : `${path}${sql}`;
    return {
      env: password ? { PGPASSWORD: password } : {},
      argv: [
        'psql',
        '-X', // no ~/.psqlrc (not -q: it would hide "UPDATE 3")
        ...pgWhere(conn),
        '-U',
        user,
        '-d',
        db || defaultDatabase(kind, env),
        '-v',
        'ON_ERROR_STOP=1',
        '--csv',
        '-P',
        'footer=off',
        '-f',
        '-',
      ],
      stdin: body,
    };
  }
  if (kind === 'mysql' || kind === 'mariadb') {
    const stmt = sql.trim().replace(/;\s*$/, '');
    // a change says how many rows it touched
    let text = returnsRows(stmt)
      ? `${stmt};\n`
      : `${stmt};\nSELECT ROW_COUNT() AS __affected;\n`;
    if (dryRun) text = `START TRANSACTION;\n${text}ROLLBACK;\n`;
    const args = [
      ...myWhere(conn),
      '-u',
      user,
      '--batch',
      '--default-character-set=utf8mb4',
      ...(db ? ['-D', db] : []),
    ];
    return {
      env: password ? { MYSQL_PWD: password } : {},
      argv: [kind === 'mariadb' ? 'mariadb' : 'mysql', ...args],
      alt: [kind === 'mariadb' ? 'mysql' : 'mariadb', ...args],
      stdin: text,
    };
  }
  return null;
};

/** RFC 4180-ish CSV (what `psql --csv` writes). */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
      if (ch === '\r') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
};

/** `mysql --batch`: tab separated, \t \n \\ escaped, NULL as the word. */
export const parseTsv = (text: string): string[][] =>
  text
    .replace(/\r?\n$/, '')
    .split(/\r?\n/)
    .filter((l, i, all) => l !== '' || i < all.length - 1)
    .map((line) =>
      line
        .split('\t')
        .map((c) =>
          c.replace(
            /\\(.)/g,
            (m, x) =>
              ({ t: '\t', n: '\n', '\\': '\\', '0': '\0' })[x as 't'] ?? m,
          ),
        ),
    );

/** psql prints a status ("UPDATE 3", "CREATE TABLE") instead of CSV for changes. */
const PG_STATUS =
  /^(INSERT \d+ \d+|UPDATE \d+|DELETE \d+|MERGE \d+|SELECT \d+|COPY \d+|[A-Z]+( [A-Z]+)*)$/;

export const toResult = (
  kind: DbKind,
  stdout: string,
  maxRows: number,
  timeMs: number,
): SqlResult => {
  const base = { ok: true, truncated: false, timeMs };
  const text = stdout.replace(/\s+$/, '');
  if (!text) return { ...base, columns: [], rows: [], message: 'Done' };
  if (kind === 'postgres') {
    const lines = text.split('\n');
    if (lines.every((l) => PG_STATUS.test(l.trim())))
      return { ...base, columns: [], rows: [], message: lines.join(' · ') };
    const table = parseCsv(`${text}\n`);
    // status lines of earlier statements in a script come before the last table
    while (table.length && table[0].length === 1 && PG_STATUS.test(table[0][0]))
      table.shift();
    // ...and after it (ROLLBACK of a dry run)
    while (
      table.length > 1 &&
      table[table.length - 1].length === 1 &&
      PG_STATUS.test(table[table.length - 1][0])
    )
      table.pop();
    const [columns = [], ...rows] = table;
    return {
      ...base,
      columns,
      rows: rows.slice(0, maxRows),
      truncated: rows.length > maxRows,
      message: `${rows.length} row${rows.length === 1 ? '' : 's'}`,
    };
  }
  const table = parseTsv(text);
  if (table[0]?.[0] === '__affected') {
    const n = Number(table[1]?.[0]) || 0;
    return {
      ...base,
      columns: [],
      rows: [],
      message: `${n} row${n === 1 ? '' : 's'} affected`,
    };
  }
  const [columns = [], ...rows] = table;
  return {
    ...base,
    columns,
    rows: rows.slice(0, maxRows),
    truncated: rows.length > maxRows,
    message: `${rows.length} row${rows.length === 1 ? '' : 's'}`,
  };
};

/** Changes the data / schema (worth a snapshot first). */
export const changesData = (sql: string) =>
  sql.split(';').some((s) => s.trim() && !returnsRows(s));

/** A full copy of one database, made inside the container. */
export const dumpPlan = (
  kind: DbKind,
  env: Record<string, string>,
  db: string,
  conn: SqlConn = {},
): ExecPlan | null => {
  const { user, password } = credentials(kind, env, conn);
  if (kind === 'postgres')
    return {
      env: password ? { PGPASSWORD: password } : {},
      argv: ['pg_dump', ...pgWhere(conn), '-U', user, '-Fc', '--no-owner', db],
      stdin: '',
    };
  if (kind === 'mysql' || kind === 'mariadb') {
    const args = [
      ...myWhere(conn),
      '-u',
      user,
      '--single-transaction',
      '--routines',
      '--triggers',
      '--default-character-set=utf8mb4',
      db,
    ];
    return {
      env: password ? { MYSQL_PWD: password } : {},
      argv: [kind === 'mariadb' ? 'mariadb-dump' : 'mysqldump', ...args],
      alt: [kind === 'mariadb' ? 'mysqldump' : 'mariadb-dump', ...args],
      stdin: '',
    };
  }
  return null;
};

/** Loads a dump into an (emptied) database. */
export const restorePlan = (
  kind: DbKind,
  env: Record<string, string>,
  db: string,
  conn: SqlConn = {},
): ExecPlan | null => {
  const { user, password } = credentials(kind, env, conn);
  if (kind === 'postgres')
    return {
      env: password ? { PGPASSWORD: password } : {},
      argv: [
        'pg_restore',
        ...pgWhere(conn),
        '-U',
        user,
        '-d',
        db,
        '--no-owner',
        '--exit-on-error',
      ],
      stdin: '',
    };
  if (kind === 'mysql' || kind === 'mariadb') {
    const args = [
      ...myWhere(conn),
      '-u',
      user,
      '--default-character-set=utf8mb4',
      db,
    ];
    return {
      env: password ? { MYSQL_PWD: password } : {},
      argv: [kind === 'mariadb' ? 'mariadb' : 'mysql', ...args],
      alt: [kind === 'mariadb' ? 'mysql' : 'mariadb', ...args],
      stdin: '',
    };
  }
  return null;
};

/** Queries for the side panel: databases and tables. */
export const listDatabasesSql = (kind: DbKind) =>
  kind === 'postgres'
    ? 'SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY 1;'
    : 'SHOW DATABASES;';

/** Tables (and views) - for postgres those of one schema, from the catalog (so they
 * all show, not only the ones information_schema lets this user see). */
export const listTablesSql = (kind: DbKind, schema = 'public') =>
  kind === 'postgres'
    ? `SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND n.nspname = '${SAFE_SCHEMA.test(schema) ? schema : 'public'}' ORDER BY 1;`
    : 'SHOW TABLES;';

export const listSchemasSql = () =>
  "SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND nspname NOT LIKE 'pg\\_toast%' AND nspname NOT LIKE 'pg\\_temp%' ORDER BY nspname <> 'public', 1;";

// ---------------- timing a query (compare before / after a change) ----------------
export interface Timing {
  ok: boolean;
  error: string | null;
  method: 'server' | 'roundtrip'; // the database's own clock, or round trips minus a ping
  ms: number; // the median - what is compared
  minMs: number;
  maxMs: number;
  samples: number[];
  overheadMs: number; // docker exec + connecting (roundtrip only)
}

export const median = (list: number[]) => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Postgres: the query wrapped in EXPLAIN ANALYZE (one reading statement only). */
export const explainAnalyzeSql = (sql: string) =>
  `EXPLAIN (ANALYZE, FORMAT JSON) ${sql.trim().replace(/;\s*$/, '')};`;

/** Planning + execution time (ms) from what EXPLAIN (ANALYZE, FORMAT JSON) printed. */
export const explainTime = (json: string): number | null => {
  try {
    const plan = JSON.parse(json)?.[0];
    const exec = Number(plan?.['Execution Time']);
    if (!Number.isFinite(exec)) return null;
    return exec + (Number(plan['Planning Time']) || 0);
  } catch (e) {
    return null;
  }
};

/**
 * How the database itself times one statement, when it can: Postgres EXPLAIN ANALYZE
 * (reads and writes - a write runs rolled back), MySQL 8 EXPLAIN ANALYZE, MariaDB
 * ANALYZE FORMAT=JSON (reads). `read` takes every cell of the result.
 */
export const serverTiming = (
  kind: DbKind,
  sql: string,
): { sql: string; read: (cells: string[]) => number | null } | null => {
  const stmt = sql.trim().replace(/;\s*$/, '');
  if (!stmt || stmt.includes(';')) return null; // one statement only
  const reads =
    returnsRows(stmt) &&
    !/^\s*(show|describe|desc|explain|pragma)\b/i.test(stmt);
  const writes = /^\s*(insert|update|delete|merge)\b/i.test(stmt);
  if (kind === 'postgres' && (reads || writes))
    return {
      sql: explainAnalyzeSql(stmt),
      read: (cells) => {
        const json = cells.find((c) => c.trim().startsWith('['));
        return json ? explainTime(json) : null;
      },
    };
  if (kind === 'mysql' && reads)
    return {
      sql: `EXPLAIN ANALYZE ${stmt};`,
      // the top node of the tree: "(actual time=0.05..12.3 rows=…)"
      read: (cells) => {
        const m = /actual time=[\d.]+\.\.([\d.]+)/.exec(cells.join('\n'));
        return m ? Number(m[1]) : null;
      },
    };
  if (kind === 'mariadb' && reads)
    return {
      sql: `ANALYZE FORMAT=JSON ${stmt};`,
      read: (cells) => {
        const m = /"r_total_time_ms"\s*:\s*([\d.]+)/.exec(cells.join('\n'));
        return m ? Number(m[1]) : null;
      },
    };
  return null;
};
