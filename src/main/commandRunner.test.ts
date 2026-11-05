import { getOutput, rerun, startRun } from './commandRunner';

jest.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
}));

jest.setTimeout(60000);

const waitFor = async (check: () => boolean, ms = 40000) => {
  const end = Date.now() + ms;
  // eslint-disable-next-line no-await-in-loop
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout');
    // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

describe('commandRunner', () => {
  it('runs a package in order, stops at the failing step, keeps per-step logs and reruns', async () => {
    const run = startRun(
      [
        { id: 'a', name: 'first', command: 'echo hello-a' },
        { id: 'b', name: 'broken', command: 'echo boom-b; exit 3' },
        { id: 'c', name: 'never', command: 'echo hello-c' },
      ],
      { label: 'pkg', stopOnError: true },
    )!;
    expect(run.status).toBe('running');
    // the run object is mutated in place in main; poll the output for the end marker
    await waitFor(() => /(Done|Failed|Stopped) in/.test(getOutput(run.id)));
    const all = getOutput(run.id);
    expect(all).toContain('hello-a');
    expect(all).toContain('boom-b');
    expect(all).not.toContain('hello-c');
    expect(getOutput(run.id, 0)).toContain('hello-a');
    expect(getOutput(run.id, 0)).not.toContain('boom-b');
    expect(getOutput(run.id, 1)).toContain('exited with code 3');

    const again = rerun(run.id, { from: 1 })!;
    expect(again.label).toBe('pkg (from broken)');
    expect(again.steps.map((s) => s.id)).toEqual(['b', 'c']);
    await waitFor(() => /(Done|Failed|Stopped) in/.test(getOutput(again.id)));
    expect(getOutput(again.id)).not.toContain('hello-a');

    const only = rerun(run.id, { only: 2 })!;
    await waitFor(() => /Done in/.test(getOutput(only.id)));
    expect(getOutput(only.id)).toContain('hello-c');
  });

  it('keeps going on errors when asked to', async () => {
    const run = startRun(
      [
        { id: 'x', name: 'fails', command: 'exit 1' },
        { id: 'y', name: 'runs anyway', command: 'echo still-here' },
      ],
      { label: 'go on', stopOnError: false },
    )!;
    await waitFor(() => /(Done|Failed) in/.test(getOutput(run.id)));
    expect(getOutput(run.id)).toContain('still-here');
    expect(getOutput(run.id)).toContain('Failed in');
  });

  it('reports a missing working directory', async () => {
    const run = startRun(
      [
        {
          id: 'z',
          name: 'nowhere',
          command: 'echo hi',
          cwd: '/definitely/not/here-123',
        },
      ],
      { label: 'cwd' },
    )!;
    await waitFor(() => /Failed in/.test(getOutput(run.id)));
    expect(getOutput(run.id, 0)).toContain('Working directory not found');
  });
});
