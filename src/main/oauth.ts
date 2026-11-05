// OAuth 2.0 tokens for the HTTP Client, like WebStorm's `Security.Auth` in
// http-client.env.json and `{{$auth.token("id")}}`: client credentials, password, and
// authorization code (a login window, PKCE when asked).
import crypto from 'crypto';
import type { IpcMain } from 'electron';
import { sendHttp } from './httpClient';

export interface OAuthRequest {
  grant: 'client_credentials' | 'password' | 'authorization_code';
  tokenUrl: string;
  authUrl?: string;
  redirectUrl?: string;
  clientId: string;
  clientSecret?: string;
  clientAuth?: 'body' | 'basic' | 'none';
  scope?: string;
  username?: string;
  password?: string;
  pkce?: boolean;
  audience?: string;
  extra?: Record<string, string>; // custom request parameters
  insecure?: boolean;
}

export interface OAuthToken {
  accessToken: string;
  idToken: string;
  expiresIn: number; // s, 0 = unknown
  error: string | null;
}

const fail = (error: string): OAuthToken => ({
  accessToken: '',
  idToken: '',
  expiresIn: 0,
  error,
});

const form = (fields: Record<string, string | undefined>) =>
  Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
    .join('&');

export const base64Url = (buf: Buffer) =>
  buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** The token endpoint call itself (shared by every grant). */
export const exchange = async (
  req: OAuthRequest,
  fields: Record<string, string | undefined>,
): Promise<OAuthToken> => {
  if (!req.tokenUrl) return fail('No "Token URL" in the auth configuration');
  const headers: [string, string][] = [
    ['Content-Type', 'application/x-www-form-urlencoded'],
    ['Accept', 'application/json'],
  ];
  const body: Record<string, string | undefined> = {
    ...fields,
    scope: req.scope,
    audience: req.audience,
    ...(req.extra || {}),
  };
  const how = req.clientAuth || (req.clientSecret ? 'body' : 'none');
  if (how === 'basic')
    headers.push([
      'Authorization',
      `Basic ${Buffer.from(
        `${encodeURIComponent(req.clientId)}:${encodeURIComponent(req.clientSecret || '')}`,
      ).toString('base64')}`,
    ]);
  else {
    body.client_id = req.clientId;
    if (how === 'body') body.client_secret = req.clientSecret;
  }
  const res = await sendHttp({
    id: `oauth-${Date.now()}`,
    method: 'POST',
    url: req.tokenUrl,
    headers,
    body: form(body),
    insecure: req.insecure,
    timeoutMs: 30000,
  });
  if (res.error) return fail(`Token URL: ${res.error}`);
  let json: any = null;
  try {
    json = JSON.parse(res.body);
  } catch (e) {
    json = null;
  }
  if (res.status >= 400 || !json?.access_token) {
    const why =
      json?.error_description || json?.error || res.body.slice(0, 200) || '';
    return fail(`Token URL answered ${res.status}${why ? `: ${why}` : ''}`);
  }
  return {
    accessToken: String(json.access_token),
    idToken: json.id_token ? String(json.id_token) : '',
    expiresIn: Number(json.expires_in) || 0,
    error: null,
  };
};

/**
 * Authorization code: a login window opens on the auth URL; when it is sent to the
 * redirect URL, the code is taken from there and exchanged for a token.
 */
const authorizationCode = async (req: OAuthRequest): Promise<OAuthToken> => {
  if (!req.authUrl) return fail('No "Auth URL" in the auth configuration');
  const redirect = req.redirectUrl || 'http://localhost/callback';
  const state = base64Url(crypto.randomBytes(16));
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(
    crypto.createHash('sha256').update(verifier).digest(),
  );
  const url = new URL(req.authUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', req.clientId);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('state', state);
  if (req.scope) url.searchParams.set('scope', req.scope);
  if (req.audience) url.searchParams.set('audience', req.audience);
  Object.entries(req.extra || {}).forEach(([k, v]) =>
    url.searchParams.set(k, v),
  );
  if (req.pkce) {
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }

  // eslint-disable-next-line global-require
  const { BrowserWindow } = require('electron');
  const code = await new Promise<{ code?: string; error?: string }>(
    (resolve) => {
      const win = new BrowserWindow({
        width: 520,
        height: 720,
        title: 'Sign in',
        autoHideMenuBar: true,
        webPreferences: { partition: 'persist:stackrun-oauth' },
      });
      let done = false;
      const finish = (r: { code?: string; error?: string }) => {
        if (done) return;
        done = true;
        resolve(r);
        if (!win.isDestroyed()) win.close();
      };
      const check = (target: string) => {
        if (!target.startsWith(redirect)) return false;
        const back = new URL(target);
        const error =
          back.searchParams.get('error_description') ||
          back.searchParams.get('error');
        if (error) finish({ error });
        else if (back.searchParams.get('state') !== state)
          finish({ error: 'The sign-in answer did not match (state)' });
        else finish({ code: back.searchParams.get('code') || undefined });
        return true;
      };
      win.webContents.on('will-redirect', (e: any, target: string) => {
        if (check(target)) e.preventDefault();
      });
      win.webContents.on('will-navigate', (e: any, target: string) => {
        if (check(target)) e.preventDefault();
      });
      win.webContents.on(
        'did-fail-load',
        (e: any, c: number, d: string, target: string) => {
          check(target);
        },
      );
      win.on('closed', () => finish({ error: 'Sign-in window closed' }));
      win.loadURL(url.href);
    },
  );
  if (!code.code) return fail(code.error || 'No code from the sign-in');
  return exchange(req, {
    grant_type: 'authorization_code',
    code: code.code,
    redirect_uri: redirect,
    code_verifier: req.pkce ? verifier : undefined,
  });
};

export const getToken = async (req: OAuthRequest): Promise<OAuthToken> => {
  try {
    if (req.grant === 'client_credentials')
      return await exchange(req, { grant_type: 'client_credentials' });
    if (req.grant === 'password')
      return await exchange(req, {
        grant_type: 'password',
        username: req.username,
        password: req.password,
      });
    return await authorizationCode(req);
  } catch (e: any) {
    return fail(e?.message || String(e));
  }
};

export const registerOAuthIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('oauth:token', (event, req: OAuthRequest) => getToken(req));
};
