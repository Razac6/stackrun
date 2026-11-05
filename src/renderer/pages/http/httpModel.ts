// HTTP Client model (pure): collections of requests run one after another like a package,
// environments + constants for {{variables}}, auth, values captured from a response into a
// variable for the next request, and import / export of JetBrains .http files and
// http-client.env.json.

export const METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const;

export interface KV {
  key: string;
  value: string;
  enabled: boolean;
}

export type AuthType =
  | 'inherit'
  | 'none'
  | 'bearer'
  | 'basic'
  | 'apikey'
  | 'oauth2';
export interface Auth {
  type: AuthType;
  authId?: string; // oauth2: which configuration of the environment
  token?: string; // bearer
  username?: string; // basic
  password?: string;
  key?: string; // api key name
  value?: string;
  in?: 'header' | 'query';
}

export type BodyType = 'none' | 'json' | 'text' | 'form' | 'xml';
export interface Body {
  type: BodyType;
  text: string; // json / text / xml
  form: KV[]; // x-www-form-urlencoded
}

/** "Save something from the response into a variable" (client.global.set in WebStorm). */
export interface Capture {
  variable: string;
  from: 'json' | 'header' | 'status';
  path: string; // json: data.items[0].id · header: name
}

export interface HttpRequest {
  id: string;
  name: string;
  method: string;
  url: string;
  params: KV[];
  headers: KV[];
  body: Body;
  auth: Auth;
  captures: Capture[];
  delayMs: number; // wait before it when the collection runs
  skip: boolean; // left out of a collection run
}

export interface HttpCollection {
  id: string;
  name: string;
  requests: HttpRequest[];
  variables: KV[]; // `@name = value` of its .http file
  auth: Auth; // what "inherit" means for its requests
  headers: KV[]; // added to each of its requests
  stopOnError: boolean; // a collection run stops at a failed request
  collapsed?: boolean;
}

/** OAuth 2.0 configuration - `Security.Auth.<id>` in WebStorm's http-client.env.json. */
export type OAuthGrant =
  | 'client_credentials'
  | 'password'
  | 'authorization_code';
export interface OAuthConfig {
  id: string; // used as {{$auth.token("id")}}
  grant: OAuthGrant;
  tokenUrl: string;
  authUrl: string;
  redirectUrl: string;
  clientId: string;
  clientSecret: string;
  clientAuth: 'body' | 'basic' | 'none';
  scope: string;
  username: string;
  password: string;
  pkce: boolean;
  audience: string;
  useIdToken: boolean; // {{$auth.token}} gives the id_token (WebStorm "Use ID Token")
  extra: Record<string, string>; // "Custom Request Parameters" (resource, prompt…)
}

export interface HttpEnvironment {
  id: string;
  name: string;
  variables: KV[];
  auths: OAuthConfig[];
}

export interface HttpState {
  collections: HttpCollection[];
  environments: HttpEnvironment[];
  activeEnv: string | null;
  constants: KV[]; // the same in every environment
  captured: Record<string, string>; // set by captures, used like any variable
  options: { timeoutMs: number; insecure: boolean; followRedirects: boolean };
}

export const SETTINGS_KEY = 'http_client';

let seq = 0;
export const newId = (prefix = 'r') => {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
};

export const kv = (key = '', value = '', enabled = true): KV => ({
  key,
  value,
  enabled,
});

export const newRequest = (
  partial: Partial<HttpRequest> = {},
): HttpRequest => ({
  id: newId('r'),
  name: 'New request',
  method: 'GET',
  url: '',
  params: [],
  headers: [],
  body: { type: 'none', text: '', form: [] },
  auth: { type: 'inherit' },
  captures: [],
  delayMs: 0,
  skip: false,
  ...partial,
});

export const newCollection = (
  partial: Partial<HttpCollection> = {},
): HttpCollection => ({
  id: newId('c'),
  name: 'New collection',
  requests: [],
  variables: [],
  auth: { type: 'none' },
  headers: [],
  stopOnError: true,
  ...partial,
});

export const emptyState = (): HttpState => ({
  collections: [],
  environments: [
    {
      id: 'env-local',
      name: 'local',
      variables: [kv('host', 'http://localhost:3000')],
      auths: [],
    },
  ],
  activeEnv: 'env-local',
  constants: [],
  captured: {},
  options: { timeoutMs: 60000, insecure: false, followRedirects: true },
});

// ---------------- parsing what is stored ----------------
const asKVs = (v: any): KV[] =>
  Array.isArray(v)
    ? v
        .filter((x) => x && typeof x === 'object')
        .map((x) =>
          kv(String(x.key ?? ''), String(x.value ?? ''), x.enabled !== false),
        )
    : [];

const AUTH_TYPES: AuthType[] = [
  'inherit',
  'none',
  'bearer',
  'basic',
  'apikey',
  'oauth2',
];
const asAuth = (a: any, fallback: AuthType): Auth => {
  const type = AUTH_TYPES.includes(a?.type) ? a.type : fallback;
  return {
    type,
    authId: a?.authId ? String(a.authId) : undefined,
    token: a?.token ? String(a.token) : undefined,
    username: a?.username ? String(a.username) : undefined,
    password: a?.password ? String(a.password) : undefined,
    key: a?.key ? String(a.key) : undefined,
    value: a?.value ? String(a.value) : undefined,
    in: a?.in === 'query' ? 'query' : 'header',
  };
};

