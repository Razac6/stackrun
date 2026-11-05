/**
 * @jest-environment node
 */
import http from 'http';
import zlib from 'zlib';
import { AddressInfo } from 'net';
import { cancelHttp, sendHttp } from './httpClient';

let server: http.Server;
let base = '';
const seen: {
  method?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      seen.push({ method: req.method, headers: req.headers, body });
      if (req.url === '/json') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, echo: body }));
      } else if (req.url === '/gzip') {
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Encoding', 'gzip');
        res.end(zlib.gzipSync('packed text'));
      } else if (req.url === '/redirect') {
        res.statusCode = 303;
        res.setHeader('Location', '/json');
        res.end();
      } else if (req.url === '/slow') {
        setTimeout(() => res.end('late'), 3000);
      } else if (req.url === '/png') {
        res.setHeader('Content-Type', 'image/png');
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      } else {
        res.statusCode = 404;
        res.end('nope');
      }
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

describe('sendHttp', () => {
  it('sends headers and a body and reads the answer', async () => {
    const res = await sendHttp({
      id: 'a',
      method: 'POST',
      url: `${base}/json`,
      headers: [
        ['Content-Type', 'application/json'],
        ['X-Test', '1'],
      ],
      body: '{"a":1}',
    });
    expect(res).toMatchObject({ ok: true, status: 200, error: null });
    expect(JSON.parse(res.body)).toEqual({ ok: true, echo: '{"a":1}' });
    const last = seen[seen.length - 1];
    expect(last.headers['x-test']).toBe('1');
    expect(last.headers['user-agent']).toBe('Stackrun');
  });

  it('unpacks gzip, follows redirects, marks binary bodies', async () => {
    expect(
      (
        await sendHttp({
          id: 'b',
          method: 'GET',
          url: `${base}/gzip`,
          headers: [],
        })
      ).body,
    ).toBe('packed text');
    const r = await sendHttp({
      id: 'c',
      method: 'POST',
      url: `${base}/redirect`,
      headers: [],
      body: 'x',
    });
    expect(r.status).toBe(200);
    expect(r.redirects).toEqual([`${base}/json`]);
    expect(seen[seen.length - 1].method).toBe('GET'); // 303 continues as GET
    const png = await sendHttp({
      id: 'd',
      method: 'GET',
      url: `${base}/png`,
      headers: [],
    });
    expect(png).toMatchObject({ binary: true, size: 4 });
  });

  it('reports 404 as not ok, and errors in plain words', async () => {
    expect(
      await sendHttp({ id: 'e', method: 'GET', url: `${base}/x`, headers: [] }),
    ).toMatchObject({ ok: false, status: 404, body: 'nope' });
    expect(
      (await sendHttp({ id: 'f', method: 'GET', url: 'nope', headers: [] }))
        .error,
    ).toMatch(/Not a valid URL/);
    expect(
      (
        await sendHttp({
          id: 'g',
          method: 'GET',
          url: 'http://127.0.0.1:1/',
          headers: [],
        })
      ).error,
    ).toMatch(/refused/);
  });

  it('times out and can be cancelled', async () => {
    const t = await sendHttp({
      id: 'h',
      method: 'GET',
      url: `${base}/slow`,
      headers: [],
      timeoutMs: 300,
    });
    expect(t.error).toMatch(/No answer within 0.3 s/);
    const p = sendHttp({
      id: 'i',
      method: 'GET',
      url: `${base}/slow`,
      headers: [],
    });
    setTimeout(() => cancelHttp('i'), 100);
    expect((await p).error).toBe('Cancelled');
  });
});
