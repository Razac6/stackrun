// "Ready when…" for Dev Notes > Commands: what the next step of a package waits for.
//  - container: Docker healthcheck, else a database probe inside it, else "running"
//  - port:      a TCP connect to host:port succeeds
//  - url:       an HTTP(S) GET answers with a status below 500
//  - output:    the step's output contains a text (or matches /regex/flags)
//  - quiet:     the output has been silent for N seconds (after printing something)
// A process that ends before it's ready fails the step at once instead of timing out.
import net from 'net';
import http from 'http';
import https from 'https';

import { ReadyCheck } from './readyCheck';

export * from './readyCheck';

/** "5432" -> localhost:5432, "db:5432" / "[::1]:5432" -> host + port. */
export const parseHostPort = (target: string) => {
  const t = target.trim();
  const v6 = t.match(/^\[([^\]]+)\]:(\d+)$/);
  if (v6) return { host: v6[1], port: Number(v6[2]) };
  const m = t.match(/^(?:(.+):)?(\d{1,5})$/);
  if (!m) return null;
  const port = Number(m[2]);
  if (port < 1 || port > 65535) return null;
  return { host: m[1] || 'localhost', port };
};

/** Text or /regex/flags -> a matcher for the output. */
export const outputMatcher = (target: string) => {
  const re = target.trim().match(/^\/(.+)\/([gimsuy]*)$/);
  if (re) {
    try {
      const regex = new RegExp(re[1], re[2].replace('g', ''));
      return (text: string) => regex.test(text);
    } catch (e) {
      // not a valid regex: fall back to plain text
    }
  }
  const needle = target.trim().toLowerCase();
  return (text: string) => !!needle && text.toLowerCase().includes(needle);
};

const portOpen = (host: string, port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1500, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });

const urlResponds = (url: string) =>
  new Promise<{ ok: boolean; detail: string }>((resolve) => {
    let target: URL;
    try {
      target = new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`);
    } catch (e) {
      resolve({ ok: false, detail: 'invalid URL' });
      return;
    }
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.get(
      target,
      { timeout: 3000, rejectUnauthorized: false },
      (res) => {
        res.resume();
        const code = res.statusCode || 0;
        resolve({ ok: code > 0 && code < 500, detail: `HTTP ${code}` });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ ok: false, detail: e.message }));
  });

export interface ReadyContext {
  output: () => string; // the step's output so far
  lastOutputAt: () => number | null; // when it last printed (ms)
  aborted: () => string | null; // reason to give up (stopped, process ended...)
  containerReady: (name: string) => Promise<{ ready: boolean; detail: string }>;
  onProgress?: (detail: string) => void;
  pollMs?: number;
}

/** Polls until the check passes, times out or is aborted. */
export const waitUntilReady = async (
  check: ReadyCheck,
  ctx: ReadyContext,
): Promise<{ ok: boolean; detail: string }> => {
  const started = Date.now();
  const limit = check.timeout > 0 ? check.timeout * 1000 : Infinity;
  const poll = ctx.pollMs ?? 1000;
  const matches = check.type === 'output' ? outputMatcher(check.target) : null;
  const hostPort = check.type === 'port' ? parseHostPort(check.target) : null;
  if (check.type === 'port' && !hostPort) {
    return { ok: false, detail: `"${check.target}" isn't a port or host:port` };
  }
  let detail = 'waiting';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // output checks first: a process may print the line and exit right after
    if (matches && matches(ctx.output()))
      return { ok: true, detail: 'line found' };
    const abort = ctx.aborted();
    if (abort) return { ok: false, detail: abort };
    if (check.type === 'quiet') {
      const last = ctx.lastOutputAt();
      const quietMs = (Number(check.target) || 3) * 1000;
      if (last && Date.now() - last >= quietMs) {
        return { ok: true, detail: 'output settled' };
      }
      detail = last ? 'still printing' : 'no output yet';
    } else if (hostPort) {
      // eslint-disable-next-line no-await-in-loop
      if (await portOpen(hostPort.host, hostPort.port)) {
        return { ok: true, detail: 'port open' };
      }
      detail = 'port closed';
    } else if (check.type === 'url') {
      // eslint-disable-next-line no-await-in-loop
      const res = await urlResponds(check.target);
      if (res.ok) return { ok: true, detail: res.detail };
      detail = res.detail;
    } else if (check.type === 'container') {
      // eslint-disable-next-line no-await-in-loop
      const res = await ctx.containerReady(check.target.trim());
      if (res.ready) return { ok: true, detail: res.detail };
      detail = res.detail;
    } else if (check.type === 'output') {
      detail = 'line not seen yet';
    } else {
      return { ok: true, detail: '' };
    }
    ctx.onProgress?.(detail);
    if (Date.now() - started >= limit) {
      return {
        ok: false,
        detail: `not ready after ${check.timeout} s (${detail})`,
      };
    }
    // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
    await new Promise((resolve) => setTimeout(resolve, poll));
  }
};