const GRANTS: OAuthGrant[] = [
  'client_credentials',
  'password',
  'authorization_code',
];
export const newOAuth = (partial: Partial<OAuthConfig> = {}): OAuthConfig => ({
  id: 'auth',
  grant: 'client_credentials',
  tokenUrl: '',
  authUrl: '',
  redirectUrl: '',
  clientId: '',
  clientSecret: '',
  clientAuth: 'body',
  scope: '',
  username: '',
  password: '',
  pkce: false,
  audience: '',
  useIdToken: false,
  extra: {},
  ...partial,
});
const asOAuth = (a: any): OAuthConfig =>
  newOAuth({
    id: String(a?.id || 'auth'),
    grant: GRANTS.includes(a?.grant) ? a.grant : 'client_credentials',
    tokenUrl: String(a?.tokenUrl || ''),
    authUrl: String(a?.authUrl || ''),
    redirectUrl: String(a?.redirectUrl || ''),
    clientId: String(a?.clientId || ''),
    clientSecret: String(a?.clientSecret || ''),
    clientAuth: ['body', 'basic', 'none'].includes(a?.clientAuth)
      ? a.clientAuth
      : 'body',
    scope: String(a?.scope || ''),
    username: String(a?.username || ''),
    password: String(a?.password || ''),
    pkce: !!a?.pkce,
    audience: String(a?.audience || ''),
    useIdToken: !!a?.useIdToken,
    extra:
      a?.extra && typeof a.extra === 'object'
        ? Object.fromEntries(
            Object.entries(a.extra).map(([k, v]) => [k, String(v)]),
          )
        : {},
  });

const BODY_TYPES: BodyType[] = ['none', 'json', 'text', 'form', 'xml'];
const asRequest = (r: any): HttpRequest =>
  newRequest({
    id: String(r?.id || newId('r')),
    name: String(r?.name || 'Request'),
    method: String(r?.method || 'GET').toUpperCase(),
    url: String(r?.url || ''),
    params: asKVs(r?.params),
    headers: asKVs(r?.headers),
    body: {
      type: BODY_TYPES.includes(r?.body?.type) ? r.body.type : 'none',
      text: String(r?.body?.text || ''),
      form: asKVs(r?.body?.form),
    },
    auth: asAuth(r?.auth, 'inherit'),
    captures: Array.isArray(r?.captures)
      ? r.captures
          .filter((c: any) => c && c.variable)
          .map((c: any) => ({
            variable: String(c.variable),
            from: ['json', 'header', 'status'].includes(c.from)
              ? c.from
              : 'json',
            path: String(c.path || ''),
          }))
      : [],
    delayMs: Math.max(0, Number(r?.delayMs) || 0),
    skip: !!r?.skip,
  });

export const parseState = (raw: unknown): HttpState => {
  let v: any = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw);
    } catch (e) {
      v = null;
    }
  }
  const base = emptyState();
  if (!v || typeof v !== 'object') return base;
  const environments: HttpEnvironment[] = Array.isArray(v.environments)
    ? v.environments.map((e: any) => ({
        id: String(e?.id || newId('e')),
        name: String(e?.name || 'env'),
        variables: asKVs(e?.variables),
        auths: Array.isArray(e?.auths) ? e.auths.map(asOAuth) : [],
      }))
    : base.environments;
  return {
    collections: Array.isArray(v.collections)
      ? v.collections.map((c: any) =>
          newCollection({
            id: String(c?.id || newId('c')),
            name: String(c?.name || 'Collection'),
            requests: Array.isArray(c?.requests)
              ? c.requests.map(asRequest)
              : [],
            variables: asKVs(c?.variables),
            auth: asAuth(c?.auth, 'none'),
            headers: asKVs(c?.headers),
            stopOnError: c?.stopOnError !== false,
            collapsed: !!c?.collapsed,
          }),
        )
      : [],
    environments,
    activeEnv: environments.some((e) => e.id === v.activeEnv)
      ? v.activeEnv
      : environments[0]?.id ?? null,
    constants: asKVs(v.constants),
    captured:
      v.captured && typeof v.captured === 'object'
        ? Object.fromEntries(
            Object.entries(v.captured).map(([k, x]) => [k, String(x)]),
          )
        : {},
    options: {
      timeoutMs:
        Number(v.options?.timeoutMs) > 0 ? Number(v.options.timeoutMs) : 60000,
      insecure: !!v.options?.insecure,
      followRedirects: v.options?.followRedirects !== false,
    },
  };
};

// ---------------- variables ----------------
const on = (list: KV[]) => list.filter((x) => x.enabled && x.key.trim());

export const activeEnvironment = (state: HttpState) =>
  state.environments.find((e) => e.id === state.activeEnv) || null;

