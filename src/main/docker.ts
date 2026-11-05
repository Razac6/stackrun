// Docker tool (Dev Notes > Docker): talks to the docker CLI, which already knows the
// active context (Docker Desktop, Colima, OrbStack...). Apps started from Finder get a
// minimal PATH, so the usual install locations are added; with Colima the socket is used
// directly when the default context doesn't answer.
import { IpcMain } from 'electron';
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import log from 'electron-log';
import {
  DockerContainer,
  connectionStrings,
  dbHostPort,
  detectDb,
  envToMap,
  isSafeContainerRef,
  parseContainers,
  parseVolumes,
  reclaimedSpace,
  RESETTABLE,
  defaultDbName,
  resetDbPlan,
  resetDbShellCommand,
} from './dockerTools';

const EXTRA_PATHS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  path.join(os.homedir(), '.docker', 'bin'),
  path.join(os.homedir(), '.orbstack', 'bin'),
  '/Applications/Docker.app/Contents/Resources/bin',
  '/usr/bin',
  '/bin',
];

const COLIMA_SOCKET = path.join(
  os.homedir(),
  '.colima',
  'default',
  'docker.sock',
);

let dockerHost: string | null = null; // DOCKER_HOST fallback (Colima socket)

export const baseEnv = () => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (process.platform !== 'win32') {
    const parts = (env.PATH || '').split(':').filter(Boolean);
    EXTRA_PATHS.forEach((p) => {
      if (!parts.includes(p)) parts.push(p);
    });
    env.PATH = parts.join(':');
  }
  if (dockerHost) env.DOCKER_HOST = dockerHost;
  return env;
};

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  missing?: boolean; // binary not found
}

const run = (
  bin: string,
  args: string[],
  timeout = 20000,
): Promise<RunResult> =>
  new Promise((resolve) => {
    execFile(
      bin,
      args,
      {
        env: baseEnv(),
        timeout,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
      (error: any, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: String(stdout || ''),
          stderr: String(stderr || (error && error.message) || ''),
          missing: error?.code === 'ENOENT',
        });
      },
    );
  });

const docker = (args: string[], timeout?: number) =>
  run('docker', args, timeout);

export interface DockerStatus {
  cli: boolean; // docker CLI installed
  engine: boolean; // daemon answers
  version: string | null;
  context: string | null;
  colima: boolean; // colima CLI installed
  colimaRunning: boolean;
  error: string | null;
}

const firstLine = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean) || '';

export const getDockerStatus = async (): Promise<DockerStatus> => {
  let version = await docker(
    ['version', '--format', '{{.Server.Version}}'],
    8000,
  );
  // Colima without its docker context selected: try its socket
  if (
    !version.ok &&
    !version.missing &&
    !dockerHost &&
    !process.env.DOCKER_HOST &&
    fs.existsSync(COLIMA_SOCKET)
  ) {
    dockerHost = `unix://${COLIMA_SOCKET}`;
    version = await docker(
      ['version', '--format', '{{.Server.Version}}'],
      8000,
    );
    if (!version.ok) dockerHost = null;
  }
  const [context, colima] = await Promise.all([
    version.missing ? null : docker(['context', 'show'], 5000),
    process.platform === 'darwin' || process.platform === 'linux'
      ? run('colima', ['status'], 8000)
      : null,
  ]);
  return {
    cli: !version.missing,
    engine: version.ok,
    version: version.ok ? firstLine(version.stdout) : null,
    context: dockerHost
      ? 'colima (socket)'
      : (context?.ok && firstLine(context.stdout)) || null,
    colima: !!colima && !colima.missing,
    colimaRunning: !!colima?.ok,
    error: version.ok ? null : firstLine(version.stderr) || null,
  };
};

export const listContainers = async (): Promise<{
  containers: DockerContainer[];
  error: string | null;
}> => {
  const result = await docker([
    'ps',
    '-a',
    '--no-trunc',
    '--format',
    '{{json .}}',
  ]);
  if (!result.ok) return { containers: [], error: firstLine(result.stderr) };
  return { containers: parseContainers(result.stdout), error: null };
};

const ACTIONS = ['start', 'stop', 'restart', 'pause', 'unpause'] as const;
type ContainerAction = (typeof ACTIONS)[number];

