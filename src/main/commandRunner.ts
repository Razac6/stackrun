// Dev Notes > Commands: runs the user's own shell commands, one at a time or as an ordered
// package (sequence). Runs live in the main process, so they keep going when the page is
// closed; output and state are streamed to the renderer and kept (capped) for a re-open.
//
// A step's life:
//   pending -> (only run if… -> skipped) -> running -> ok | failed | stopped
//   with "ready when": running -> waiting (it ended, now its container/port...) -> ok
//   background steps: the package goes on once they're up; they keep running
// Stopping kills the step's whole process group (also what it started after its own
// shell exited); a second Stop sends SIGKILL; a process that won't die is given up on
// after a few seconds so nothing stays "running" forever.
import { BrowserWindow, IpcMain, dialog } from 'electron';
import { ChildProcess, spawn, execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  DEFAULT_READY_TIMEOUT,
  ReadyCheck,
  describeReady,
  outputMatcher,
  waitUntilReady,
} from './readiness';
import {
  RunCondition,
  describeCondition,
  exitHint,
  normalizeCondition,
} from './stepOptions';
import {
  ConditionStore,
  changedVerdict,
  fingerprint,
  missingPaths,
} from './conditionCheck';
import { resolveShellEnv } from './shellEnv';

export interface RunStepInput {
  id: string;
  name: string;
  command: string;
  cwd?: string;
  wait?: boolean; // false = start it and go on (dev servers, watchers)
  ready?: ReadyCheck | null; // what the next step waits for
  timeout?: number | null; // s a waited-for step may take before it's killed; 0 = no limit
  when?: RunCondition | null; // run it only if…
  section?: string | null; // the package it comes from inside another: "Stack › DB"
  // where it sits, per package level: its entry and whether that package is async
  // (missing = one plain list, run in order)
  nest?: { parallel: boolean; index: number }[];
}

export type StepStatus =
  | 'pending'
  | 'running'
  | 'waiting' // finished, waiting for its "ready when"
  | 'ok'
  | 'failed'
  | 'stopped'
  | 'skipped';

export interface RunStep {
  id: string;
  name: string;
  command: string;
  section: string | null;
  status: StepStatus;
  code: number | null;
  startedAt: number | null;
  endedAt: number | null;
  background: boolean;
  tail: string; // last lines of its output (shown right under a failed step)
  note: string | null; // why it was skipped / ran, a hint why it failed…
  stopping: boolean; // Stop pressed, not gone yet - pressing again kills it hard
  ready: string | null; // "port 5432 open"...
  readyState: 'waiting' | 'ready' | 'failed' | null;
  readyDetail: string | null; // the latest probe result
  readyAt: number | null; // when it was up (its clock stops there)
}

export interface CommandRun {
  id: string;
  label: string;
  groupId: string | null;
  status: 'running' | 'ok' | 'failed' | 'stopped';
  stopping: boolean;
  startedAt: number;
  endedAt: number | null;
  // everything started and the background steps are ready (they keep running)
  readyAt: number | null;
  // its sequence got to the end (only background steps may still run): a failed step
  // can be retried in place now
  settled: boolean;
  steps: RunStep[];
  output: string;
}

type Outcome = 'ok' | 'failed' | 'stopped';

interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
  gaveUp?: boolean; // it didn't exit after being killed - we stopped waiting
}

/** A spawned process and everything it started (its own process group on macOS). */
interface Proc {
  child: ChildProcess;
  exited: Promise<ExitInfo>;
  done: boolean;
  settle: (info: ExitInfo) => void;
  giveUpTimer?: ReturnType<typeof setTimeout>;
}

const MAX_OUTPUT = 400 * 1024; // per run
const MAX_RUNS = 15;
const MAX_STEPS = 300;
const BACKGROUND_GRACE_MS = 1500; // a background step without "ready when" counts as up
const KILL_GRACE_MS = 4000; // SIGTERM -> SIGKILL
const GIVE_UP_MS = 9000; // after Stop: stop waiting for a process that won't exit
const DRAIN_MS = 800; // after exit: wait this long for the last output
const CHECK_TIMEOUT_MS = 60000; // an "only run if it succeeds" check
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007|\r(?!\n)/g;
const isWin = process.platform === 'win32';

type ContainerProbe = (
  name: string,
) => Promise<{ ready: boolean; detail: string }>;
let containerProbe: ContainerProbe = async () => ({
  ready: false,
  detail: 'docker unavailable',
});
let conditions = new ConditionStore(null);

export interface RunNotice {
  runId: string;
  kind: 'ok' | 'failed' | 'ready';
  title: string;
  body: string;
}
let notifier: (notice: RunNotice) => void = () => {};

const seconds = (ms: number) =>
  ms < 60000
    ? `${(ms / 1000).toFixed(1)} s`
    : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;