/** Constants < environment < the collection's @variables < captured: later ones win. */
export const variablesFor = (
  state: HttpState,
  collection: HttpCollection | null = null,
): Record<string, string> => {
  const env = activeEnvironment(state);
  const out: Record<string, string> = {};
  [state.constants, env?.variables || [], collection?.variables || []].forEach(
    (list) =>
      on(list).forEach((x) => {
        out[x.key.trim()] = x.value;
      }),
  );
  Object.assign(out, state.captured);
  return out;
};

// {{$auth.token("id")}} / {{$auth.idToken("id")}} are looked up under these keys
const AUTH_REF = /^\$auth\.(token|idToken)\(\s*["']([^"']+)["']\s*\)$/;
export const authTokenKey = (id: string, kind: 'token' | 'idToken' = 'token') =>
  `$auth.${kind}:${id}`;
export const authTokenRef = (id: string) => `{{$auth.token("${id}")}}`;

const DYNAMIC: Record<string, () => string> = {
  $uuid: () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      return (c === 'x' ? r : (r % 4) + 8).toString(16);
    }),
  $random_uuid: () => DYNAMIC.$uuid(),
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: () => String(Math.floor(Math.random() * 1000)),
};

/** Fills {{name}}; unknown names stay as they are (and are reported). */
export const fill = (
  text: string,
  vars: Record<string, string>,
  missing?: Set<string>,
  depth = 0,
): string =>
  String(text ?? '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (all, raw: string) => {
    const ref = AUTH_REF.exec(raw);
    const name = ref
      ? authTokenKey(ref[2], ref[1] as 'token' | 'idToken')
      : raw;
    if (name in vars)
      return depth < 5
        ? fill(vars[name], vars, missing, depth + 1)
        : vars[name];
    if (DYNAMIC[name]) return DYNAMIC[name]();
    missing?.add(raw);
    return all;
  });

/** OAuth configurations a request uses (its auth, or {{$auth.token("id")}} anywhere). */
export const authIdsUsed = (
  req: HttpRequest,
  collection: HttpCollection | null,
): string[] => {
  const ids = new Set<string>();
  const auth = effectiveAuth(req, collection);
  if (auth.type === 'oauth2' && auth.authId) ids.add(auth.authId);
  const text = [
    req.url,
    ...req.params.map((p) => p.value),
    ...req.headers.map((h) => h.value),
    ...(collection?.headers || []).map((h) => h.value),
    req.body.text,
    ...req.body.form.map((p) => p.value),
    auth.token || '',
    auth.value || '',
  ].join('\n');
  [
    ...text.matchAll(
      /\{\{\s*\$auth\.(?:token|idToken)\(\s*["']([^"']+)["']\s*\)\s*\}\}/g,
    ),
  ].forEach((m) => ids.add(m[1]));
  return [...ids];
};

/** The configuration with its {{variables}} filled, ready to ask for a token. */
export const resolveOAuth = (
  config: OAuthConfig,
  vars: Record<string, string>,
): OAuthConfig => {
  const f = (v: string) => fill(v, vars);
  return {
    ...config,
    tokenUrl: f(config.tokenUrl),
    authUrl: f(config.authUrl),
    redirectUrl: f(config.redirectUrl),
    clientId: f(config.clientId),
    clientSecret: f(config.clientSecret),
    scope: f(config.scope),
    username: f(config.username),
    password: f(config.password),
    audience: f(config.audience),
    extra: Object.fromEntries(
      Object.entries(config.extra || {}).map(([k, v]) => [k, f(v)]),
    ),
  };
};

/** Names used in a request that have no value (to warn before sending). */
export const missingVariables = (
  req: HttpRequest,
  collection: HttpCollection | null,
  vars: Record<string, string>,
) => {
  const missing = new Set<string>();
  buildRequest(req, collection, vars, missing);
  return [...missing];
};

// ---------------- building what is sent ----------------
export interface BuiltRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
}

// UTF-8 safe base64 (btoa alone only takes Latin-1)
const b64 = (s: string) =>
  btoa(
    encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (m, h) =>
      String.fromCharCode(parseInt(h, 16)),
    ),
  );

export const effectiveAuth = (
  req: HttpRequest,
  collection: HttpCollection | null,
): Auth =>
  req.auth.type === 'inherit' ? collection?.auth || { type: 'none' } : req.auth;