export const containerAction = async (
  ids: string[],
  action: ContainerAction,
) => {
  if (!ACTIONS.includes(action)) return { ok: false, error: 'Unknown action' };
  const safe = ids.filter(isSafeContainerRef);
  if (!safe.length) return { ok: false, error: 'No container' };
  const result = await docker([action, ...safe], 120000);
  return { ok: result.ok, error: result.ok ? null : firstLine(result.stderr) };
};

export const containerLogs = async (id: string, tail = 300) => {
  if (!isSafeContainerRef(id)) return { ok: false, text: '' };
  const lines = Math.max(10, Math.min(5000, Math.round(tail)));
  const result = await docker(
    ['logs', '--tail', String(lines), '--timestamps', id],
    15000,
  );
  if (!result.ok) return { ok: false, text: firstLine(result.stderr) };
  // docker writes the container's stderr to ours - both are the log, sorted by timestamp
  const entries = `${result.stdout}\n${result.stderr}`
    .split('\n')
    .filter((l) => l.trim())
    .sort();
  return { ok: true, text: entries.join('\n') };
};

export const containerConnections = async (id: string) => {
  if (!isSafeContainerRef(id)) return [];
  const [list, inspect] = await Promise.all([
    listContainers(),
    docker(['inspect', '--format', '{{json .Config.Env}}', id], 8000),
  ]);
  const container = list.containers.find(
    (c) => c.id === id.slice(0, 12) || c.name === id,
  );
  if (!container?.db) return [];
  let env: string[] = [];
  try {
    env = JSON.parse(inspect.stdout || '[]') || [];
  } catch (e) {
    env = [];
  }
  return connectionStrings(container.db, envToMap(env), dbHostPort(container));
};

let colimaStarting: Promise<{ ok: boolean; error: string | null }> | null =
  null;

export const startColima = () => {
  if (!colimaStarting) {
    colimaStarting = run('colima', ['start'], 5 * 60000).then((r) => {
      colimaStarting = null;
      if (!r.ok) log.warn('[DOCKER] colima start failed', r.stderr);
      return {
        ok: r.ok,
        error: r.ok
          ? null
          : firstLine(r.stderr.split('\n').reverse().join('\n')),
      };
    });
  }
  return colimaStarting;
};

/**
 * Removes a container. `force` stops a running one first, `anonymousVolumes` = `rm -v`,
 * `volumes` are named volumes to delete afterwards (e.g. a database's data - a reset).
 */
export const removeContainer = async (
  id: string,
  options: {
    force?: boolean;
    anonymousVolumes?: boolean;
    volumes?: string[];
  } = {},
) => {
  if (!isSafeContainerRef(id)) return { ok: false, error: 'No container' };
  const args = ['rm'];
  if (options.force) args.push('-f');
  if (options.anonymousVolumes) args.push('-v');
  const result = await docker([...args, id], 60000);
  if (!result.ok) return { ok: false, error: firstLine(result.stderr) };
  const volumes = (options.volumes || [])
    .map(String)
    .filter(isSafeContainerRef);
  if (volumes.length) {
    const rmVolumes = await docker(['volume', 'rm', ...volumes], 60000);
    if (!rmVolumes.ok) {
      return {
        ok: false,
        error: `Container removed, but: ${firstLine(rmVolumes.stderr)}`,
      };
    }
  }
  return { ok: true, error: null };
};

export const listVolumes = async () => {
  const [volumes, containers] = await Promise.all([
    docker(['volume', 'ls', '--format', '{{json .}}']),
    listContainers(),
  ]);
  if (!volumes.ok) return { volumes: [], error: firstLine(volumes.stderr) };
  return {
    volumes: parseVolumes(volumes.stdout, containers.containers),
    error: null,
  };
};

/** Sizes are slow to compute (docker walks every volume), so they're fetched separately. */
export const listVolumesWithSizes = async () => {
  const [volumes, containers, df] = await Promise.all([
    docker(['volume', 'ls', '--format', '{{json .}}']),
    listContainers(),
    docker(['system', 'df', '-v', '--format', '{{json .}}'], 60000),
  ]);
  if (!volumes.ok) return { volumes: [], error: firstLine(volumes.stderr) };
  return {
    volumes: parseVolumes(
      volumes.stdout,
      containers.containers,
      df.ok ? df.stdout : '',
    ),
    error: null,
  };
};

