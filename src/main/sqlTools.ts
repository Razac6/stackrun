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

const credentials = (kind: DbKind, env: Record<string, string>) => {
  if (kind === 'postgres')
    return {
      user: env.POSTGRES_USER || 'postgres',
      password: env.POSTGRES_PASSWORD || '',
    };
  const get = (k: string) => env[`MARIADB_${k}`] || env[`MYSQL_${k}`] || '';
  const root = get('ROOT_PASSWORD');
  if (root || !get('USER')) return { user: 'root', password: root };
  return { user: get('USER'), password: get('PASSWORD') };
};

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
): ExecPlan | null => {
  const { user, password } = credentials(kind, env);
  if (kind === 'postgres') {
    const body = dryRun
      ? `BEGIN;\n${sql.trim().replace(/;\s*$/, '')};\nROLLBACK;\n`
      : sql;
    return {
      env: password ? { PGPASSWORD: password } : {},
      argv: [
        'psql',
        '-X', // no ~/.psqlrc (not -q: it would hide "UPDATE 3")
        '-U',
        user,
        '-d',
        db || user,
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
): ExecPlan | null => {
  const { user, password } = credentials(kind, env);
  if (kind === 'postgres')
    return {
      env: password ? { PGPASSWORD: password } : {},
      argv: ['pg_dump', '-U', user, '-Fc', '--no-owner', db],
      stdin: '',
    };
  if (kind === 'mysql' || kind === 'mariadb') {
    const args = [
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
): ExecPlan | null => {
  const { user, password } = credentials(kind, env);
  if (kind === 'postgres')
    return {
      env: password ? { PGPASSWORD: password } : {},
      argv: [
        'pg_restore',
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
    const args = ['-u', user, '--default-character-set=utf8mb4', db];
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

export const listTablesSql = (kind: DbKind) =>
  kind === 'postgres'
    ? "SELECT CASE WHEN table_schema = 'public' THEN table_name ELSE table_schema || '.' || table_name END FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema <> 'public', 1;"
    : 'SHOW TABLES;';