/** A desktop notification when a package is done / failed / up (if it asked for one). */
const announce = (run: CommandRun, kind: RunNotice['kind']) => {
  if (!pending.get(run.id)?.notify) return;
  const took = seconds(
    (run.endedAt || run.readyAt || Date.now()) - run.startedAt,
  );
  const failed = run.steps.find((st) => st.status === 'failed');
  const skipped = run.steps.filter((st) => st.status === 'skipped').length;
  const live = run.steps.filter((st) => st.status === 'running').length;
  let notice: RunNotice;
  if (kind === 'failed' && failed) {
    const where = failed.section
      ? `${failed.section} › ${failed.name}`
      : failed.name;
    const why = (failed.tail || '').split('\n').filter(Boolean).pop() || '';
    notice = {
      runId: run.id,
      kind,
      title: `✖ ${run.label} failed`,
      body: `At “${where}”${why ? `: ${why.slice(0, 140)}` : ''}`,
    };
  } else if (kind === 'ready') {
    notice = {
      runId: run.id,
      kind,
      title: `● ${run.label} is ready`,
      body: `Up in ${took} · ${live} running in the background`,
    };
  } else {
    notice = {
      runId: run.id,
      kind: 'ok',
      title: `✓ ${run.label} done`,
      body: `${run.steps.length} step${run.steps.length === 1 ? '' : 's'} in ${took}${skipped ? ` · ${skipped} skipped` : ''}`,
    };
  }
  try {
    notifier(notice);
  } catch (e) {
    // a notification is never worth failing a run for
  }
};

const READY_TYPES = ['container', 'port', 'url', 'output', 'quiet'];
export const normalizeReady = (
  check?: ReadyCheck | null,
): ReadyCheck | null => {
  if (!check || !READY_TYPES.includes(check.type)) return null;
  if (check.type !== 'quiet' && !String(check.target || '').trim()) return null;
  const timeout = Number(check.timeout);
  return {
    type: check.type,
    target: String(check.target || '').trim(),
    timeout:
      Number.isFinite(timeout) && timeout >= 0
        ? timeout
        : DEFAULT_READY_TIMEOUT,
  };
};

const runs = new Map<string, CommandRun>();
const pending = new Map<
  string,
  {
    inputs: RunStepInput[];
    groupId: string | null;
    stopOnError: boolean;
    notify: boolean;
  }
>();
const procs = new Map<string, Proc[]>(); // runId -> every process it started
const stepProcs = new Map<string, Proc>(); // "runId:index" -> the step's current process
const stopRequested = new Set<string>(); // runs
const stepStops = new Set<string>(); // "runId:index" - steps stopped on their own
const chainDone = new Set<string>(); // runs whose sequence reached its end
let counter = 0;

const send = (channel: string, payload: unknown) => {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  });
};

/** A run without its (large) output - what the renderer gets. */
export type RunSnapshot = Omit<CommandRun, 'output'>;
const snapshot = (run: CommandRun): RunSnapshot => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { output, ...rest } = run;
  return rest;
};
const publish = (run: CommandRun) => send('commands:run', snapshot(run));

const stepOutputs = new Map<string, string[]>(); // runId -> output of each step

const cap = (text: string) =>
  text.length > MAX_OUTPUT
    ? `…(trimmed)\n${text.slice(-MAX_OUTPUT * 0.8)}`
    : text;

const lastLines = (text: string, n = 6) =>
  text
    .split('\n')
    .filter((l) => l.trim())
    .slice(-n)
    .join('\n');

const append = (run: CommandRun, text: string, stepIndex?: number) => {
  const clean = text.replace(ANSI, '');
  if (!clean) return;
  run.output = cap(run.output + clean);
  if (stepIndex !== undefined && stepIndex >= 0) {
    const outputs = stepOutputs.get(run.id) || [];
    outputs[stepIndex] = cap((outputs[stepIndex] || '') + clean);
    stepOutputs.set(run.id, outputs);
  }
  send('commands:output', {
    runId: run.id,
    chunk: clean,
    step: stepIndex ?? null,
  });
};

export const getOutput = (runId: string, stepIndex?: number | null) => {
  if (stepIndex === undefined || stepIndex === null) {
    return runs.get(runId)?.output || '';
  }
  return stepOutputs.get(runId)?.[stepIndex] || '';
};

export const expandHome = (dir?: string) => {
  if (!dir) return os.homedir();
  const trimmed = dir.trim();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/'))
    return path.join(os.homedir(), trimmed.slice(2));
  return trimmed;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

// --- processes --------------------------------------------------------------------

// macOS/Linux: the login shell (with the env of the interactive one, see shellEnv), so
// any CLI works the way it does in a terminal. Windows: PowerShell.
const shellFor = (command: string): [string, string[]] => {
  if (isWin) {
    return [
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        command,
      ],
    ];
  }
  return [process.env.SHELL || '/bin/zsh', ['-l', '-c', command]];
};

const stepEnv = async () => ({
  ...(await resolveShellEnv()),
  FORCE_COLOR: '0',
  CLICOLOR: '0',
  // nothing can answer a prompt: fail instead of hanging forever
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  npm_config_yes: 'true', // npx: don't ask "Ok to proceed?"
});

/** Is anything of its process group still alive (macOS/Linux)? */
const groupAlive = (pid?: number) => {
  if (!pid || isWin) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (e) {
    return false;
  }
};