export const removeVolumes = async (names: string[]) => {
  const safe = names.map(String).filter(isSafeContainerRef);
  if (!safe.length) return { ok: false, error: 'No volume' };
  const result = await docker(['volume', 'rm', ...safe], 60000);
  return { ok: result.ok, error: result.ok ? null : firstLine(result.stderr) };
};

/**
 * Deletes volumes no container uses. Docker 23+ prunes only anonymous ones unless
 * `--all`; `all` asks for named ones too.
 */
export const pruneVolumes = async (all: boolean) => {
  let result = await docker(
    ['volume', 'prune', '-f', ...(all ? ['-a'] : [])],
    120000,
  );
  // older engines don't know -a (and prune named volumes anyway)
  if (
    !result.ok &&
    all &&
    /unknown shorthand flag|unknown flag/i.test(result.stderr)
  ) {
    result = await docker(['volume', 'prune', '-f'], 120000);
  }
  return {
    ok: result.ok,
    error: result.ok ? null : firstLine(result.stderr),
    reclaimed: result.ok ? reclaimedSpace(result.stdout) : null,
  };
};

export const inspectContainer = async (id: string) => {
  const [list, inspect] = await Promise.all([
    listContainers(),
    docker(['inspect', '--format', '{{json .Config.Env}}', id], 8000),
  ]);
  const container = list.containers.find(
    (c) => c.id === id.slice(0, 12) || c.name === id,
  );
  let env: string[] = [];
  try {
    env = JSON.parse(inspect.stdout || '[]') || [];
  } catch (e) {
    env = [];
  }
  return { container, env: envToMap(env) };
};

/** What "Reset database" would do for this container (for the confirm dialog). */
export const resetInfo = async (id: string, dbName?: string) => {
  if (!isSafeContainerRef(id))
    return { supported: false, error: 'No container' };
  const { container, env } = await inspectContainer(id);
  if (!container?.db || !RESETTABLE.includes(container.db)) {
    return { supported: false, error: 'Not a supported database' };
  }
  const name = dbName ?? defaultDbName(container.db, env);
  const plan = resetDbPlan(container.db, env, name);
  return {
    supported: true,
    kind: container.db,
    dbName: name,
    error: plan.error,
    command: plan.error ? '' : resetDbShellCommand(container.name, plan.steps),
  };
};

/** Drops and recreates the database inside the (running) container. */
export const resetDatabase = async (id: string, dbName: string) => {
  if (!isSafeContainerRef(id)) return { ok: false, error: 'No container' };
  const { container, env } = await inspectContainer(id);
  if (!container?.db) return { ok: false, error: 'Not a database container' };
  if (container.state !== 'running') {
    return { ok: false, error: 'Start the container first' };
  }
  const plan = resetDbPlan(container.db, env, dbName);
  if (plan.error) return { ok: false, error: plan.error };
  const output: string[] = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const step of plan.steps) {
    const envArgs = Object.entries(step.env).flatMap(([k, v]) => [
      '-e',
      `${k}=${v}`,
    ]);
    // eslint-disable-next-line no-await-in-loop
    let result = await docker(['exec', ...envArgs, id, ...step.argv], 120000);
    if (
      !result.ok &&
      step.alt &&
      /executable file not found|not found in \$PATH|no such file/i.test(
        result.stderr,
      )
    ) {
      // eslint-disable-next-line no-await-in-loop
      result = await docker(['exec', ...envArgs, id, ...step.alt], 120000);
    }
    output.push(result.stdout.trim());
    if (!result.ok) {
      log.warn('[DOCKER] reset failed', result.stderr);
      return { ok: false, error: firstLine(result.stderr) || 'Reset failed' };
    }
  }
  return { ok: true, error: null, output: output.filter(Boolean).join('\n') };
};

