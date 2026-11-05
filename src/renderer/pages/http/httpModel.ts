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

export type AuthType = 'inherit' | 'none' | 'bearer' | 'basic' | 'apikey';
export interface Auth {
  type: AuthType;
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
  auth: Auth; // what "inherit" means for its requests
  headers: KV[]; // added to each of its requests
  stopOnError: boolean; // a collection run stops at a failed request
  collapsed?: boolean;
}

export interface HttpEnvironment {
  id: string;
  name: string;
  variables: KV[];
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

const AUTH_TYPES: AuthType[] = ['inherit', 'none', 'bearer', 'basic', 'apikey'];
const asAuth = (a: any, fallback: AuthType): Auth => {
  const type = AUTH_TYPES.includes(a?.type) ? a.type : fallback;
  return {
    type,
    token: a?.token ? String(a.token) : undefined,
    username: a?.username ? String(a.username) : undefined,
    password: a?.password ? String(a.password) : undefined,
    key: a?.key ? String(a.key) : undefined,
    value: a?.value ? String(a.value) : undefined,
    in: a?.in === 'query' ? 'query' : 'header',
  };
};

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

/** Constants < environment < captured: later ones win. */
export const variablesFor = (state: HttpState): Record<string, string> => {
  const env = state.environments.find((e) => e.id === state.activeEnv);
  const out: Record<string, string> = {};
  on(state.constants).forEach((x) => {
    out[x.key.trim()] = x.value;
  });
  on(env?.variables || []).forEach((x) => {
    out[x.key.trim()] = x.value;
  });
  Object.assign(out, state.captured);
  return out;
};

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
  String(text ?? '').replace(
    /\{\{\s*([$\w.-]+)\s*\}\}/g,
    (all, name: string) => {
      if (name in vars)
        return depth < 5
          ? fill(vars[name], vars, missing, depth + 1)
          : vars[name];
      if (DYNAMIC[name]) return DYNAMIC[name]();
      missing?.add(name);
      return all;
    },
  );

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

export const collectionToHttp = (collection: HttpCollection) =>
  `${collection.requests.map((r) => requestToHttp(r, collection)).join('\n\n')}\n`;

const CAPTURE_RE =
  /client\.global\.set\(\s*["']([\w.-]+)["']\s*,\s*response\.(body((?:\.[\w$]+|\[\d+\]|\[["'][^"']+["']\])*)|status|headers\.valueOf\(\s*["']([^"']+)["']\s*\))\s*\)/g;

/** Reads a .http file into requests (### separated; `> {% client.global.set %}` → captures). */
export const parseHttpFile = (text: string): HttpRequest[] => {
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
    // leading comments / blank lines; `# @name x`, `# @delay 500`
    for (; k < lines.length; k += 1) {
      const l = lines[k].trim();
      if (!l) continue; // eslint-disable-line no-continue
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
      const bearer = /^Bearer\s+(.+)$/i.exec(v);
      const basic = /^Basic\s+(\S+)\s+(\S+)$/i.exec(v);
      if (bearer) auth = { type: 'bearer', token: bearer[1] };
      else if (basic)
        auth = { type: 'basic', username: basic[1], password: basic[2] };
      if (bearer || basic) headers.splice(authAt, 1);
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
  return out;
};

// ---------------- http-client.env.json ----------------
/** `{ "dev": { "host": "…" }, "prod": {…} }` - JetBrains' environment file. */
export const environmentsToJson = (envs: HttpEnvironment[]) =>
  JSON.stringify(
    Object.fromEntries(
      envs.map((e) => [
        e.name,
        Object.fromEntries(on(e.variables).map((v) => [v.key, v.value])),
      ]),
    ),
    null,
    2,
  );

export const environmentsFromJson = (text: string): HttpEnvironment[] => {
  const v = JSON.parse(text);
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('Expected { "env name": { "variable": "value" } }');
  return Object.entries(v).map(([name, vars]) => ({
    id: newId('e'),
    name,
    variables:
      vars && typeof vars === 'object'
        ? Object.entries(vars as Record<string, unknown>).map(([k, x]) =>
            kv(k, typeof x === 'string' ? x : JSON.stringify(x)),
          )
        : [],
  }));
};

/** Environments read from a file replace same-named ones and add the rest. */
export const mergeEnvironments = (
  current: HttpEnvironment[],
  incoming: HttpEnvironment[],
): HttpEnvironment[] => {
  const out = current.map((e) => {
    const match = incoming.find((x) => x.name === e.name);
    return match ? { ...e, variables: match.variables } : e;
  });
  incoming
    .filter((x) => !current.some((e) => e.name === x.name))
    .forEach((x) => out.push(x));
  return out;
};