const procAlive = (proc: Proc) => !proc.done || groupAlive(proc.child.pid);

const signalTree = (child: ChildProcess, signal: NodeJS.Signals) => {
  if (!child.pid) return;
  if (isWin) {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    return;
  }
  try {
    process.kill(-child.pid, signal); // the whole group, even if its shell is gone
  } catch (e) {
    try {
      child.kill(signal);
    } catch (err) {
      // already gone
    }
  }
};

/** SIGTERM (then SIGKILL) its process tree; gives up waiting if it still won't exit. */
const terminate = (proc: Proc, force = false) => {
  signalTree(proc.child, force ? 'SIGKILL' : 'SIGTERM');
  if (!force && !isWin) {
    setTimeout(() => {
      if (procAlive(proc)) signalTree(proc.child, 'SIGKILL');
    }, KILL_GRACE_MS);
  }
  if (!proc.giveUpTimer || force) {
    if (proc.giveUpTimer) clearTimeout(proc.giveUpTimer);
    proc.giveUpTimer = setTimeout(
      () => proc.settle({ code: null, signal: null, gaveUp: true }),
      force ? 3000 : GIVE_UP_MS,
    );
  }
};

const startProc = (
  runId: string,
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  onData: (text: string) => void,
): Proc => {
  const [bin, args] = shellFor(command);
  const child = spawn(bin, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'], // no stdin: a prompt gets EOF instead of hanging
    detached: !isWin, // own process group, so Stop kills its children too
    windowsHide: true,
  });
  let resolveExit: (info: ExitInfo) => void = () => {};
  const exited = new Promise<ExitInfo>((resolve) => {
    resolveExit = resolve;
  });
  const proc: Proc = {
    child,
    exited,
    done: false,
    settle: (info) => {
      if (proc.done) return;
      proc.done = true;
      if (proc.giveUpTimer) clearTimeout(proc.giveUpTimer);
      resolveExit(info);
    },
  };
  child.stdout?.on('data', (d: Buffer) => onData(d.toString()));
  child.stderr?.on('data', (d: Buffer) => onData(d.toString()));
  child.once('error', (error) =>
    proc.settle({ code: null, signal: null, error }),
  );
  child.once('exit', (code, signal) => {
    // let the pipes drain; something it started may hold them open forever
    const timer = setTimeout(() => proc.settle({ code, signal }), DRAIN_MS);
    child.once('close', () => {
      clearTimeout(timer);
      proc.settle({ code, signal });
    });
  });
  procs.set(runId, [...(procs.get(runId) || []), proc]);
  return proc;
};

// --- the run ----------------------------------------------------------------------

const conditionKey = (input: RunStepInput, cwd: string) =>
  `${input.id}|${cwd}|${input.when?.target || ''}`;

/** Remember what a "changed" step saw once it ran fine (next time it compares). */
const rememberConditions = (run: CommandRun) => {
  const saved = pending.get(run.id);
  if (!saved) return;
  run.steps.forEach((s, i) => {
    const input = saved.inputs[i];
    if (s.status === 'ok' && input?.when?.type === 'changed') {
      const cwd = expandHome(input.cwd);
      conditions.set(
        conditionKey(input, cwd),
        fingerprint(cwd, input.when.target),
      );
    }
  });
};

const finishRun = (run: CommandRun) => {
  if (run.status !== 'running' || !chainDone.has(run.id)) return;
  const live = run.steps.filter(
    (s) =>
      s.status === 'running' ||
      s.status === 'pending' ||
      s.status === 'waiting',
  );
  if (live.length) {
    // only background processes left and they are up: the package is ready
    const allUp = live.every(
      (s) =>
        s.status === 'running' &&
        s.background &&
        (!s.ready || s.readyState === 'ready'),
    );
    if (allUp && !run.readyAt && !stopRequested.has(run.id)) {
      run.readyAt = Date.now();
      append(
        run,
        `\n── Ready in ${((run.readyAt - run.startedAt) / 1000).toFixed(1)} s · ${live.length} still running in the background (Stop ends ${live.length > 1 ? 'them' : 'it'}) ──\n`,
      );
      rememberConditions(run);
      publish(run);
      announce(run, 'ready');
    }
    return;
  }
  run.endedAt = Date.now();
  if (stopRequested.has(run.id)) run.status = 'stopped';
  else
    run.status = run.steps.some((s) => s.status === 'failed') ? 'failed' : 'ok';
  run.stopping = false;
  if (!run.readyAt) rememberConditions(run);
  stopRequested.delete(run.id);
  chainDone.delete(run.id);
  procs.delete(run.id);
  run.steps.forEach((s, i) => {
    stepProcs.delete(`${run.id}:${i}`);
    stepStops.delete(`${run.id}:${i}`);
  });
  append(
    run,
    `\n── ${run.status === 'ok' ? 'Done' : run.status === 'stopped' ? 'Stopped' : 'Failed'} in ${((run.endedAt - run.startedAt) / 1000).toFixed(1)} s ──\n`,
  );
  publish(run);
  if (run.status === 'failed') announce(run, 'failed');
  // a ready package whose servers later end fine was already announced
  else if (run.status === 'ok' && !run.readyAt) announce(run, 'ok');
};