export const registerDockerIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('docker:status', () => getDockerStatus());
  ipcMain.handle('docker:list', () => listContainers());
  ipcMain.handle(
    'docker:action',
    (event, ids: string[], action: ContainerAction) =>
      containerAction(
        Array.isArray(ids) ? ids.map(String) : [String(ids)],
        action,
      ),
  );
  ipcMain.handle('docker:logs', (event, id: string, tail?: number) =>
    containerLogs(String(id), Number(tail) || 300),
  );
  ipcMain.handle('docker:connections', (event, id: string) =>
    containerConnections(String(id)),
  );
  ipcMain.handle('docker:start-colima', () => startColima());
  ipcMain.handle('docker:remove', (event, id: string, options) =>
    removeContainer(String(id), options || {}),
  );
  ipcMain.handle('docker:volumes', (event, withSizes?: boolean) =>
    withSizes ? listVolumesWithSizes() : listVolumes(),
  );
  ipcMain.handle('docker:remove-volumes', (event, names: string[]) =>
    removeVolumes(Array.isArray(names) ? names : [String(names)]),
  );
  ipcMain.handle('docker:reset-info', (event, id: string, dbName?: string) =>
    resetInfo(String(id), typeof dbName === 'string' ? dbName : undefined),
  );
  ipcMain.handle('docker:reset-db', (event, id: string, dbName: string) =>
    resetDatabase(String(id), String(dbName || '')),
  );
  ipcMain.handle('docker:prune-volumes', (event, all?: boolean) =>
    pruneVolumes(!!all),
  );
};

/**
 * Is the container ready to be used? Its healthcheck when it has one; otherwise, for a
 * database image, a real probe inside it (pg_isready, mysqladmin ping, redis-cli ping,
 * mongosh ping); otherwise just "running". A container that doesn't exist yet (image still
 * pulling, compose still creating) is simply "not ready yet".
 */
export const containerReady = async (
  ref: string,
): Promise<{ ready: boolean; detail: string }> => {
  if (!isSafeContainerRef(ref)) return { ready: false, detail: 'bad name' };
  const inspect = await docker(
    [
      'inspect',
      '--format',
      '{{json .State}}|{{.Config.Image}}|{{json .Config.Env}}',
      ref,
    ],
    8000,
  );
  if (!inspect.ok) return { ready: false, detail: 'not created yet' };
  const [stateJson, image, envJson] = inspect.stdout.trim().split('|');
  let state: any = {};
  let env: Record<string, string> = {};
  try {
    state = JSON.parse(stateJson);
    env = envToMap(JSON.parse(envJson || '[]') || []);
  } catch (e) {
    return { ready: false, detail: 'unreadable state' };
  }
  if (state.Status !== 'running') {
    return { ready: false, detail: state.Status || 'not running' };
  }
  if (state.Health?.Status) {
    return {
      ready: state.Health.Status === 'healthy',
      detail: `health: ${state.Health.Status}`,
    };
  }
  const kind = detectDb(image || '');
  const probe = (argv: string[], probeEnv: Record<string, string> = {}) =>
    docker(
      [
        'exec',
        ...Object.entries(probeEnv).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
        ref,
        ...argv,
      ],
      8000,
    );
  let result: Awaited<ReturnType<typeof probe>> | null = null;
  if (kind === 'postgres') {
    result = await probe([
      'pg_isready',
      '-h',
      '127.0.0.1',
      '-U',
      env.POSTGRES_USER || 'postgres',
    ]);
  } else if (kind === 'mysql' || kind === 'mariadb') {
    // TCP on purpose: during init the image runs a temporary server without networking
    const password = env.MARIADB_ROOT_PASSWORD || env.MYSQL_ROOT_PASSWORD || '';
    const args = ['ping', '-h', '127.0.0.1', '-uroot', '--silent'];
    const pwEnv: Record<string, string> = password
      ? { MYSQL_PWD: password }
      : {};
    result = await probe(['mysqladmin', ...args], pwEnv);
    if (!result.ok && /not found|no such file/i.test(result.stderr)) {
      result = await probe(['mariadb-admin', ...args], pwEnv);
    }
  } else if (kind === 'redis') {
    result = await probe(
      ['redis-cli', 'ping'],
      env.REDIS_PASSWORD ? { REDISCLI_AUTH: env.REDIS_PASSWORD } : {},
    );
    if (result.ok && !/PONG/.test(result.stdout)) {
      return { ready: false, detail: result.stdout.trim() || 'no PONG' };
    }
  } else if (kind === 'mongo') {
    const args = ['--quiet', '--eval', 'db.runCommand({ ping: 1 }).ok'];
    result = await probe(['mongosh', ...args]);
    if (!result.ok && /not found|no such file/i.test(result.stderr)) {
      result = await probe(['mongo', ...args]);
    }
  }
  if (!result) return { ready: true, detail: 'running' };
  return {
    ready: result.ok,
    detail: result.ok
      ? `${kind} accepts connections`
      : `${kind} starting (${firstLine(result.stderr || result.stdout) || 'no answer'})`,
  };
};
