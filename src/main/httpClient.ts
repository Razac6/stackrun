// HTTP Client: requests are sent from the main process (no CORS, any host, self-signed
// certificates if you allow them), one at a time per id so a request can be cancelled.
import http from 'http';
import https from 'https';
import zlib from 'zlib';
import type { IpcMain } from 'electron';

export interface HttpSend {
  id: string;
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
  timeoutMs?: number;
  insecure?: boolean; // accept self-signed / invalid certificates
  followRedirects?: boolean;
}

export interface HttpResult {
  id: string;
  ok: boolean;
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string; // text (binary bodies as a short note)
  binary: boolean;
  size: number; // bytes received (after decompression)
  timeMs: number;
  url: string; // after redirects
  redirects: string[];
  truncated: boolean;
  error: string | null;
}

const MAX_BODY = 10 * 1024 * 1024;
const MAX_REDIRECTS = 10;
const active = new Map<string, () => void>();

const isText = (type: string) =>
  !type ||
  /^text\/|json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql|yaml|csv|html/i.test(
    type,
  );

const decode = (raw: Buffer, encoding: string): Buffer => {
  const buf = new Uint8Array(raw);
  try {
    if (/\bgzip\b/i.test(encoding)) return zlib.gunzipSync(buf);
    if (/\bdeflate\b/i.test(encoding)) return zlib.inflateSync(buf);
    if (/\bbr\b/i.test(encoding)) return zlib.brotliDecompressSync(buf);
  } catch (e) {
    // shown as received
  }
  return raw;
};

const charsetOf = (type: string): BufferEncoding => {
  const m = /charset=([\w-]+)/i.exec(type);
  const cs = (m?.[1] || 'utf-8').toLowerCase();
  if (cs === 'iso-8859-1' || cs === 'latin1') return 'latin1';
  return 'utf8';
};

/** Explains the usual network errors in plain words. */
export const describeError = (e: any): string => {
  const code = e?.code || '';
  const msg = e?.message || String(e);
  if (code === 'ENOTFOUND') return `Host not found (${e.hostname || msg})`;
  if (code === 'ECONNREFUSED')
    return `Connection refused - is the server running on ${e.address || ''}${e.port ? `:${e.port}` : ''}?`;
  if (code === 'ECONNRESET') return 'The server closed the connection';
  if (code === 'ETIMEDOUT' || code === 'TIMEOUT') return msg;
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code))
    return `Certificate problem (${code}) - turn on "Allow self-signed certificates" if you trust this server`;
  return msg;
};

const once = (
  req: HttpSend,
  target: URL,
  started: number,
  family?: 4 | 6, // which address of "localhost" to use
): Promise<{
  status: number;
  statusText: string;
  headers: [string, string][];
  raw: Buffer;
  truncated: boolean;
  location?: string;
}> =>
  new Promise((resolve, reject) => {
    const lib = target.protocol === 'https:' ? https : http;
    const headers: Record<string, string> = {};
    req.headers.forEach(([k, v]) => {
      if (k.trim()) headers[k.trim()] = v;
    });
    const lower = Object.keys(headers).map((k) => k.toLowerCase());
    if (!lower.includes('user-agent')) headers['User-Agent'] = 'Stackrun';
    if (!lower.includes('accept-encoding'))
      headers['Accept-Encoding'] = 'gzip, deflate, br';
    const body = req.body ?? '';
    if (body && !lower.includes('content-length'))
      headers['Content-Length'] = String(Buffer.byteLength(body));

    const r = lib.request(
      target,
      {
        method: req.method,
        headers,
        rejectUnauthorized: !req.insecure,
        ...(family && { family }),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY) {
            truncated = true;
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          const list: [string, string][] = [];
          for (let i = 0; i < res.rawHeaders.length; i += 2)
            list.push([res.rawHeaders[i], res.rawHeaders[i + 1]]);
          resolve({
            status: res.statusCode || 0,
            statusText: res.statusMessage || '',
            headers: list,
            raw: decode(
              Buffer.concat(chunks.map((c) => new Uint8Array(c))),
              String(res.headers['content-encoding'] || ''),
            ),
            truncated,
            location: res.headers.location,
          });
        });
        res.on('error', reject);
      },
    );
    const limit = req.timeoutMs ?? 60000;
    const left = Math.max(1, limit - (Date.now() - started));
    const timer = setTimeout(() => {
      const err: any = new Error(`No answer within ${limit / 1000} s`);
      err.code = 'TIMEOUT';
      r.destroy(err);
    }, left);
    r.on('close', () => clearTimeout(timer));
    r.on('error', reject);
    active.set(req.id, () => {
      const err: any = new Error('Cancelled');
      err.code = 'CANCELLED';
      r.destroy(err);
    });
    if (body) r.write(body);
    r.end();
  });

