import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  entriesAt,
  getOutput,
  rerun,
  retryStep,
  startRun,
} from './commandRunner';

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
  it('groups the slots of one entry (a linked package) together', () => {
    const slots = [
      {
        index: 0,
        nest: [
          { parallel: true, index: 0 },
          { parallel: false, index: 0 },
        ],
      },
      {
        index: 1,
        nest: [
          { parallel: true, index: 0 },
          { parallel: false, index: 1 },
        ],
      },
      { index: 2, nest: [{ parallel: true, index: 1 }] },
    ];
    expect(entriesAt(slots, 0).map((e) => e.map((s) => s.index))).toEqual([
      [0, 1],
      [2],
    ]);
  });

  it('runs an async package at once, a sync package inside it in order', async () => {
    // a step that prints "<name>-start", waits, prints "<name>-end"
    const script = path
      .join(os.tmpdir(), 'stackrun-step-test.js')
      .split(path.sep)
      .join('/');
    fs.writeFileSync(
      script,
      "const [n, ms] = process.argv.slice(2); console.log(n + '-start'); setTimeout(() => console.log(n + '-end'), Number(ms));",
    );
    const step = (
      id: string,
      ms: number,
      nest: { parallel: boolean; index: number }[],
    ) => ({
      id,
      name: id,
      command: `node "${script}" ${id} ${ms}`,
      nest,
    });
    const run = startRun(
      [
        // entry 0: a linked sync package (a then b), entry 1: c - next to it
        step('a', 1500, [
          { parallel: true, index: 0 },
          { parallel: false, index: 0 },
        ]),
        step('b', 200, [
          { parallel: true, index: 0 },
          { parallel: false, index: 1 },
        ]),
        step('c', 1500, [{ parallel: true, index: 1 }]),
      ],
      { label: 'async' },
    )!;
    await waitFor(() => /(Done|Failed|Stopped) in/.test(getOutput(run.id)));
    const out = getOutput(run.id);
    expect(out).toContain('Done in');
    const at = (m: string) => out.indexOf(m);
    // c started before a ended (at once), b only after a (in order)
    expect(at('c-start')).toBeGreaterThan(-1);
    expect(at('c-start')).toBeLessThan(at('a-end'));
    expect(at('b-start')).toBeGreaterThan(at('a-end'));
  });

  it('retries a failed step inside its own run, then the steps skipped after it', async () => {
    // fails the first time, works the second (a file marks the first try)
    const mark = path
      .join(os.tmpdir(), `stackrun-retry-${Date.now()}.txt`)
      .split(path.sep)
      .join('/');
    const flaky = path
      .join(os.tmpdir(), 'stackrun-flaky.js')
      .split(path.sep)
      .join('/');
    fs.writeFileSync(
      flaky,
      "const fs = require('fs'); const f = process.argv[2]; if (!fs.existsSync(f)) { fs.writeFileSync(f, '1'); console.log('flaky-fail'); process.exit(2); } console.log('flaky-ok');",
    );
    const run = startRun(
      [
        { id: 'a', name: 'first', command: 'echo one', section: 'Stack' },
        {
          id: 'b',
          name: 'flaky',
          command: `node "${flaky}" "${mark}"`,
          section: 'Stack › DB',
        },
        { id: 'c', name: 'after', command: 'echo after-it', section: 'Stack' },
      ],
      { label: 'stack', groupId: 'g-stack', stopOnError: true },
    )!;
    await waitFor(() => /Failed in/.test(getOutput(run.id)));
    expect(retryStep(run.id, 0)).toBeNull(); // it did not fail
    const again = retryStep(run.id, 1)!;
    expect(again.id).toBe(run.id); // the same run, not a new one
    expect(again.groupId).toBe('g-stack');
    expect(again.status).toBe('running');
    await waitFor(() => /Done in/.test(getOutput(run.id)));
    expect(getOutput(run.id, 1)).toContain('flaky-ok');
    expect(getOutput(run.id, 1)).not.toContain('flaky-fail');
    expect(getOutput(run.id, 2)).toContain('after-it');
    fs.rmSync(mark, { force: true });
  });
});