export const buildRequest = (
  req: HttpRequest,
  collection: HttpCollection | null,
  vars: Record<string, string>,
  missing?: Set<string>,
): BuiltRequest => {
  const f = (s: string) => fill(s, vars, missing);
  let url = f(req.url).trim();
  const query = on(req.params).map(
    (p) => `${encodeURIComponent(f(p.key))}=${encodeURIComponent(f(p.value))}`,
  );
  const headers: [string, string][] = [
    ...on(collection?.headers || []),
    ...on(req.headers),
  ].map((h) => [f(h.key).trim(), f(h.value)]);
  const has = (name: string) =>
    headers.some(([k]) => k.toLowerCase() === name.toLowerCase());

  const auth = effectiveAuth(req, collection);
  if (auth.type === 'oauth2' && auth.authId && !has('authorization'))
    headers.push(['Authorization', `Bearer ${f(authTokenRef(auth.authId))}`]);
  if (auth.type === 'bearer' && auth.token && !has('authorization'))
    headers.push(['Authorization', `Bearer ${f(auth.token)}`]);
  if (auth.type === 'basic' && !has('authorization'))
    headers.push([
      'Authorization',
      `Basic ${b64(`${f(auth.username || '')}:${f(auth.password || '')}`)}`,
    ]);
  if (auth.type === 'apikey' && auth.key) {
    if (auth.in === 'query')
      query.push(
        `${encodeURIComponent(f(auth.key))}=${encodeURIComponent(f(auth.value || ''))}`,
      );
    else if (!has(f(auth.key)))
      headers.push([f(auth.key), f(auth.value || '')]);
  }
  if (query.length) url += (url.includes('?') ? '&' : '?') + query.join('&');

  let body: string | undefined;
  const { type } = req.body;
  if (type === 'form') {
    body = on(req.body.form)
      .map(
        (p) =>
          `${encodeURIComponent(f(p.key))}=${encodeURIComponent(f(p.value))}`,
      )
      .join('&');
    if (!has('content-type'))
      headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
  } else if (type !== 'none') {
    body = f(req.body.text);
    const ct = {
      json: 'application/json',
      xml: 'application/xml',
      text: 'text/plain',
    }[type];
    if (!has('content-type')) headers.push(['Content-Type', ct]);
  }
  if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;
  return { method: req.method.toUpperCase(), url, headers, body };
};

