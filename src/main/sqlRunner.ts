// SQL tool: runs queries in a database container with its own client (`docker exec -i`),
// so nothing has to be installed on the machine and the container's credentials are used.
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { IpcMain } from 'electron';
import {
  baseEnv,
  inspectContainer,
  listContainers,
  resetDatabase,
} from './docker';
import { DbKind, isSafeContainerRef, isSafeDbName } from './dockerTools';
import {
  mongoDefaultDatabase,
  mongoDumpPlan,
  mongoListCollections,
  mongoListDatabases,
  mongoPlan,
  mongoReachProblem,
  mongoRestorePlan,
  mongoResult,
} from './mongoTools';
import {
  dumpPlan,
  restorePlan,
  ExecPlan,
  listDatabasesSql,
  listSchemasSql,
  loginHint,
  listSocketsScript,
  portHints,
  reachProblem,
  socketsFrom,
  SqlConn,
  defaultDatabase,
  listTablesSql,
  SQL_KINDS,
  SqlResult,
  sqlPlan,
  toResult,
} from './sqlTools';

const MAX_ROWS = 2000;
// what the DB Client works with: the SQL ones and MongoDB
const CLIENT_KINDS: DbKind[] = [...SQL_KINDS, 'mongo'];
const NOT_A_DB = 'Not a Postgres / MySQL / MariaDB / MongoDB container';
const isClientDb = (kind?: DbKind | null): kind is DbKind =>
  !!kind && CLIENT_KINDS.includes(kind);
const running = new Map<string, ChildProcess>();

const fail = (message: string, timeMs = 0): SqlResult => ({
  ok: false,
  columns: [],
  rows: [],
  message,
  truncated: false,
  timeMs,
});