/**
 * Runs step `index`. Resolves when the package may go on: a waited-for step when it
 * ended (and is ready), a background one when it's up - it keeps running after that.
 */
const runStep = async (
  run: CommandRun,
  index: number,
  input: RunStepInput,
): Promise<Outcome> => {
  const step = run.steps[index];
  const key = `${run.id}:${index}`;
  const stopped = () => stopRequested.has(run.id) || stepStops.has(key);
  const check = input.ready || null;
  const cwd = expandHome(input.cwd);
  const prefix =
    (step.background || input.nest?.some((l) => l.parallel)) &&
    run.steps.length > 1
      ? `[${input.name}] `
      : '';
  const say = (text: string) => append(run, text, index);

  step.status = 'running';
  step.startedAt = Date.now();
  say(
    `${index ? '\n' : ''}▶ ${step.section ? `${step.section} › ` : ''}${input.name}${input.cwd ? `  (${input.cwd})` : ''}\n$ ${input.command}\n`,
  );
  publish(run);

  const end = (status: StepStatus, tail?: string): Outcome => {
    step.status = status;
    step.endedAt = Date.now();
    step.stopping = false;
    if (tail !== undefined) step.tail = tail;
    publish(run);
    if (status === 'failed') return 'failed';
    return status === 'stopped' ? 'stopped' : 'ok';
  };
  const fail = (message: string) => {
    say(`✖ ${message}\n`);
    return end('failed', message);
  };

  let isDir = false;
  try {
    isDir = fs.statSync(cwd).isDirectory();
  } catch (e) {
    isDir = false;
  }
  if (!isDir) return fail(`Working directory not found: ${cwd}`);

  const env = await stepEnv();
  if (stopped()) return end('stopped');

  // --- only run if… ---
  if (input.when) {
    const { when } = input;
    let verdict: { run: boolean; reason: string };
    if (when.type === 'changed') {
      verdict = changedVerdict(
        conditions.get(conditionKey(input, cwd)),
        fingerprint(cwd, when.target),
      );
    } else if (when.type === 'missing') {
      const missing = missingPaths(cwd, when.target);
      verdict = missing.length
        ? { run: true, reason: `${missing.join(', ')} missing` }
        : { run: false, reason: `${when.target} already there` };
    } else {
      say(`? only if \`${when.target}\` succeeds\n`);
      const probe = startProc(run.id, when.target, cwd, env, (t) => say(t));
      stepProcs.set(key, probe);
      const limit = setTimeout(() => terminate(probe), CHECK_TIMEOUT_MS);
      const res = await probe.exited;
      clearTimeout(limit);
      if (stopped()) return end('stopped');
      if (res.code === 0) verdict = { run: true, reason: 'its check passed' };
      else {
        verdict = {
          run: false,
          reason: res.gaveUp
            ? 'its check hung'
            : `its check exited with ${res.code ?? res.signal ?? '?'}`,
        };
      }
    }
    step.note = verdict.reason;
    if (!verdict.run) {
      say(`↷ skipped: ${verdict.reason}\n`);
      return end('skipped');
    }
    say(`→ runs: ${verdict.reason}\n`);
    publish(run);
  }

  // --- the process ---
  let output = ''; // what the process printed (not our own lines)
  let lastOutputAt: number | null = null;
  let watchOutput: (() => void) | null = null;
  let proc: Proc;
  try {
    proc = startProc(run.id, input.command, cwd, env, (text) => {
      lastOutputAt = Date.now();
      output = (output + text.replace(ANSI, '')).slice(-MAX_OUTPUT);
      say(prefix ? text.replace(/^(?=.)/gm, prefix) : text);
      watchOutput?.();
    });
  } catch (e: any) {
    return fail(`Couldn't start it: ${e?.message || e}`);
  }
  stepProcs.set(key, proc);

  // a waited-for step may take this long
  let timedOut = false;
  const limitSeconds = Number(input.timeout) || 0;
  let limit: ReturnType<typeof setTimeout> | null = null;
  if (!step.background && limitSeconds > 0) {
    limit = setTimeout(() => {
      timedOut = true;
      say(`⏱ time limit of ${limitSeconds} s reached - stopping it\n`);
      terminate(proc);
    }, limitSeconds * 1000);
  }

  // decided = its status was set by the ready check (not by how the process ended)
  let decided = false;
  let exitInfo: ExitInfo | null = null;
  const final: Promise<Outcome> = proc.exited.then((info) => {
    if (limit) clearTimeout(limit);
    exitInfo = info;
    step.code = info.code;
    step.tail = lastLines(output);
    if (info.gaveUp) {
      step.note = `it didn't exit after being stopped (pid ${proc.child.pid}) - kill it by hand if it still runs`;
      say(`⚠ ${step.note}\n`);
    } else if (
      !step.background &&
      info.code === 0 &&
      groupAlive(proc.child.pid)
    ) {
      step.note = 'it left processes running in the background';
    }
    if (decided) {
      step.endedAt = step.endedAt || Date.now();
      publish(run);
      return step.status === 'failed' ? 'failed' : 'ok';
    }
    if (stopped()) return end('stopped');
    if (timedOut) {
      const message = `Timed out after ${limitSeconds} s`;
      say(`✖ ${message}\n`);
      return end(
        'failed',
        [message, lastLines(output, 4)].filter(Boolean).join('\n'),
      );
    }
    if (info.code === 0) return 'ok';
    let reason = `exited with code ${info.code ?? '?'}`;
    if (info.error) reason = `couldn't start it: ${info.error.message}`;
    else if (info.signal) reason = `killed by ${info.signal}`;
    const hint = exitHint(info.code, info.signal, output);
    say(`${prefix}✖ ${reason}\n${hint ? `${prefix}  ${hint}\n` : ''}`);
    step.note = hint;
    return end('failed', lastLines(output) || reason);
  });

  const waitReady = async (rc: ReadyCheck) => {
    step.readyState = 'waiting';
    step.readyDetail = null;
    say(`${prefix}… waiting until ${describeReady(rc)}\n`);
    publish(run);
    const result = await waitUntilReady(rc, {
      output: () => output,
      lastOutputAt: () => lastOutputAt,
      aborted: () => {
        if (stopped()) return 'stopped';
        if (!exitInfo) return null;
        // it ended: fatal unless it exited fine and the check is about something
        // else (a container, a port...)
        if (exitInfo.code !== 0) {
          return `it exited with code ${exitInfo.code ?? exitInfo.signal ?? '?'}`;
        }
        if (rc.type === 'output') return 'it ended without printing that';
        return null;
      },
      containerReady: containerProbe,
      onProgress: (detail) => {
        if (detail !== step.readyDetail) {
          step.readyDetail = detail;
          publish(run);
        }
      },
    });
    step.readyState = result.ok ? 'ready' : 'failed';
    step.readyDetail = result.detail;
    if (result.ok) step.readyAt = Date.now();
    say(
      result.ok
        ? `${prefix}✔ ready (${result.detail})\n`
        : `${prefix}✖ not ready: ${result.detail}\n`,
    );
    return result;
  };

  // it ended after the package went on (or while its container check still runs)
  const whenItEnds = () =>
    final.then(() => {
      if (!decided && step.status === 'running') {
        if (step.readyState === 'waiting' && exitInfo?.code === 0) {
          step.status = 'waiting';
        } else if (exitInfo?.code === 0) end('ok');
      }
      publish(run);
      finishRun(run);
      return null;
    });

  // --- background: go on once it's up, it keeps running ---
  if (step.background) {
    whenItEnds();
    if (!check) {
      const first = await Promise.race([
        final,
        sleep(BACKGROUND_GRACE_MS).then(() => null),
      ]);
      if (first) return first === 'ok' ? end('ok') : first;
      if (stopped()) return 'stopped';
      step.readyAt = Date.now(); // no "ready when": started counts as up
      publish(run);
      return 'ok';
    }
    const result = await waitReady(check);
    if (stopped()) {
      if (!proc.done) return 'stopped'; // Stop kills it; `final` records it
      decided = true;
      return end('stopped');
    }
    decided = !result.ok || !!exitInfo;
    if (!result.ok) {
      if (procAlive(proc)) terminate(proc);
      return end('failed', `Not ready: ${result.detail}`);
    }
    // it ended fine already (compose up -d…) and now its container is ready
    if (exitInfo) return end('ok');
    publish(run);
    return 'ok';
  }

  // --- waited for, with "output contains": a server that prints its ready line
  // (nest start, vite…) goes on in the background right then ---
  if (check?.type === 'output') {
    const matches = outputMatcher(check.target);
    const seen = new Promise<'seen'>((resolve) => {
      watchOutput = () => {
        if (matches(output)) resolve('seen');
      };
      watchOutput();
    });
    const first = await Promise.race([final, seen]);
    if (first === 'seen' && !exitInfo && !stopped()) {
      watchOutput = null;
      if (limit) clearTimeout(limit);
      step.background = true;
      step.readyState = 'ready';
      step.readyDetail = 'line found';
      step.readyAt = Date.now();
      say('✔ ready (line found) - it keeps running in the background\n');
      publish(run);
      whenItEnds();
      return 'ok';
    }
  }

  const outcome = await final;
  if (outcome !== 'ok') return outcome;
  if (!check) return end('ok');
  if (check.type === 'quiet') {
    step.readyState = 'ready';
    step.readyDetail = 'done';
    return end('ok');
  }
  if (check.type === 'output') {
    if (outputMatcher(check.target)(output)) {
      step.readyState = 'ready';
      step.readyDetail = 'done';
      return end('ok');
    }
    step.readyState = 'failed';
    step.readyDetail = 'not in the output';
    return fail(`Its output doesn't contain ${check.target}`);
  }
  // it ended fine - now wait for what it started (container healthy, port open...)
  step.status = 'waiting';
  publish(run);
  const result = await waitReady(check);
  if (stopped()) return end('stopped');
  if (!result.ok) return end('failed', `Not ready: ${result.detail}`);
  return end('ok');
};

