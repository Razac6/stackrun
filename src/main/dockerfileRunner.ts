// "From Dockerfile": build an image from a Dockerfile (log streamed to the window) and
// start a container of it - replacing the previous container of the same recipe.
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { dialog, IpcMain, WebContents } from 'electron';
import { baseEnv } from './docker';
import {
  buildArgs,
  DockerfileRecipe,
  recipeProblem,
  runArgs,
} from './dockerfileTools';

const building = new Map<string, ChildProcess>();

const docker = (
  args: string[],
  onLine?: (line: string) => void,
  key?: string,
  timeoutMs = 30 * 60 * 1000,
): Promise<{ code: number | null; out: string; err: string }> =>
  new Promise((resolve) => {
    const child = spawn('docker', args, {
      env: { ...baseEnv(), DOCKER_BUILDKIT: '1', BUILDKIT_PROGRESS: 'plain' },
      windowsHide: true,
    });
    if (key) building.set(key, child);
    let out = '';
    let err = '';
    let partial = '';
    const feed = (d: Buffer, isErr: boolean) => {
      const text = d.toString();
      if (isErr) err += text;
      else out += text;
      if (!onLine) return;
      partial += text;
      const lines = partial.split(/\r?\n/);
      partial = lines.pop() || '';
      lines.forEach((l) => onLine(l));
    };
    child.stdout.on('data', (d) => feed(d, false));
    child.stderr.on('data', (d) => feed(d, true));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (e) => {
      err += e.message;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (partial && onLine) onLine(partial);
      if (key) building.delete(key);
      resolve({ code, out, err });
    });
  });

const lastLines = (text: string, n = 6) =>
  text.trim().split(/\r?\n/).slice(-n).join('\n');

export const upFromDockerfile = async (
  sender: WebContents | null,
  recipe: DockerfileRecipe,
  rebuild: boolean,
) => {
  const log = (line: string) => {
    if (sender && !sender.isDestroyed())
      sender.send('dockerfile:log', { id: recipe.id, line });
  };
  const problem = recipeProblem(recipe);
  if (problem) return { ok: false, error: problem };
  if (!fs.existsSync(recipe.dockerfile))
    return { ok: false, error: `Dockerfile not found: ${recipe.dockerfile}` };

  const hasImage =
    (await docker(['image', 'inspect', '--format', '{{.Id}}', recipe.image]))
      .code === 0;
  if (rebuild || !hasImage) {
    const args = buildArgs(recipe);
    log(`$ docker ${args.join(' ')}`);
    const b = await docker(args, log, recipe.id);
    if (b.code !== 0)
      return {
        ok: false,
        error: `Build failed${b.code === null ? ' (stopped)' : ''}: ${lastLines(b.err || b.out, 3)}`,
      };
    log('── image built ──');
  } else log(`Using the image ${recipe.image} (Rebuild builds it again)`);

  // the recipe owns its container name: the old one goes
  const old = await docker([
    'ps',
    '-aq',
    '--filter',
    `name=^/${recipe.container}$`,
  ]);
  if (old.out.trim()) {
    log(`$ docker rm -f ${recipe.container}`);
    await docker(['rm', '-f', recipe.container]);
  }
  const args = runArgs(recipe);
  log(`$ docker ${args.join(' ')}`);
  const r = await docker(args, log);
  if (r.code !== 0)
    return { ok: false, error: `docker run failed: ${lastLines(r.err, 3)}` };
  log(`── ${recipe.container} is running ──`);
  return { ok: true, error: null, id: r.out.trim().slice(0, 12) };
};

export const registerDockerfileIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('dockerfile:pick', async (event, current?: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Pick a Dockerfile',
      defaultPath: current ? path.dirname(current) : undefined,
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    return {
      path: file,
      text: fs.readFileSync(file, 'utf-8').slice(0, 200000),
    };
  });
  ipcMain.handle('dockerfile:pick-folder', async (event, current?: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Build context folder',
      defaultPath: current || undefined,
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  ipcMain.handle('dockerfile:read', (event, file: string) => {
    try {
      return fs.readFileSync(String(file), 'utf-8').slice(0, 200000);
    } catch (e) {
      return null;
    }
  });
  ipcMain.handle(
    'dockerfile:up',
    (event, recipe: DockerfileRecipe, rebuild: boolean) =>
      upFromDockerfile(event.sender, recipe, !!rebuild),
  );
  ipcMain.handle('dockerfile:stop-build', (event, id: string) => {
    const child = building.get(String(id));
    if (child) child.kill();
    return !!child;
  });
};