const exec = (
  runId: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    const child = spawn('docker', args, {
      env: baseEnv(),
      windowsHide: true,
    });
    running.set(runId, child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      if (stdout.length < 64 * 1024 * 1024) stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    const timer = setTimeout(() => {
      stderr += `\nNo answer within ${timeoutMs / 1000} s`;
      child.kill();
    }, timeoutMs);
    child.on('error', (e) => {
      stderr += e.message;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      running.delete(runId);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(stdin);
  });

const clean = (stderr: string) =>
  stderr
    .split('\n')
    .map((l) =>
      l.replace(/^(psql|ERROR \d+ \([\w]+\)) ?(at line \d+)?:?\s*/i, ''),
    )
    .filter(
      (l) =>
        l.trim() &&
        !/^\[Warning\]|Using a password on the command line/i.test(l),
    )
    .join('\n')
    .trim();

// A user / password typed in for a container (Connection…), by container name
const logins = new Map<string, { user: string; password: string }>();
export const setLogin = (container: string, user: string, password: string) => {
  if (user.trim()) logins.set(container, { user: user.trim(), password });
  else logins.delete(container);
};
// where a container's server was found when the default socket did not answer
// (another socket folder or port, or TCP) - by container name, tried first next time
const places = new Map<string, Pick<SqlConn, 'host' | 'port' | 'tcp'>>();

/**
 * The container env, with POSTGRES_PASSWORD_FILE & co. read from inside the container
 * (docker secrets), so the login works like the image's own entrypoint.
 */
const containerEnv = async (containerId: string) => {
  const { container, env } = await inspectContainer(containerId);
  const out = { ...env };
  await Promise.all(
    Object.entries(env)
      .filter(([k, v]) => k.endsWith('_FILE') && v && !env[k.slice(0, -5)])
      .map(async ([k, file]) => {
        const r = await exec(
          `file-${containerId}-${k}`,
          ['exec', containerId, 'cat', file],
          '',
          8000,
        );
        if (r.code === 0) out[k.slice(0, -5)] = r.stdout.replace(/\r?\n$/, '');
      }),
  );
  return { container, env: out };
};

const connFor = (name: string, schema?: string): SqlConn => ({
  ...(logins.get(name) || {}),
  schema,
  ...(places.get(name) || {}),
});

const describePlace = (p: Pick<SqlConn, 'host' | 'port' | 'tcp'>) =>
  `${p.host || (p.tcp ? '127.0.0.1' : 'socket')}${p.port ? `:${p.port}` : ''}`;

/**
 * Other places the server may listen on inside the container: its socket files (another
 * folder / port, e.g. `-p 5433` or Bitnami's /opt/bitnami/postgresql/tmp), ports from its
 * env and command, then plain TCP.
 */
const candidatePlaces = async (
  containerId: string,
  kind: string,
  env: Record<string, string>,
) => {
  const out: Pick<SqlConn, 'host' | 'port' | 'tcp'>[] = [];
  const add = (p: Pick<SqlConn, 'host' | 'port' | 'tcp'>) => {
    if (!out.some((x) => describePlace(x) === describePlace(p))) out.push(p);
  };
  if (kind === 'postgres') {
    const ls = await exec(
      `where-${containerId}`,
      ['exec', containerId, 'sh', '-c', listSocketsScript()],
      '',
      8000,
    );
    socketsFrom(ls.stdout).forEach((x) => add(x));
  }
  const cmd = await exec(
    `cmd-${containerId}`,
    ['inspect', '--format', '{{json .Config.Cmd}}', containerId],
    '',
    8000,
  );
  let args: string[] = [];
  try {
    args = (JSON.parse(cmd.stdout || '[]') || []).map(String);
  } catch (e) {
    args = [];
  }
  portHints(kind as any, env, args).forEach((port) =>
    add({ host: '127.0.0.1', port }),
  );
  add({ tcp: true });
  return out;
};

export const runSql = async (
  runId: string,
  containerId: string,
  db: string,
  sql: string,
  timeoutMs: number,
  dryRun: boolean,
  schema: string | undefined,
): Promise<SqlResult> => {
  const started = Date.now();
  if (!isSafeContainerRef(containerId))
    return fail('Pick a database container');
  if (!sql.trim()) return fail('Nothing to run');
  const { container, env } = await containerEnv(containerId);
  if (!isClientDb(container?.db)) return fail(NOT_A_DB);
  if (container.state !== 'running') return fail('Start the container first');
  const kind = container.db;
  const mongo = kind === 'mongo';
  if (mongo && dryRun)
    return fail('MongoDB has no dry run here - turn "Dry run" off');
  const unreachable = (stderr: string) =>
    mongo ? mongoReachProblem(stderr) : reachProblem(stderr);

  const attempt = async (conn: SqlConn) => {
    const plan = mongo
      ? mongoPlan(env, db, sql, MAX_ROWS, conn)
      : sqlPlan(kind, env, db, sql, dryRun, conn);
    if (!plan) return null;
    const envArgs = Object.entries(plan.env).flatMap(([k, v]) => [
      '-e',
      `${k}=${v}`,
    ]);
    let res = await exec(
      runId,
      ['exec', '-i', ...envArgs, containerId, ...plan.argv],
      plan.stdin,
      timeoutMs,
    );
    if (
      res.code !== 0 &&
      plan.alt &&
      /executable file not found|not found in \$PATH|no such file/i.test(
        res.stderr,
      )
    )
      res = await exec(
        runId,
        ['exec', '-i', ...envArgs, containerId, ...plan.alt],
        plan.stdin,
        timeoutMs,
      );
    return res;
  };

  const conn = connFor(container.name, schema);
  let res = await attempt(conn);
  if (!res) return fail('Not supported');
  // the server did not answer where the client looked: find where it listens (another
  // socket folder or port, TCP) and remember it. The first error is the one shown when
  // nothing answers - it says the most.
  let tried: string[] = [];
  if (res.code !== 0 && unreachable(res.stderr)) {
    const first = res;
    places.delete(container.name);
    const base = connFor(container.name, schema);
    const candidates = await candidatePlaces(containerId, kind, env);
    tried = candidates.map(describePlace);
    let found = false;
    // eslint-disable-next-line no-restricted-syntax
    for (const place of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const r = await attempt({ ...base, ...place });
      if (r && (r.code === 0 || !unreachable(r.stderr))) {
        res = r;
        places.set(container.name, place);
        found = true;
        break;
      }
    }
    if (!found) res = first;
  }
  const timeMs = Date.now() - started;
  if (res.code !== 0) {
    const why = clean(res.stderr) || `Failed (exit ${res.code})`;
    const where =
      tried.length && unreachable(res.stderr)
        ? `
The server did not answer on its socket or on ${tried.join(', ')} inside the container - is it still starting, or does it listen somewhere else (listen_addresses, port)?`
        : '';
    return fail(`${why}${loginHint(res.stderr)}${where}`, timeMs);
  }
  const result = mongo
    ? mongoResult(res.stdout, MAX_ROWS, timeMs)
    : toResult(kind, res.stdout, MAX_ROWS, timeMs);
  if (dryRun)
    result.message = `${result.message.replace(/ · ROLLBACK$/, '')} · rolled back, nothing kept`;
  return result;
};

// ---------------- snapshots: a copy of the database to go back to ----------------
let snapshotDir = '';
export const setSnapshotDir = (dir: string) => {
  snapshotDir = dir;
};

/** A saved version of a database - like a commit you can go back to. */
export interface Snapshot {
  file: string; // name in the snapshot folder
  container: string;
  db: string;
  at: number;
  size: number;
  name: string; // "before the users migration"; auto ones: "Before: UPDATE users…"
  auto: boolean; // made by "snapshot before changes"
}

const KEEP_AUTO = 10; // automatic versions kept per container + database (named ones stay)

const metaPath = (file: string) =>
  path.join(snapshotDir, `${path.basename(file)}.json`);
const readMeta = (file: string): { name: string; auto: boolean } => {
  try {
    const m = JSON.parse(fs.readFileSync(metaPath(file), 'utf-8'));
    return { name: String(m.name || ''), auto: !!m.auto };
  } catch (e) {
    return { name: '', auto: false };
  }
};

const safePart = (s: string) => s.replace(/[^\w.-]+/g, '_');

/** Runs a plan with binary stdout / stdin (dumps). */
const execBinary = (
  args: string[],
  input: Buffer | null,
  timeoutMs: number,
): Promise<{ code: number | null; out: Buffer; stderr: string }> =>
  new Promise((resolve) => {
    const child = spawn('docker', args, { env: baseEnv(), windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    const timer = setTimeout(() => {
      stderr += `\nNo answer within ${timeoutMs / 1000} s`;
      child.kill();
    }, timeoutMs);
    child.on('error', (e) => {
      stderr += e.message;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code,
        out: Buffer.concat(chunks.map((c) => new Uint8Array(c))),
        stderr,
      });
    });
    if (input) child.stdin.end(new Uint8Array(input));
    else child.stdin.end();
  });

const runPlan = async (
  containerId: string,
  plan: ExecPlan,
  input: Buffer | null,
  timeoutMs: number,
) => {
  const envArgs = Object.entries(plan.env).flatMap(([k, v]) => [
    '-e',
    `${k}=${v}`,
  ]);
  let res = await execBinary(
    ['exec', '-i', ...envArgs, containerId, ...plan.argv],
    input,
    timeoutMs,
  );
  if (
    res.code !== 0 &&
    plan.alt &&
    /executable file not found|not found in \$PATH|no such file/i.test(
      res.stderr,
    )
  )
    res = await execBinary(
      ['exec', '-i', ...envArgs, containerId, ...plan.alt],
      input,
      timeoutMs,
    );
  return res;
};

export const listSnapshots = (container?: string, db?: string): Snapshot[] => {
  if (!snapshotDir || !fs.existsSync(snapshotDir)) return [];
  return fs
    .readdirSync(snapshotDir)
    .map((file) => {
      const m = /^(.+)__(.+)__(\d+)\.dump$/.exec(file);
      if (!m) return null;
      return {
        file,
        container: m[1],
        db: m[2],
        at: Number(m[3]),
        size: fs.statSync(path.join(snapshotDir, file)).size,
        ...readMeta(file),
      };
    })
    .filter((s): s is Snapshot => !!s)
    .filter(
      (s) =>
        (!container || s.container === safePart(container)) &&
        (!db || s.db === safePart(db)),
    )
    .sort((a, b) => b.at - a.at);
};

export const takeSnapshot = async (
  containerId: string,
  db: string,
  name = '',
  auto = false,
) => {
  if (!isSafeContainerRef(containerId) || !isSafeDbName(db))
    return {
      ok: false,
      error: 'Pick a container and a database',
      snapshot: null,
    };
  const { container, env } = await inspectContainer(containerId);
  if (!container?.db)
    return { ok: false, error: 'Not a database', snapshot: null };
  const conn = connFor(container.name);
  const plan =
    container.db === 'mongo'
      ? mongoDumpPlan(env, db, conn)
      : dumpPlan(container.db, env, db, conn);
  if (!plan) return { ok: false, error: 'Not supported', snapshot: null };
  const res = await runPlan(containerId, plan, null, 10 * 60 * 1000);
  if (res.code !== 0)
    return {
      ok: false,
      error: clean(res.stderr) || 'Dump failed',
      snapshot: null,
    };
  fs.mkdirSync(snapshotDir, { recursive: true });
  const at = Date.now();
  const file = `${safePart(container.name)}__${safePart(db)}__${at}.dump`;
  fs.writeFileSync(path.join(snapshotDir, file), new Uint8Array(res.out));
  fs.writeFileSync(
    metaPath(file),
    JSON.stringify({ name: name.trim().slice(0, 200), auto }),
  );
  // automatic versions: only the last few stay; named ones until you delete them
  listSnapshots(container.name, db)
    .filter((x) => x.auto)
    .slice(KEEP_AUTO)
    .forEach((x) => deleteSnapshot(x.file));
  return {
    ok: true,
    error: null,
    snapshot:
      listSnapshots(container.name, db).find((s) => s.file === file) || null,
  };
};

/** Empties the database and loads the snapshot: back exactly to that moment. */
export const restoreSnapshot = async (
  containerId: string,
  db: string,
  file: string,
) => {
  if (!isSafeContainerRef(containerId) || !isSafeDbName(db))
    return { ok: false, error: 'Pick a container and a database' };
  const full = path.join(snapshotDir, path.basename(file));
  if (!fs.existsSync(full)) return { ok: false, error: 'Snapshot not found' };
  const { container, env } = await inspectContainer(containerId);
  if (!container?.db) return { ok: false, error: 'Not a database' };
  const conn = connFor(container.name);
  const mongo = container.db === 'mongo';
  const plan = mongo
    ? mongoRestorePlan(env, db, conn)
    : restorePlan(container.db, env, db, conn);
  if (!plan) return { ok: false, error: 'Not supported' };
  // empty it first: what was made after the snapshot goes too (mongo: with the login
  // the client uses, not only the official image's root)
  const reset = mongo
    ? await runSql(
        `reset-${containerId}`,
        containerId,
        db,
        'db.dropDatabase()',
        60000,
        false,
        undefined,
      ).then((r) => ({ ok: r.ok, error: r.ok ? null : r.message }))
    : await resetDatabase(containerId, db);
  if (!reset.ok)
    return { ok: false, error: reset.error || 'Could not empty it' };
  const res = await runPlan(
    containerId,
    plan,
    fs.readFileSync(full),
    10 * 60 * 1000,
  );
  if (res.code !== 0)
    return { ok: false, error: clean(res.stderr) || 'Restore failed' };
  return { ok: true, error: null };
};

export function deleteSnapshot(file: string) {
  const full = path.join(snapshotDir, path.basename(file));
  if (fs.existsSync(full)) fs.rmSync(full, { force: true });
  fs.rmSync(metaPath(file), { force: true });
  return true;
}

export const renameSnapshot = (file: string, name: string) => {
  const full = path.join(snapshotDir, path.basename(file));
  if (!fs.existsSync(full)) return false;
  const meta = readMeta(file);
  // a named version is kept like a commit, not rotated away
  fs.writeFileSync(
    metaPath(file),
    JSON.stringify({ ...meta, name: name.trim().slice(0, 200), auto: false }),
  );
  return true;
};

export const cancelSql = (runId: string) => {
  const child = running.get(runId);
  if (child) child.kill();
  return !!child;
};

/** Running database containers the DB Client can use. */
export const sqlTargets = async () => {
  const { containers, error } = await listContainers();
  return {
    error,
    targets: containers
      .filter((c) => isClientDb(c.db))
      .map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.db!,
        running: c.state === 'running',
        project: c.project,
      })),
  };
};