interface Slot {
  index: number; // in run.steps
  nest: { parallel: boolean; index: number }[];
}

/** Consecutive slots of the same entry at `depth` (a linked package = one entry). */
export const entriesAt = <T extends Slot>(slots: T[], depth: number) => {
  const out: T[][] = [];
  slots.forEach((s) => {
    const last = out[out.length - 1];
    if (last && last[0].nest[depth]?.index === s.nest[depth]?.index)
      last.push(s);
    else out.push([s]);
  });
  return out;
};

const drive = async (
  run: CommandRun,
  stopOnError: boolean,
  only?: Set<number>, // a retry: just these steps
) => {
  const { inputs } = pending.get(run.id)!;
  let failed = false;
  const halted = () => stopRequested.has(run.id) || (failed && stopOnError);

  const runOne = async (i: number) => {
    if (halted()) return;
    let outcome: Outcome;
    try {
      outcome = await runStep(run, i, inputs[i]);
    } catch (e: any) {
      const step = run.steps[i];
      step.status = 'failed';
      step.endedAt = Date.now();
      step.tail = `Internal error: ${e?.message || e}`;
      append(run, `✖ ${step.tail}\n`, i);
      outcome = 'failed';
    }
    if (outcome === 'failed') failed = true;
  };

  // sync package: its entries one after another; async: all at once, done when all are
  // (a step that fails stops what has not started yet - running ones finish)
  const runLevel = async (slots: Slot[], depth: number): Promise<void> => {
    const entries = entriesAt(slots, depth);
    const runEntry = (entry: Slot[]) =>
      entry.length === 1 && entry[0].nest.length <= depth + 1
        ? runOne(entry[0].index)
        : runLevel(entry, depth + 1);
    if (slots[0]?.nest[depth]?.parallel) {
      await Promise.all(entries.map(runEntry));
      return;
    }
    for (let k = 0; k < entries.length; k += 1) {
      if (halted()) break;
      // eslint-disable-next-line no-await-in-loop
      await runEntry(entries[k]);
    }
  };
  await runLevel(
    inputs
      .map((input, index) => ({
        index,
        nest: input.nest?.length ? input.nest : [{ parallel: false, index }],
      }))
      .filter((slot) => !only || only.has(slot.index)),
    0,
  );
  const why = stopRequested.has(run.id) ? 'stopped' : 'an earlier step failed';
  run.steps.forEach((s) => {
    if (s.status === 'pending') {
      s.status = 'skipped';
      s.note = why;
    }
  });
  chainDone.add(run.id);
  run.settled = true;
  publish(run);
  finishRun(run);
};