// ---------------- captures ----------------
/** `data.items[0].id`, `items.0.id`, `$.token` - a value out of parsed JSON. */
export const jsonPath = (value: unknown, path: string): unknown => {
  const parts = path
    .trim()
    .replace(/^\$\.?/, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\[["']([^"']+)["']\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let cur: any = value;
  // eslint-disable-next-line no-restricted-syntax
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
};

export interface ResponseLike {
  status: number;
  headers: [string, string][];
  body: string;
}

/** What each capture got from a response: values to set, and what could not be found. */
export const runCaptures = (
  captures: Capture[],
  res: ResponseLike,
): { values: Record<string, string>; failed: string[] } => {
  const values: Record<string, string> = {};
  const failed: string[] = [];
  let parsed: unknown;
  let parsedOk = false;
  captures.forEach((c) => {
    if (!c.variable.trim()) return;
    let got: unknown;
    if (c.from === 'status') got = res.status;
    else if (c.from === 'header')
      got = res.headers.find(
        ([k]) => k.toLowerCase() === c.path.trim().toLowerCase(),
      )?.[1];
    else {
      if (!parsedOk) {
        try {
          parsed = JSON.parse(res.body);
        } catch (e) {
          parsed = undefined;
        }
        parsedOk = true;
      }
      got = jsonPath(parsed, c.path);
    }
    if (got === undefined || got === null) failed.push(c.variable);
    else
      values[c.variable.trim()] =
        typeof got === 'object' ? JSON.stringify(got) : String(got);
  });
  return { values, failed };
};

// ---------------- state edits ----------------
export const findRequest = (state: HttpState, id: string | null) => {
  // eslint-disable-next-line no-restricted-syntax
  for (const c of state.collections) {
    const r = c.requests.find((x) => x.id === id);
    if (r) return { collection: c, request: r };
  }
  return null;
};

export const updateCollection = (
  state: HttpState,
  id: string,
  patch: Partial<HttpCollection>,
): HttpState => ({
  ...state,
  collections: state.collections.map((c) =>
    c.id === id ? { ...c, ...patch } : c,
  ),
});

export const updateRequest = (
  state: HttpState,
  id: string,
  patch: Partial<HttpRequest>,
): HttpState => ({
  ...state,
  collections: state.collections.map((c) => ({
    ...c,
    requests: c.requests.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  })),
});

export const removeRequest = (state: HttpState, id: string): HttpState => ({
  ...state,
  collections: state.collections.map((c) => ({
    ...c,
    requests: c.requests.filter((r) => r.id !== id),
  })),
});

export const duplicateRequest = (
  state: HttpState,
  id: string,
): { state: HttpState; id: string | null } => {
  const found = findRequest(state, id);
  if (!found) return { state, id: null };
  const copy: HttpRequest = {
    ...JSON.parse(JSON.stringify(found.request)),
    id: newId('r'),
    name: `${found.request.name} copy`,
  };
  return {
    id: copy.id,
    state: updateCollection(state, found.collection.id, {
      requests: found.collection.requests.flatMap((r) =>
        r.id === id ? [r, copy] : [r],
      ),
    }),
  };
};

/** Moves a request before another one (or to the end of a collection). */
export const moveRequest = (
  state: HttpState,
  id: string,
  toCollection: string,
  beforeId: string | null,
): HttpState => {
  const found = findRequest(state, id);
  if (!found || beforeId === id) return state;
  const without = removeRequest(state, id);
  return {
    ...without,
    collections: without.collections.map((c) => {
      if (c.id !== toCollection) return c;
      const list = [...c.requests];
      const at = beforeId ? list.findIndex((r) => r.id === beforeId) : -1;
      list.splice(at < 0 ? list.length : at, 0, found.request);
      return { ...c, requests: list };
    }),
  };
};

// ---------------- .http files (WebStorm / IntelliJ HTTP Client) ----------------
const authHeaderLine = (auth: Auth): string | null => {
  if (auth.type === 'oauth2' && auth.authId)
    return `Authorization: Bearer ${authTokenRef(auth.authId)}`;
  if (auth.type === 'bearer' && auth.token)
    return `Authorization: Bearer ${auth.token}`;
  if (auth.type === 'basic')
    return `Authorization: Basic ${auth.username || ''} ${auth.password || ''}`;
  if (auth.type === 'apikey' && auth.key && auth.in !== 'query')
    return `${auth.key}: ${auth.value || ''}`;
  return null;
};

export const requestToHttp = (
  req: HttpRequest,
  collection: HttpCollection | null,
): string => {
  const lines = [`### ${req.name}`];
  if (req.delayMs) lines.push(`# @delay ${req.delayMs}`);
  const query = on(req.params).map((p) => `${p.key}=${p.value}`);
  const auth = effectiveAuth(req, collection);
  if (auth.type === 'apikey' && auth.in === 'query' && auth.key)
    query.push(`${auth.key}=${auth.value || ''}`);
  const url = query.length
    ? `${req.url}${req.url.includes('?') ? '&' : '?'}${query.join('&')}`
    : req.url;
  lines.push(`${req.method} ${url}`);
  [...on(collection?.headers || []), ...on(req.headers)].forEach((h) =>
    lines.push(`${h.key}: ${h.value}`),
  );
  const authLine = authHeaderLine(auth);
  if (authLine && !on(req.headers).some((h) => /^authorization$/i.test(h.key)))
    lines.push(authLine);
  const { type } = req.body;
  if (
    type !== 'none' &&
    !on(req.headers).some((h) => /^content-type$/i.test(h.key))
  )
    lines.push(
      `Content-Type: ${
        {
          json: 'application/json',
          xml: 'application/xml',
          text: 'text/plain',
          form: 'application/x-www-form-urlencoded',
        }[type]
      }`,
    );
  if (type === 'form')
    lines.push(
      '',
      on(req.body.form)
        .map((p) => `${p.key}=${p.value}`)
        .join('&'),
    );
  else if (type !== 'none' && req.body.text.trim())
    lines.push('', req.body.text.trim());
  if (req.captures.length) {
    lines.push('', '> {%');
    req.captures.forEach((c) => {
      const expr =
        c.from === 'status'
          ? 'response.status'
          : c.from === 'header'
            ? `response.headers.valueOf("${c.path}")`
            : `response.body${c.path
                .replace(/^\$\.?/, '')
                .split('.')
                .filter(Boolean)
                .map((p) => (/^\d+$/.test(p) ? `[${p}]` : `.${p}`))
                .join('')}`;
      lines.push(`    client.global.set("${c.variable}", ${expr});`);
    });
    lines.push('%}');
  }
  return lines.join('\n');
};

export const collectionToHttp = (collection: HttpCollection) => {
  const vars = on(collection.variables).map((v) => `@${v.key} = ${v.value}`);
  const requests = collection.requests
    .map((r) => requestToHttp(r, collection))
    .join('\n\n');
  return `${vars.length ? `${vars.join('\n')}\n\n` : ''}${requests}\n`;
};

const CAPTURE_RE =
  /client\.global\.set\(\s*["']([\w.-]+)["']\s*,\s*response\.(body((?:\.[\w$]+|\[\d+\]|\[["'][^"']+["']\])*)|status|headers\.valueOf\(\s*["']([^"']+)["']\s*\))\s*\)/g;

/**
 * Reads a .http file: requests (### separated; `> {% client.global.set %}` → captures)
 * and its `@name = value` variables.
 */
export const parseHttpFileFull = (
  text: string,
): { requests: HttpRequest[]; variables: KV[] } => {
  const variables: KV[] = [];
  const setVar = (key: string, value: string) => {
    const at = variables.findIndex((v) => v.key === key);
    if (at >= 0) variables[at] = kv(key, value);
    else variables.push(kv(key, value));
  };
  const blocks = String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/^###.*$/m)
    .map((b, i) => ({ b, i }));
  const names = [...String(text || '').matchAll(/^###[ \t]*(.*)$/gm)].map((m) =>
    m[1].trim(),
  );
  const out: HttpRequest[] = [];
  blocks.forEach(({ b, i }) => {
    const nameFromBlock = i === 0 ? '' : names[i - 1] || '';
    // response handler script
    let script = '';
    const body = b.replace(/^>\s*\{%([\s\S]*?)%\}/m, (all, s) => {
      script = s;
      return '';
    });
    const lines = body.split('\n');
    let delayMs = 0;
    let nameTag = '';
    let k = 0;
    // leading comments / blank lines; `# @name x`, `# @delay 500`, `@host = …`
    for (; k < lines.length; k += 1) {
      const l = lines[k].trim();
      if (!l) continue; // eslint-disable-line no-continue
      const fileVar = /^@([\w.-]+)\s*=\s*(.*)$/.exec(l);
      if (fileVar) {
        setVar(fileVar[1], fileVar[2].trim());
        continue; // eslint-disable-line no-continue
      }
      const tag = /^(?:#|\/\/)\s*@(\w+)\s*(.*)$/.exec(l);
      if (tag) {
        if (tag[1] === 'name') nameTag = tag[2].trim();
        if (tag[1] === 'delay') delayMs = Number(tag[2]) || 0;
        continue; // eslint-disable-line no-continue
      }
      if (/^(#|\/\/)/.test(l)) continue; // eslint-disable-line no-continue
      break;
    }
    if (k >= lines.length) return;
    const first = /^([A-Z]+)\s+(\S+)(?:\s+HTTP\/[\d.]+)?\s*$/.exec(
      lines[k].trim(),
    );
    const short = /^(\S+:\/\/\S+|\{\{[^}]+\}\}\S*)$/.exec(lines[k].trim());
    if (!first && !short) return;
    const method = first ? first[1] : 'GET';
    let url = first ? first[2] : short![1];
    k += 1;
    // continued query lines: `    ?a=1` / `    &b=2`
    while (k < lines.length && /^\s+[?&]/.test(lines[k])) {
      url += lines[k].trim();
      k += 1;
    }
    const headers: KV[] = [];
    for (; k < lines.length && lines[k].trim(); k += 1) {
      const m = /^([^:\s][^:]*):\s?(.*)$/.exec(lines[k]);
      if (m && !/^(#|\/\/)/.test(lines[k].trim()))
        headers.push(kv(m[1].trim(), m[2].trim()));
    }
    const rawBody = lines
      .slice(k + 1)
      // `<> ./previous-response.json` and `> ./handler.js` are not part of the body
      .filter((l) => !/^\s*(<>|>)\s+\S/.test(l))
      .join('\n')
      .trim();
    const ctype =
      headers.find((h) => /^content-type$/i.test(h.key))?.value.toLowerCase() ||
      '';
    let reqBody: Body = { type: 'none', text: '', form: [] };
    if (rawBody) {
      if (/x-www-form-urlencoded/.test(ctype))
        reqBody = {
          type: 'form',
          text: '',
          form: rawBody.split('&').map((p) => {
            const [a, ...rest] = p.split('=');
            return kv(
              decodeURIComponent(a),
              decodeURIComponent(rest.join('=')),
            );
          }),
        };
      else
        reqBody = {
          type: /json/.test(ctype)
            ? 'json'
            : /xml/.test(ctype)
              ? 'xml'
              : 'text',
          text: rawBody,
          form: [],
        };
    }
    // Authorization header → auth (so it can use a {{token}} from a capture)
    let auth: Auth = { type: 'inherit' };
    const authAt = headers.findIndex((h) => /^authorization$/i.test(h.key));
    if (authAt >= 0) {
      const v = headers[authAt].value;
      const oauth =
        /^Bearer\s+\{\{\s*\$auth\.token\(\s*["']([^"']+)["']\s*\)\s*\}\}$/i.exec(
          v,
        );
      const bearer = /^Bearer\s+(.+)$/i.exec(v);
      const basic = /^Basic\s+(\S+)\s+(\S+)$/i.exec(v);
      if (oauth) auth = { type: 'oauth2', authId: oauth[1] };
      else if (bearer) auth = { type: 'bearer', token: bearer[1] };
      else if (basic)
        auth = { type: 'basic', username: basic[1], password: basic[2] };
      if (oauth || bearer || basic) headers.splice(authAt, 1);
    }
    const captures: Capture[] = [];
    [...script.matchAll(CAPTURE_RE)].forEach((m) => {
      if (m[2] === 'status')
        captures.push({ variable: m[1], from: 'status', path: '' });
      else if (m[4])
        captures.push({ variable: m[1], from: 'header', path: m[4] });
      else
        captures.push({
          variable: m[1],
          from: 'json',
          path: (m[3] || '')
            .replace(/\[(\d+)\]/g, '.$1')
            .replace(/\[["']([^"']+)["']\]/g, '.$1')
            .replace(/^\./, ''),
        });
    });
    // query string → params, so it can be edited as a table
    const params: KV[] = [];
    const q = url.indexOf('?');
    if (q >= 0 && !url.slice(q).includes('{{')) {
      url
        .slice(q + 1)
        .split('&')
        .filter(Boolean)
        .forEach((p) => {
          const [a, ...rest] = p.split('=');
          params.push(kv(a, rest.join('=')));
        });
      url = url.slice(0, q);
    }
    out.push(
      newRequest({
        name:
          nameFromBlock ||
          nameTag ||
          `${method} ${url.replace(/^\w+:\/\//, '')}`.slice(0, 60),
        method,
        url,
        params,
        headers,
        body: reqBody,
        auth,
        captures,
        delayMs,
      }),
    );
  });
  return { requests: out, variables };
};

export const parseHttpFile = (text: string): HttpRequest[] =>
  parseHttpFileFull(text).requests;

// ---------------- http-client.env.json ----------------
// WebStorm: { "$shared": {…}, "dev": { "host": "…", "Security": { "Auth": { "id": {
//   "Type": "OAuth2", "Grant Type": "Client Credentials", "Client ID": "…", … } } } } }
// http-client.private.env.json has the same shape (secrets) and is merged into it.

const GRANT_NAMES: Record<string, OAuthGrant> = {
  'client credentials': 'client_credentials',
  client_credentials: 'client_credentials',
  password: 'password',
  'authorization code': 'authorization_code',
  authorization_code: 'authorization_code',
  'authorization code (pkce)': 'authorization_code',
  'client-credentials': 'client_credentials',
  'resource owner password': 'password',
  'password credentials': 'password',
};
const GRANT_LABELS: Record<OAuthGrant, string> = {
  client_credentials: 'Client Credentials',
  password: 'Password',
  authorization_code: 'Authorization Code',
};

const pick = (o: Record<string, unknown>, ...names: string[]) => {
  const keys = Object.keys(o);
  // eslint-disable-next-line no-restricted-syntax
  for (const n of names) {
    const k = keys.find((x) => x.toLowerCase() === n.toLowerCase());
    if (k !== undefined && o[k] !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
};
const str = (v: unknown) => (v === undefined ? '' : String(v));

/**
 * WebStorm's "Custom Request Parameters": { "resource": "x" } or
 * { "audience": { "Value": "x", "Use": "Everywhere" } } - plain values either way.
 */
const customParams = (raw: unknown): Record<string, string> => {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  Object.entries(raw as Record<string, unknown>).forEach(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const value = pick(v as Record<string, unknown>, 'Value');
      if (value !== undefined) out[k] = String(value);
    } else if (Array.isArray(v)) out[k] = v.map(String).join(' ');
    else if (v !== undefined && v !== null) out[k] = String(v);
  });
  return out;
};

const oauthFromJetBrains = (
  id: string,
  raw: Record<string, unknown>,
): OAuthConfig | null => {
  const type = str(pick(raw, 'Type')).toLowerCase();
  if (type && type !== 'oauth2') return null;
  const grant =
    GRANT_NAMES[str(pick(raw, 'Grant Type')).toLowerCase()] ||
    'client_credentials';
  const clientCreds = str(pick(raw, 'Client Credentials')).toLowerCase();
  const pkce = pick(raw, 'PKCE');
  return newOAuth({
    id,
    grant,
    tokenUrl: str(pick(raw, 'Token URL')),
    authUrl: str(pick(raw, 'Auth URL')),
    redirectUrl: str(pick(raw, 'Redirect URL')),
    clientId: str(pick(raw, 'Client ID')),
    clientSecret: str(pick(raw, 'Client Secret')),
    clientAuth:
      clientCreds === 'basic'
        ? 'basic'
        : clientCreds === 'none'
          ? 'none'
          : 'body',
    scope: str(pick(raw, 'Scope')),
    username: str(pick(raw, 'Username')),
    password: str(pick(raw, 'Password')),
    pkce: pkce === true || (typeof pkce === 'object' && pkce !== null),
    audience: str(pick(raw, 'Audience')),
    useIdToken: pick(raw, 'Use ID Token') === true,
    extra: customParams(pick(raw, 'Custom Request Parameters')),
  });
};

const oauthToJetBrains = (a: OAuthConfig) => {
  const out: Record<string, unknown> = {
    Type: 'OAuth2',
    'Grant Type': GRANT_LABELS[a.grant],
    'Client ID': a.clientId,
  };
  if (a.clientSecret) out['Client Secret'] = a.clientSecret;
  if (a.clientAuth !== 'body') out['Client Credentials'] = a.clientAuth;
  if (a.tokenUrl) out['Token URL'] = a.tokenUrl;
  if (a.authUrl) out['Auth URL'] = a.authUrl;
  if (a.redirectUrl) out['Redirect URL'] = a.redirectUrl;
  if (a.scope) out.Scope = a.scope;
  if (a.username) out.Username = a.username;
  if (a.password) out.Password = a.password;
  if (a.audience) out.Audience = a.audience;
  if (a.useIdToken) out['Use ID Token'] = true;
  if (Object.keys(a.extra || {}).length)
    out['Custom Request Parameters'] = { ...a.extra };
  if (a.pkce) out.PKCE = true;
  return out;
};

const asValue = (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x));

/** Reads an env file: environments (with their auth configurations) and `$shared`. */
export const readEnvFile = (
  text: string,
): { environments: HttpEnvironment[]; shared: KV[] } => {
  const v = JSON.parse(text);
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('Expected { "env name": { "variable": "value" } }');
  let shared: KV[] = [];
  const environments: HttpEnvironment[] = [];
  Object.entries(v).forEach(([name, raw]) => {
    const vars =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const variables: KV[] = [];
    const auths: OAuthConfig[] = [];
    Object.entries(vars).forEach(([k, x]) => {
      if (k.toLowerCase() === 'security' && x && typeof x === 'object') {
        const authBlock = pick(x as Record<string, unknown>, 'Auth');
        if (authBlock && typeof authBlock === 'object')
          Object.entries(authBlock as Record<string, unknown>).forEach(
            ([id, conf]) => {
              const a =
                conf && typeof conf === 'object'
                  ? oauthFromJetBrains(id, conf as Record<string, unknown>)
                  : null;
              if (a) auths.push(a);
            },
          );
        return;
      }
      variables.push(kv(k, asValue(x)));
    });
    if (name === '$shared') shared = variables;
    else environments.push({ id: newId('e'), name, variables, auths });
  });
  return { environments, shared };
};

export const environmentsFromJson = (text: string): HttpEnvironment[] =>
  readEnvFile(text).environments;

/** WebStorm's format; constants go to `$shared`. */
export const environmentsToJson = (
  envs: HttpEnvironment[],
  shared: KV[] = [],
) =>
  JSON.stringify(
    Object.fromEntries([
      ...(on(shared).length
        ? [
            [
              '$shared',
              Object.fromEntries(on(shared).map((v) => [v.key, v.value])),
            ],
          ]
        : []),
      ...envs.map((e) => {
        const body: Record<string, unknown> = Object.fromEntries(
          on(e.variables).map((v) => [v.key, v.value]),
        );
        if (e.auths?.length)
          body.Security = {
            Auth: Object.fromEntries(
              e.auths.map((a) => [a.id, oauthToJetBrains(a)]),
            ),
          };
        return [e.name, body];
      }),
    ]),
    null,
    2,
  );

/** Values from `incoming` win; the rest of each list stays (like the private env file). */
export const mergeKVs = (current: KV[], incoming: KV[]): KV[] => {
  const out = current.map((c) => incoming.find((x) => x.key === c.key) || c);
  incoming
    .filter((x) => !current.some((c) => c.key === x.key))
    .forEach((x) => out.push(x));
  return out;
};

const mergeAuths = (current: OAuthConfig[], incoming: OAuthConfig[]) => {
  const out = current.map((c) => {
    const m = incoming.find((x) => x.id === c.id);
    if (!m) return c;
    // the private file often only has the secrets: keep what it leaves empty
    const merged = { ...c };
    (Object.keys(m) as (keyof OAuthConfig)[]).forEach((k) => {
      const val = m[k];
      if (val !== '' && val !== undefined) (merged as any)[k] = val;
    });
    return merged;
  });
  incoming
    .filter((x) => !current.some((c) => c.id === x.id))
    .forEach((x) => out.push(x));
  return out;
};

/** Same-named environments are merged (variables and auth configs), new ones added. */
export const mergeEnvironments = (
  current: HttpEnvironment[],
  incoming: HttpEnvironment[],
): HttpEnvironment[] => {
  const out = current.map((e) => {
    const match = incoming.find((x) => x.name === e.name);
    return match
      ? {
          ...e,
          variables: mergeKVs(e.variables, match.variables),
          auths: mergeAuths(e.auths || [], match.auths || []),
        }
      : e;
  });
  incoming
    .filter((x) => !current.some((e) => e.name === x.name))
    .forEach((x) => out.push(x));
  return out;
};

// ---------------- the collection as an editable .http file ----------------
/**
 * The text shown in the .http editor: its @variables and requests as written, without
 * the collection's own auth / headers folded in (those stay collection settings).
 */
export const collectionToHttpText = (collection: HttpCollection) => {
  const vars = on(collection.variables).map((v) => `@${v.key} = ${v.value}`);
  const requests = collection.requests
    .map((r) => requestToHttp(r, null))
    .join('\n\n');
  return `${vars.length ? `${vars.join('\n')}\n\n` : ''}${requests}\n`;
};

/**
 * Edited text → the collection: requests keep their ids by position (so responses and
 * run states stay with them), and what the text cannot hold (skip) is kept too.
 */
export const applyHttpText = (
  collection: HttpCollection,
  text: string,
): HttpCollection => {
  const { requests, variables } = parseHttpFileFull(text);
  return {
    ...collection,
    variables,
    requests: requests.map((r, i) => {
      const old = collection.requests[i];
      return old ? { ...r, id: old.id, skip: old.skip } : r;
    }),
  };
};

/** Which request (by position) the caret is in; null between / before requests. */
export const requestIndexAt = (text: string, offset: number): number | null => {
  const src = String(text || '').replace(/\r\n/g, '\n');
  const starts = [0];
  const re = /^###.*$/gm;
  let m = re.exec(src);
  while (m) {
    starts.push(m.index);
    m = re.exec(src);
  }
  let count = 0;
  for (let i = 0; i < starts.length; i += 1) {
    const end = i + 1 < starts.length ? starts[i + 1] : src.length;
    const has = parseHttpFile(src.slice(starts[i], end)).length > 0;
    if (offset >= starts[i] && offset <= end) return has ? count : null;
    if (has) count += 1;
  }
  return null;
};
