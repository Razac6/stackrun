import net from 'net';
import {
  outputMatcher,
  parseHostPort,
  waitUntilReady,
  ReadyContext,
} from './readiness';
import {
  getOutput,
  setContainerProbe,
  startRun,
  stopRun,
  stopStep,
} from './commandRunner';

jest.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
}));
jest.setTimeout(60000);

const isWin = process.platform === 'win32';
const sh = (posix: string, ps: string) => (isWin ? ps : posix);

const ctx = (over: Partial<ReadyContext> = {}): ReadyContext => ({
  output: () => '',
  lastOutputAt: () => null,
  aborted: () => null,
  containerReady: async () => ({ ready: false, detail: 'nope' }),
  pollMs: 20,
  ...over,
});

const waitFor = async (check: () => boolean, ms = 40000) => {
  const end = Date.now() + ms;
  // eslint-disable-next-line no-await-in-loop
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout');
    // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

describe('readiness checks', () => {
  it('parses ports and output matchers', () => {
    expect(parseHostPort('5432')).toEqual({ host: 'localhost', port: 5432 });
    expect(parseHostPort('db:3306')).toEqual({ host: 'db', port: 3306 });
    expect(parseHostPort('[::1]:80')).toEqual({ host: '::1', port: 80 });
    expect(parseHostPort('99999')).toBeNull();
    expect(parseHostPort('abc')).toBeNull();
    expect(outputMatcher('Started App')('... started app in 3 s')).toBe(true);
    expect(outputMatcher('/ready in \\d+ ?ms/i')('VITE Ready in 312 ms')).toBe(
      true,
    );
    expect(outputMatcher('/ready in \\d+ms/')('ready in soon')).toBe(false);
  });

  it('waits for a port to open', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const { port } = server.address() as net.AddressInfo;
    const open = await waitUntilReady(
      { type: 'port', target: `127.0.0.1:${port}`, timeout: 5 },
      ctx(),
    );
    expect(open.ok).toBe(true);
    await new Promise((resolve) => {
      server.close(resolve);
    });
    const closed = await waitUntilReady(
      { type: 'port', target: `127.0.0.1:${port}`, timeout: 1 },
      ctx(),
    );
    expect(closed.ok).toBe(false);
    expect(closed.detail).toMatch(/not ready after 1 s/);
  });

  it('waits for quiet output, a container, and gives up when aborted', async () => {
    const quiet = await waitUntilReady(
      { type: 'quiet', target: '0.05', timeout: 5 },
      ctx({ lastOutputAt: () => Date.now() - 1000 }),
    );
    expect(quiet.ok).toBe(true);
    let calls = 0;
    const container = await waitUntilReady(
      { type: 'container', target: 'db', timeout: 5 },
      ctx({
        containerReady: async () => {
          calls += 1;
          return {
            ready: calls >= 3,
            detail: calls >= 3 ? 'healthy' : 'starting',
          };
        },
      }),
    );
    expect(container).toEqual({ ok: true, detail: 'healthy' });
    const aborted = await waitUntilReady(
      { type: 'output', target: 'never', timeout: 0 },
      ctx({ aborted: () => 'it exited with code 1' }),
    );
    expect(aborted).toEqual({ ok: false, detail: 'it exited with code 1' });
  });
});