/**
 * Retries a failed (or stopped / skipped) step inside its own run - the package it
 * belongs to keeps its status and its servers - then the steps skipped because of it.
 * `latest` is the command as saved now, so a fix made after the failure is what runs.
 */
export const retryStep = (
  runId: string,
  index: number,
  latest?: Partial<RunStepInput> | null,
) => {
  const run = runs.get(runId);
  const saved = pending.get(runId);
  const step = run?.steps[index];
  if (!run || !saved || !step || !saved.inputs[index]) return null;
  // while the sequence still goes, the step may still be about to run
  if (!run.settled) return null;
  if (!['failed', 'stopped', 'skipped'].includes(step.status)) return null;
  if (latest && String(latest.command || '').trim()) {
    const input = saved.inputs[index];
    saved.inputs[index] = {
      ...input,
      name: String(latest.name || input.name),
      command: String(latest.command),
      cwd: latest.cwd ?? input.cwd,
      wait: latest.wait ?? input.wait,
      ready: normalizeReady(latest.ready ?? null),
      timeout: Math.max(0, Number(latest.timeout) || 0),
      when: normalizeCondition(latest.when ?? null),
    };
    step.name = saved.inputs[index].name;
    step.command = saved.inputs[index].command;
    step.background = saved.inputs[index].wait === false;
  }
  // this step, then whatever was skipped after it
  const again = new Set<number>([index]);
  run.steps.forEach((s, i) => {
    if (i > index && s.status === 'skipped') again.add(i);
  });
  again.forEach((i) => {
    const s = run.steps[i];
    Object.assign(s, {
      status: 'pending',
      code: null,
      startedAt: null,
      endedAt: null,
      tail: '',
      note: null,
      stopping: false,
      readyState: null,
      readyDetail: null,
      readyAt: null,
    });
    stepStops.delete(`${run.id}:${i}`);
    const outs = stepOutputs.get(run.id);
    if (outs) outs[i] = '';
  });
  // a finished run opens again
  run.status = 'running';
  run.endedAt = null;
  run.stopping = false;
  run.settled = false;
  stopRequested.delete(run.id);
  chainDone.delete(run.id);
  append(run, `\n↻ Retrying ${step.name}\n`);
  publish(run);
  drive(run, saved.stopOnError, again);
  return snapshot(run);
};