/**
 * "localhost" is ::1 and 127.0.0.1: a dev server often listens on only one of them
 * (macOS gives ::1 first). Refused on one, the other is tried.
 */
const onceAnyLocalhost = async (
  req: HttpSend,
  target: URL,
  started: number,
) => {
  try {
    return await once(req, target, started);
  } catch (e: any) {
    if (e?.code !== 'ECONNREFUSED' || target.hostname !== 'localhost') throw e;
    const triedV6 = String(e.address || '').includes(':');
    try {
      return await once(req, target, started, triedV6 ? 4 : 6);
    } catch (again: any) {
      if (again?.code === 'ECONNREFUSED') {
        // neither answered: say it about "localhost", not one of its addresses
        again.address = 'localhost';
      }
      throw again;
    }
  }
};

export const sendHttp = async (req: HttpSend): Promise<HttpResult> => {
  const started = Date.now();
  const redirects: string[] = [];
  const fail = (error: string): HttpResult => ({
    id: req.id,
    ok: false,
    status: 0,
    statusText: '',
    headers: [],
    body: '',
    binary: false,
    size: 0,
    timeMs: Date.now() - started,
    url: req.url,
    redirects,
    truncated: false,
    error,
  });
  let target: URL;
  try {
    target = new URL(req.url);
    if (!/^https?:$/.test(target.protocol))
      return fail(`Only http:// and https:// URLs (got ${target.protocol})`);
  } catch (e) {
    return fail(`Not a valid URL: ${req.url || '(empty)'}`);
  }
  let current = { ...req };
  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const res = await onceAnyLocalhost(current, target, started);
      if (
        current.followRedirects !== false &&
        res.location &&
        [301, 302, 303, 307, 308].includes(res.status) &&
        redirects.length < MAX_REDIRECTS
      ) {
        target = new URL(res.location, target);
        redirects.push(target.href);
        // 303 (and old-style 301/302 for POST) continue as GET without a body
        if (
          res.status === 303 ||
          ((res.status === 301 || res.status === 302) &&
            current.method !== 'GET' &&
            current.method !== 'HEAD')
        )
          current = {
            ...current,
            method: 'GET',
            body: undefined,
            headers: current.headers.filter(
              ([k]) => !/^content-(type|length)$/i.test(k),
            ),
          };
        // eslint-disable-next-line no-continue
        continue;
      }
      const type =
        res.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ||
        '';
      const binary = res.raw.length > 0 && !isText(type);
      return {
        id: req.id,
        ok: res.status >= 200 && res.status < 400,
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
        body: binary
          ? `(${type || 'binary'} · ${res.raw.length} bytes)`
          : res.raw.toString(charsetOf(type)),
        binary,
        size: res.raw.length,
        timeMs: Date.now() - started,
        url: target.href,
        redirects,
        truncated: res.truncated,
        error: null,
      };
    }
  } catch (e: any) {
    return fail(describeError(e));
  } finally {
    active.delete(req.id);
  }
};

export const cancelHttp = (id: string) => {
  const cancel = active.get(id);
  if (cancel) cancel();
  return !!cancel;
};

export const registerHttpIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('http:send', (event, req: HttpSend) => sendHttp(req));
  ipcMain.handle('http:cancel', (event, id: string) => cancelHttp(String(id)));
};
