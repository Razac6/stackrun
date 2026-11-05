/**
 * @jest-environment node
 */
import http from 'http';
import { AddressInfo } from 'net';
import { getToken } from './oauth';

let server: http.Server;
let tokenUrl = '';
const got: { auth?: string; body: string }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      got.push({ auth: req.headers.authorization, body });
      const p = new URLSearchParams(body);
      res.setHeader('Content-Type', 'application/json');
      if (p.get('client_id') === 'bad' || p.get('password') === 'wrong') {
        res.statusCode = 401;
        res.end(
          JSON.stringify({
            error: 'invalid_client',
            error_description: 'Nope',
          }),
        );
        return;
      }
      res.end(JSON.stringify({ access_token: 'AT', expires_in: 300 }));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  tokenUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/token`;
});
afterAll(() => {
  server.close();
});

describe('OAuth tokens', () => {
  it('client credentials, secret in the body, with scope', async () => {
    const t = await getToken({
      grant: 'client_credentials',
      tokenUrl,
      clientId: 'api',
      clientSecret: 's',
      scope: 'openid',
    });
    expect(t).toEqual({
      accessToken: 'AT',
      idToken: '',
      expiresIn: 300,
      error: null,
    });
    const p = new URLSearchParams(got[got.length - 1].body);
    expect(Object.fromEntries(p)).toEqual({
      grant_type: 'client_credentials',
      client_id: 'api',
      client_secret: 's',
      scope: 'openid',
    });
  });

  it('password grant with basic client auth', async () => {
    await getToken({
      grant: 'password',
      tokenUrl,
      clientId: 'api',
      clientSecret: 's',
      clientAuth: 'basic',
      username: 'ann',
      password: 'pw',
    });
    const last = got[got.length - 1];
    expect(last.auth).toBe(`Basic ${Buffer.from('api:s').toString('base64')}`);
    expect(new URLSearchParams(last.body).get('username')).toBe('ann');
    expect(new URLSearchParams(last.body).get('client_secret')).toBeNull();
  });

  it('explains a refused token', async () => {
    const t = await getToken({
      grant: 'client_credentials',
      tokenUrl,
      clientId: 'bad',
    });
    expect(t.error).toBe('Token URL answered 401: Nope');
    expect(
      (
        await getToken({
          grant: 'client_credentials',
          tokenUrl: '',
          clientId: 'x',
        })
      ).error,
    ).toMatch(/No "Token URL"/);
  });
});