export const startRun = (
  inputs: RunStepInput[],
  options: {
    label: string;
    groupId?: string | null;
    stopOnError?: boolean;
    intro?: string; // a line shown before the first step
    notify?: boolean; // a desktop notification when it's done / failed / ready
  },
): RunSnapshot | null => {
  const steps = inputs
    .filter((s) => s && String(s.command || '').trim())
    .slice(0, MAX_STEPS)
    .map((s) => ({
      ...s,
      id: String(s.id),
      name: String(s.name || s.command),
      command: String(s.command),
      ready: normalizeReady(s.ready),
      when: normalizeCondition(s.when),
      timeout: Math.max(0, Number(s.timeout) || 0),
      section: s.section ? String(s.section) : null,
      nest: Array.isArray(s.nest)
        ? s.nest.slice(0, 32).map((l) => ({
            parallel: !!l?.parallel,
            index: Math.max(0, Math.floor(Number(l?.index) || 0)),
          }))
        : undefined,
    }));
  if (!steps.length) return null;
  counter += 1;
  const run: CommandRun = {
    id: `run-${Date.now()}-${counter}`,
    label: String(options.label || steps[0].name),
    groupId: options.groupId || null,
    status: 'running',
    stopping: false,
    startedAt: Date.now(),
    endedAt: null,
    readyAt: null,
    settled: false,
    output: '',
    steps: steps.map((s) => ({
      id: s.id,
      name: s.name,
      command: s.command,
      section: s.section,
      status: 'pending',
      code: null,
      startedAt: null,
      endedAt: null,
      background: s.wait === false,
      tail: '',
      note: s.when ? `only if ${describeCondition(s.when)}` : null,
      stopping: false,
      ready: describeReady(s.ready) || null,
      readyState: null,
      readyDetail: null,
      readyAt: null,
    })),
  };
  runs.set(run.id, run);
  pending.set(run.id, {
    groupId: options.groupId || null,
    stopOnError: options.stopOnError !== false,
    notify: !!options.notify,
    inputs: steps,
  });
  // Keep the newest runs (never drop a running one)
  const finished = [...runs.values()].filter((r) => r.status !== 'running');
  while (runs.size > MAX_RUNS && finished.length) {
    const oldest = finished.shift()!;
    runs.delete(oldest.id);
    pending.delete(oldest.id);
    stepOutputs.delete(oldest.id);
  }
  if (options.intro) append(run, `${options.intro}\n\n`);
  drive(run, options.stopOnError !== false);
  return snapshot(run);
};

/** Is a step (by its section) part of nested package `section` (or deeper inside it)? */
export const inSection = (
  stepSection: string | null | undefined,
  section: string,
) => stepSection === section || !!stepSection?.startsWith(`${section} › `);

/**
 * Runs a finished run again: everything, from step `from` (e.g. the failed one) to the
 * end, only step `only`, or only the nested package `section` (from `from` inside it) -
 * so a package of packages doesn't have to run all over again for one failing part.
 * Uses the commands as they were in that run.
 */
export const rerun = (
  runId: string,
  {
    from,
    only,
    section,
    latest,
  }: {
    from?: number;
    only?: number;
    section?: string;
    // the commands as they are saved now (by id): a fix made after the failure is
    // what runs, not the old copy
    latest?: Record<string, Partial<RunStepInput>>;
  } = {},
) => {
  const run = runs.get(runId);
  const saved = pending.get(runId);
  if (!run || !saved || run.status === 'running') return null;
  let inputs = saved.inputs.map((input, index) => ({ input, index }));
  let label = run.label.replace(/ \((from|only) .*\)$/, '');
  if (only !== undefined && saved.inputs[only]) {
    inputs = inputs.filter((x) => x.index === only);
    label = `${label} (only ${inputs[0].input.name})`;
  } else {
    if (section) {
      const picked = inputs.filter((x) => inSection(x.input.section, section));
      if (picked.length) inputs = picked;
    }
    if (from !== undefined) {
      const rest = inputs.filter((x) => x.index >= from);
      if (rest.length && rest.length < inputs.length) inputs = rest;
    }
    const sectionPart = section && inputs.length ? `only ${section}` : '';
    const fromPart =
      from !== undefined && inputs[0]?.index === from && from > 0
        ? `from ${inputs[0].input.name}`
        : '';
    const parts = [sectionPart, fromPart].filter(Boolean);
    if (parts.length) label = `${label} (${parts.join(', ')})`;
  }
  let changed = 0;
  const fresh = inputs.map(({ input }) => {
    const now = latest?.[input.id];
    if (!now || !String(now.command || '').trim()) return input;
    const next: RunStepInput = {
      ...input,
      name: String(now.name || input.name),
      command: String(now.command),
      cwd: now.cwd ?? input.cwd,
      wait: now.wait ?? input.wait,
      ready: now.ready ?? null,
      timeout: now.timeout ?? null,
      when: now.when ?? null,
    };
    const same = (a: RunStepInput, b: RunStepInput) =>
      JSON.stringify([
        a.name,
        a.command,
        a.cwd || '',
        a.wait !== false,
        normalizeReady(a.ready),
        normalizeCondition(a.when),
        Number(a.timeout) || 0,
      ]) ===
      JSON.stringify([
        b.name,
        b.command,
        b.cwd || '',
        b.wait !== false,
        normalizeReady(b.ready),
        normalizeCondition(b.when),
        Number(b.timeout) || 0,
      ]);
    if (!same(input, next)) changed += 1;
    return next;
  });
  return startRun(fresh, {
    label,
    groupId: section ? null : saved.groupId,
    stopOnError: saved.stopOnError,
    notify: saved.notify,
    intro: changed
      ? `↻ ${changed} step${changed > 1 ? 's' : ''} changed since the last run - running the current version`
      : undefined,
  });
};

