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
import { isSafeContainerRef, isSafeDbName } from './dockerTools';
import {
  dumpPlan,
  restorePlan,
  ExecPlan,
  listDatabasesSql,
  listTablesSql,
  SQL_KINDS,
  SqlResult,
  sqlPlan,
  toResult,
} from './sqlTools';

const MAX_ROWS = 2000;
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

export const runSql = async (
  runId: string,
  containerId: string,
  db: string,
  sql: string,
  timeoutMs = 120000,
  dryRun = false,
): Promise<SqlResult> => {
  const started = Date.now();
  if (!isSafeContainerRef(containerId))
    return fail('Pick a database container');
  if (!sql.trim()) return fail('Nothing to run');
  const { container, env } = await inspectContainer(containerId);
  if (!container?.db || !SQL_KINDS.includes(container.db))
    return fail('Not a Postgres / MySQL / MariaDB container');
  if (container.state !== 'running') return fail('Start the container first');
  const plan = sqlPlan(container.db, env, db, sql, dryRun);
  if (!plan) return fail('Not supported');
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
  const timeMs = Date.now() - started;
  if (res.code !== 0)
    return fail(clean(res.stderr) || `Failed (exit ${res.code})`, timeMs);
  const result = toResult(container.db, res.stdout, MAX_ROWS, timeMs);
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
  const plan = dumpPlan(container.db, env, db);
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
  const plan = restorePlan(container.db, env, db);
  if (!plan) return { ok: false, error: 'Not supported' };
  const reset = await resetDatabase(containerId, db);
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

/** Running database containers the SQL tool can use. */
export const sqlTargets = async () => {
  const { containers, error } = await listContainers();
  return {
    error,
    targets: containers
      .filter((c) => c.db && SQL_KINDS.includes(c.db))
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
  const r = await runSql(`list-${containerId}`, containerId, db, sql, 15000);
  return r.ok ? r.rows.map((row) => row[0]).filter(Boolean) : [];
};

export const sqlDatabases = async (containerId: string) => {
  const { container } = await inspectContainer(containerId);
  if (!container?.db || !SQL_KINDS.includes(container.db)) return [];
  const list = await firstColumn(
    containerId,
    '',
    listDatabasesSql(container.db),
  );
  return list.filter(
    (d) =>
      !['information_schema', 'performance_schema', 'mysql', 'sys'].includes(d),
  );
};

export const sqlTables = async (containerId: string, db: string) => {
  const { container } = await inspectContainer(containerId);
  if (!container?.db || !SQL_KINDS.includes(container.db)) return [];
  return firstColumn(containerId, db, listTablesSql(container.db));
};

export const registerSqlIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('sql:targets', () => sqlTargets());
  ipcMain.handle('sql:databases', (e, id: string) => sqlDatabases(String(id)));
  ipcMain.handle('sql:tables', (e, id: string, db: string) =>
    sqlTables(String(id), String(db || '')),
  );
  ipcMain.handle(
    'sql:run',
    (e, runId: string, id: string, db: string, sql: string, dryRun?: boolean) =>
      runSql(
        String(runId),
        String(id),
        String(db || ''),
        String(sql || ''),
        120000,
        !!dryRun,
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