describe('commandRunner with "ready when"', () => {
  it('starts the next step only when a background watcher says it is ready', async () => {
    const run = startRun(
      [
        {
          id: 'w',
          name: 'watcher',
          command: sh(
            'echo booting; sleep 1; echo SERVER READY; sleep 30',
            "Write-Output 'booting'; Start-Sleep -Seconds 1; Write-Output 'SERVER READY'; Start-Sleep -Seconds 30",
          ),
          wait: false,
          ready: { type: 'output', target: 'server ready', timeout: 30 },
        },
        { id: 'n', name: 'next', command: 'echo after-ready' },
      ],
      { label: 'watch' },
    )!;
    await waitFor(() => getOutput(run.id).includes('after-ready'));
    const out = getOutput(run.id);
    expect(out.indexOf('SERVER READY')).toBeLessThan(
      out.indexOf('after-ready'),
    );
    expect(out).toContain('ready (line found)');
    stopRun(run.id);
    await waitFor(() => /Stopped in/.test(getOutput(run.id)));
  });

  it('waits for a container after the command ends', async () => {
    let calls = 0;
    setContainerProbe(async () => {
      calls += 1;
      return { ready: calls >= 2, detail: calls >= 2 ? 'healthy' : 'pulling' };
    });
    const run = startRun(
      [
        {
          id: 's',
          name: 'start db',
          command: 'echo started',
          ready: { type: 'container', target: 'db', timeout: 20 },
        },
        { id: 'm', name: 'migrate', command: 'echo migrated' },
      ],
      { label: 'db' },
    )!;
    await waitFor(() => /(Done|Failed) in/.test(getOutput(run.id)));
    expect(getOutput(run.id)).toContain('ready (healthy)');
    expect(getOutput(run.id)).toContain('migrated');
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('fails fast when a background process dies before it is ready', async () => {
    const run = startRun(
      [
        {
          id: 'x',
          name: 'crashes',
          command: sh('echo oops; exit 2', "Write-Output 'oops'; exit 2"),
          wait: false,
          ready: { type: 'output', target: 'listening', timeout: 60 },
        },
        { id: 'y', name: 'never', command: 'echo should-not-run' },
      ],
      { label: 'crash', stopOnError: true },
    )!;
    const started = Date.now();
    await waitFor(() => /(Done|Failed|Stopped) in/.test(getOutput(run.id)));
    expect(Date.now() - started).toBeLessThan(20000);
    expect(getOutput(run.id)).toContain('not ready: it exited with code 2');
    expect(getOutput(run.id)).not.toContain('should-not-run');
  });
});

describe('package ready state and stopping single steps', () => {
  const server = (name: string, line: string) => ({
    id: name,
    name,
    command: sh(
      `echo ${line}; sleep 60`,
      `Write-Output '${line}'; Start-Sleep -Seconds 60`,
    ),
    wait: false,
    ready: { type: 'output' as const, target: line, timeout: 30 },
  });

  it('is ready when everything ran and the servers are up, then Stop ends it', async () => {
    const run = startRun(
      [
        server('api', 'NEST STARTED'),
        { id: 'p', name: 'ping', command: 'echo pinged' },
      ],
      { label: 'dev' },
    )!;
    await waitFor(() => /── Ready in/.test(getOutput(run.id)));
    expect(getOutput(run.id)).toContain('pinged');
    expect(getOutput(run.id)).toContain('1 still running in the background');
    stopRun(run.id);
    await waitFor(() => /Stopped in/.test(getOutput(run.id)));
  });

  it('treats a foreground step that prints its ready line as a server', async () => {
    const run = startRun(
      [
        {
          ...server('nest', 'Nest application successfully started'),
          wait: true,
        },
        { id: 'after', name: 'after', command: 'echo next-step-ran' },
      ],
      { label: 'fg' },
    )!;
    await waitFor(() => /── Ready in/.test(getOutput(run.id)));
    expect(getOutput(run.id)).toContain('keeps running in the background');
    expect(getOutput(run.id)).toContain('next-step-ran');
    stopRun(run.id);
    await waitFor(() => /Stopped in/.test(getOutput(run.id)));
  });

  it('stops one step and goes on with the package', async () => {
    const run = startRun(
      [
        {
          id: 'slow',
          name: 'slow',
          command: sh('sleep 60', 'Start-Sleep -Seconds 60'),
        },
        { id: 'then', name: 'then', command: 'echo went-on' },
      ],
      { label: 'stop-one' },
    )!;
    await waitFor(() => getOutput(run.id).includes('$ '));
    // eslint-disable-next-line no-promise-executor-return
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(stopStep(run.id, 0)).toBe(true);
    await waitFor(() => /(Done|Failed|Stopped) in/.test(getOutput(run.id)));
    expect(getOutput(run.id)).toContain('went-on');
    expect(getOutput(run.id)).toMatch(/Done in/);
  });
});
