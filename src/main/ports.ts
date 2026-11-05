// "Port in use": who listens on a port, and ending that process (asked in the window
// first). A Docker container publishing the port is reported as such - stop it instead.
import { execFile } from 'child_process';
import type { IpcMain } from 'electron';
import { listContainers } from './docker';
import { PortOwner, parseLsof, parseNetstat, parseTasklist } from './portTools';

const run = (bin: string, args: string[]) =>
  new Promise<string>((resolve) => {
    execFile(
      bin,
      args,
      { windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => resolve(String(stdout || '')),
    );
  });

const commandLine = async (pid: number) => {
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
    ]);
    return out.trim();
  }
  return (await run('ps', ['-o', 'command=', '-p', String(pid)])).trim();
};

export interface PortInfo {
  port: number;
  owners: PortOwner[];
  containers: { id: string; name: string; image: string }[];
  error: string | null;
}

export const whoListens = async (port: number): Promise<PortInfo> => {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return { port, owners: [], containers: [], error: 'Not a port number' };
  let owners: PortOwner[] = [];
  if (process.platform === 'win32') {
    const found = parseNetstat(
      await run('netstat', ['-ano', '-p', 'tcp']),
      port,
    );
    const v6 = parseNetstat(
      await run('netstat', ['-ano', '-p', 'tcpv6']),
      port,
    );
    const all = [
      ...found,
      ...v6.filter((x) => !found.some((f) => f.pid === x.pid)),
    ];
    const names = parseTasklist(await run('tasklist', ['/FO', 'CSV', '/NH']));
    owners = all.map((o) => ({
      pid: o.pid,
      name: names.get(o.pid) || '',
      command: '',
      address: o.address,
    }));
  } else {
    owners = parseLsof(
      await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'pcn']),
    );
  }
  await Promise.all(
    owners.map(async (o) => {
      // eslint-disable-next-line no-param-reassign
      o.command = await commandLine(o.pid);
    }),
  );
  // Docker publishes ports through its own process - say which container it is
  let containers: PortInfo['containers'] = [];
  try {
    const list = await listContainers();
    containers = list.containers
      .filter(
        (c) =>
          c.state === 'running' && c.ports.some((p) => p.hostPort === port),
      )
      .map((c) => ({ id: c.id, name: c.name, image: c.image }));
  } catch (e) {
    containers = [];
  }
  return { port, owners, containers, error: null };
};

/** Ends a process (and its children on Windows). Never this app itself. */
export const killPid = async (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 4 || pid === process.pid)
    return { ok: false, error: 'Not a process that can be ended' };
  if (process.platform === 'win32') {
    const out = await new Promise<{ ok: boolean; text: string }>((resolve) => {
      execFile(
        'taskkill',
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true },
        (err, stdout, stderr) =>
          resolve({
            ok: !err,
            text: String(stderr || stdout || err?.message || ''),
          }),
      );
    });
    return out.ok
      ? { ok: true, error: null }
      : { ok: false, error: out.text.trim() };
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e: any) {
    return {
      ok: false,
      error:
        e?.code === 'EPERM'
          ? 'Not allowed - the process belongs to another user (sudo kill it)'
          : e?.message || String(e),
    };
  }
  // still there after 3 s → SIGKILL
  await new Promise((resolve) => {
    setTimeout(resolve, 3000);
  });
  try {
    process.kill(pid, 0);
    process.kill(pid, 'SIGKILL');
  } catch (e) {
    // gone
  }
  return { ok: true, error: null };
};

export const registerPortIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('ports:who', (e, port: number) => whoListens(Number(port)));
  ipcMain.handle('ports:kill', (e, pid: number) => killPid(Number(pid)));
};