const firstColumn = async (containerId: string, db: string, sql: string) => {
  const r = await runSql(
    `list-${containerId}`,
    containerId,
    db,
    sql,
    20000,
    false,
    undefined,
  );
  return {
    list: r.ok ? r.rows.map((row) => row[0]).filter(Boolean) : [],
    error: r.ok ? null : r.message,
  };
};

/** Databases of a container - and why not, when it cannot connect. */
export const sqlDatabases = async (containerId: string) => {
  const { container, env } = await inspectContainer(containerId);
  if (!isClientDb(container?.db)) return { databases: [], error: NOT_A_DB };
  const mongo = container.db === 'mongo';
  const sql = mongo ? mongoListDatabases : listDatabasesSql(container.db);
  let r = await firstColumn(
    containerId,
    mongo ? mongoDefaultDatabase(env) : defaultDatabase(container.db, env),
    sql,
  );
  // the default database may not exist: postgres always has "postgres"
  if (r.error && container.db === 'postgres' && /does not exist/i.test(r.error))
    r = await firstColumn(containerId, 'postgres', sql);
  return {
    databases: r.list.filter(
      (d) =>
        !['information_schema', 'performance_schema', 'mysql', 'sys'].includes(
          d,
        ),
    ),
    error: r.error,
  };
};

