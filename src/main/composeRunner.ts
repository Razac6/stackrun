// "Compose up": `docker compose up -d` for a compose file, with the output
// streamed to the window (pulls and builds can take a while). Falls back to the old
// `docker-compose` binary when Docker has no compose plugin.
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { dialog, IpcMain, WebContents } from 'electron';
import { baseEnv } from './docker';
import {
  COMPOSE_FILE_RE,
  ComposeRun,
  composeDownArgs,
  composeUpArgs,
  legacyArgs,
  noComposePlugin,
} from './composeTools';

const running = new Map<string, ChildProcess>();

const run = (
  bin: string,
  args: string[],
  cwd: string,
  onLine: (line: string) => void,
  key: string,
  timeoutMs = 30 * 60 * 1000,
): Promise<{ code: number | null; err: string; missing: boolean }> =>
  new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd,
      env: { ...baseEnv(), BUILDKIT_PROGRESS: 'plain', COMPOSE_ANSI: 'never' },
      windowsHide: true,
    });
    running.set(key, child);
    let err = '';
    let partial = '';
    let missing = false;
    const feed = (d: Buffer, isErr: boolean) => {
      const text = d.toString();
      if (isErr) err += text;
      partial += text;
      const lines = partial.split(/\r?\n/);
      partial = lines.pop() || '';
      lines.forEach((l) => onLine(l));
    };
    child.stdout.on('data', (d) => feed(d, false));
    child.stderr.on('data', (d) => feed(d, true));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (e: any) => {
      missing = e?.code === 'ENOENT';
      err += e.message;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (partial) onLine(partial);
      running.delete(key);
      resolve({ code, err, missing });
    });
  });

const lastLines = (text: string, n = 4) =>
  text.trim().split(/\r?\n/).slice(-n).join('\n');

const compose = async (
  sender: WebContents | null,
  recipe: ComposeRun,
  args: string[],
) => {
  const log = (line: string) => {
    if (sender && !sender.isDestroyed())
      sender.send('compose:log', { id: recipe.id, line });
  };
  if (!recipe?.file || !path.isAbsolute(recipe.file))
    return { ok: false, error: 'Pick a compose file' };
  if (!COMPOSE_FILE_RE.test(recipe.file) && !/\.ya?ml$/i.test(recipe.file))
    return { ok: false, error: 'Not a compose file (.yml / .yaml)' };
  if (!fs.existsSync(recipe.file))
    return { ok: false, error: `Compose file not found: ${recipe.file}` };
  const cwd = path.dirname(recipe.file);
  log(`$ docker ${args.join(' ')}`);
  let r = await run('docker', args, cwd, log, recipe.id);
  if (r.code !== 0 && !r.missing && noComposePlugin(r.err)) {
    log('No compose plugin - trying docker-compose');
    r = await run('docker-compose', legacyArgs(args), cwd, log, recipe.id);
  }
  if (r.code === 0) return { ok: true, error: null };
  if (r.missing) return { ok: false, error: 'Docker is not installed' };
  return {
    ok: false,
    error:
      r.code === null
        ? 'Stopped'
        : lastLines(r.err) || `docker compose failed (exit ${r.code})`,
  };
};

export const registerComposeIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('compose:pick', async (event, current?: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Pick a docker compose file',
      defaultPath: current ? path.dirname(current) : undefined,
      properties: ['openFile'],
      filters: [
        { name: 'Compose files', extensions: ['yml', 'yaml'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  ipcMain.handle('compose:up', (event, recipe: ComposeRun) =>
    compose(event.sender, recipe, composeUpArgs(recipe)),
  );
  ipcMain.handle('compose:down', (event, recipe: ComposeRun) =>
    compose(event.sender, recipe, composeDownArgs(recipe)),
  );
  ipcMain.handle('compose:stop', (event, id: string) => {
    const child = running.get(String(id));
    if (child) child.kill();
    return !!child;
  });
};