/** For tests / wiring: how a "container ready" check is answered. */
export const setContainerProbe = (probe: ContainerProbe) => {
  containerProbe = probe;
};

/** For tests / wiring: how a package's "done / failed / ready" is announced. */
export const setNotifier = (fn: (notice: RunNotice) => void) => {
  notifier = fn;
};

/** For tests / wiring: where "only run if changed" keeps what it saw. */
export const setConditionFile = (file: string | null) => {
  conditions = new ConditionStore(file);
};

/** Stops a whole run. Pressed again while it's stopping: kill -9 everything. */
export const stopRun = (runId: string, force = false) => {
  const run = runs.get(runId);
  if (!run || run.status !== 'running') return false;
  const hard = force || run.stopping;
  stopRequested.add(runId);
  run.stopping = true;
  run.steps.forEach((s) => {
    if (s.status === 'running' || s.status === 'waiting') s.stopping = true;
  });
  append(run, hard ? '\n■ Killing everything (SIGKILL)\n' : '\n■ Stopping…\n');
  (procs.get(runId) || []).filter(procAlive).forEach((p) => terminate(p, hard));
  publish(run);
  return true;
};

/** Stops one step (its process, or its "ready when" wait); the package goes on. */
export const stopStep = (runId: string, index: number, force = false) => {
  const run = runs.get(runId);
  const step = run?.steps[index];
  if (!run || !step || run.status !== 'running') return false;
  if (step.status !== 'running' && step.status !== 'waiting') return false;
  const key = `${runId}:${index}`;
  const hard = force || step.stopping;
  stepStops.add(key);
  step.stopping = true;
  append(
    run,
    hard ? `■ Killing ${step.name} (SIGKILL)\n` : `■ Stopping ${step.name}\n`,
    index,
  );
  const proc = stepProcs.get(key);
  if (proc && procAlive(proc)) terminate(proc, hard);
  publish(run);
  return true;
};

export const stopAllRuns = () => {
  [...runs.values()]
    .filter((r) => r.status === 'running')
    .forEach((r) => stopRun(r.id));
};

export const registerCommandIpc = (
  ipcMain: IpcMain,
  wiring: {
    containerReady?: ContainerProbe;
    conditionFile?: string;
    notify?: (notice: RunNotice) => void;
  } = {},
) => {
  if (wiring.containerReady) containerProbe = wiring.containerReady;
  if (wiring.notify) notifier = wiring.notify;
  if (wiring.conditionFile) setConditionFile(wiring.conditionFile);
  resolveShellEnv(); // warm up: the first run shouldn't wait for the shell
  ipcMain.handle('commands:run', (event, inputs: RunStepInput[], options) =>
    startRun(Array.isArray(inputs) ? inputs : [], options || {}),
  );
  ipcMain.handle('commands:stop', (event, runId: string, force?: boolean) =>
    stopRun(String(runId), !!force),
  );
  ipcMain.handle(
    'commands:stop-step',
    (event, runId: string, index: number, force?: boolean) =>
      stopStep(String(runId), Number(index), !!force),
  );
  ipcMain.handle('commands:runs', () =>
    [...runs.values()].map(snapshot).sort((a, b) => b.startedAt - a.startedAt),
  );
  ipcMain.handle(
    'commands:output',
    (event, runId: string, step?: number | null) =>
      getOutput(String(runId), typeof step === 'number' ? step : null),
  );
  ipcMain.handle('commands:rerun', (event, runId: string, options) =>
    rerun(String(runId), options || {}),
  );
  ipcMain.handle(
    'commands:retry',
    (event, runId: string, index: number, latest?: Partial<RunStepInput>) =>
      retryStep(String(runId), Number(index), latest || null),
  );
  ipcMain.handle('commands:clear', () => {
    [...runs.values()]
      .filter((r) => r.status !== 'running')
      .forEach((r) => {
        runs.delete(r.id);
        pending.delete(r.id);
        stepOutputs.delete(r.id);
      });
    return true;
  });
  ipcMain.handle('commands:pick-folder', async (event, current?: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Working directory',
      defaultPath: expandHome(current),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const picked = result.filePaths[0];
    const home = os.homedir();
    return picked.startsWith(home) ? `~${picked.slice(home.length)}` : picked;
  });
};