export const sqlSchemas = async (containerId: string, db: string) => {
  const { container } = await inspectContainer(containerId);
  if (container?.db !== 'postgres') return [];
  return (await firstColumn(containerId, db, listSchemasSql())).list;
};

export const sqlTables = async (
  containerId: string,
  db: string,
  schema?: string,
) => {
  const { container } = await inspectContainer(containerId);
  if (!isClientDb(container?.db)) return [];
  return (
    await firstColumn(
      containerId,
      db,
      container.db === 'mongo'
        ? mongoListCollections
        : listTablesSql(container.db, schema),
    )
  ).list;
};

export const registerSqlIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('sql:targets', () => sqlTargets());
  ipcMain.handle('sql:databases', (e, id: string) => sqlDatabases(String(id)));
  ipcMain.handle('sql:schemas', (e, id: string, db: string) =>
    sqlSchemas(String(id), String(db || '')),
  );
  ipcMain.handle('sql:tables', (e, id: string, db: string, schema?: string) =>
    sqlTables(
      String(id),
      String(db || ''),
      schema ? String(schema) : undefined,
    ),
  );
  ipcMain.handle(
    'sql:set-login',
    (e, container: string, user: string, password: string) =>
      setLogin(String(container), String(user || ''), String(password || '')),
  );
  ipcMain.handle(
    'sql:run',
    (
      e,
      runId: string,
      id: string,
      db: string,
      sql: string,
      dryRun?: boolean,
      schema?: string,
    ) =>
      runSql(
        String(runId),
        String(id),
        String(db || ''),
        String(sql || ''),
        120000,
        !!dryRun,
        schema ? String(schema) : undefined,
      ),
  );
  ipcMain.handle('sql:snapshots', (e, container?: string, db?: string) =>
    listSnapshots(container, db),
  );
  ipcMain.handle(
    'sql:snapshot',
    (e, id: string, db: string, name?: string, auto?: boolean) =>
      takeSnapshot(String(id), String(db), String(name || ''), !!auto),
  );
  ipcMain.handle('sql:rename-snapshot', (e, file: string, name: string) =>
    renameSnapshot(String(file), String(name || '')),
  );
  ipcMain.handle('sql:restore', (e, id: string, db: string, file: string) =>
    restoreSnapshot(String(id), String(db), String(file)),
  );
  ipcMain.handle('sql:delete-snapshot', (e, file: string) =>
    deleteSnapshot(String(file)),
  );
  ipcMain.handle('sql:cancel', (e, runId: string) => cancelSql(String(runId)));
};
