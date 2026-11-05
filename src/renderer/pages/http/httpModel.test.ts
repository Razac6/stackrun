import {
  buildRequest,
  collectionToHttp,
  emptyState,
  environmentsFromJson,
  environmentsToJson,
  fill,
  jsonPath,
  kv,
  mergeEnvironments,
  missingVariables,
  moveRequest,
  newCollection,
  newRequest,
  parseHttpFile,
  parseState,
  runCaptures,
  variablesFor,
} from './httpModel';

describe('variables', () => {
  it('fills {{names}}, nested ones, dynamic ones; reports the missing', () => {
    const missing = new Set<string>();
    expect(
      fill(
        '{{host}}/a/{{ id }}/{{nope}}',
        { host: '{{base}}:3000', base: 'http://x', id: '7' },
        missing,
      ),
    ).toBe('http://x:3000/a/7/{{nope}}');
    expect([...missing]).toEqual(['nope']);
    expect(fill('{{$uuid}}', {})).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('lets captured values win over the environment, and that over constants', () => {
    const s = {
      ...emptyState(),
      constants: [kv('a', 'const'), kv('b', 'const'), kv('c', 'const')],
      environments: [
        {
          id: 'e',
          name: 'dev',
          variables: [kv('b', 'env'), kv('c', 'env')],
          auths: [],
        },
      ],
      activeEnv: 'e',
      captured: { c: 'captured' },
    };
    expect(variablesFor(s)).toEqual({ a: 'const', b: 'env', c: 'captured' });
  });
});

describe('buildRequest', () => {
  const vars = { host: 'http://api', token: 'T0K', user: 'ann' };
  it('adds params, auth from the collection, json content type', () => {
    const col = newCollection({
      auth: { type: 'bearer', token: '{{token}}' },
      headers: [kv('X-App', 'stackrun')],
    });
    const req = newRequest({
      method: 'post',
      url: '{{host}}/items',
      params: [kv('q', 'a b'), kv('off', '1', false)],
      body: { type: 'json', text: '{"u":"{{user}}"}', form: [] },
    });
    expect(buildRequest(req, col, vars)).toEqual({
      method: 'POST',
      url: 'http://api/items?q=a%20b',
      headers: [
        ['X-App', 'stackrun'],
        ['Authorization', 'Bearer T0K'],
        ['Content-Type', 'application/json'],
      ],
      body: '{"u":"ann"}',
    });
  });

  it('does basic auth, api keys in the query, forms', () => {
    const basic = buildRequest(
      newRequest({
        url: 'localhost:1/x',
        auth: { type: 'basic', username: 'u', password: 'ż' },
      }),
      null,
      {},
    );
    expect(basic.url).toBe('http://localhost:1/x');
    expect(basic.headers[0][1]).toBe(
      `Basic ${Buffer.from('u:ż').toString('base64')}`,
    );
    const key = buildRequest(
      newRequest({
        url: 'http://a/?x=1',
        auth: { type: 'apikey', key: 'k', value: 'v', in: 'query' },
      }),
      null,
      {},
    );
    expect(key.url).toBe('http://a/?x=1&k=v');
    const form = buildRequest(
      newRequest({
        method: 'POST',
        url: 'http://a',
        body: { type: 'form', text: '', form: [kv('a', '1 2'), kv('b', '&')] },
      }),
      null,
      {},
    );
    expect(form.body).toBe('a=1%202&b=%26');
  });

  it('lists variables without a value', () => {
    expect(
      missingVariables(newRequest({ url: '{{host}}/{{id}}' }), null, {
        host: 'h',
      }),
    ).toEqual(['id']);
  });
});

describe('captures', () => {
  const res = {
    status: 201,
    headers: [['Location', '/items/9']] as [string, string][],
    body: JSON.stringify({ data: { token: 'abc', items: [{ id: 5 }] } }),
  };
  it('reads json paths, headers and the status', () => {
    expect(jsonPath({ a: [{ b: 1 }] }, '$.a[0].b')).toBe(1);
    expect(
      runCaptures(
        [
          { variable: 'token', from: 'json', path: 'data.token' },
          { variable: 'first', from: 'json', path: 'data.items[0].id' },
          { variable: 'items', from: 'json', path: 'data.items' },
          { variable: 'loc', from: 'header', path: 'location' },
          { variable: 'code', from: 'status', path: '' },
          { variable: 'gone', from: 'json', path: 'data.nope' },
        ],
        res,
      ),
    ).toEqual({
      values: {
        token: 'abc',
        first: '5',
        items: '[{"id":5}]',
        loc: '/items/9',
        code: '201',
      },
      failed: ['gone'],
    });
  });
});

describe('.http files', () => {
  const file = `### Login
POST {{host}}/auth/login
Content-Type: application/json

{"user": "ann"}

> {%
    client.global.set("token", response.body.data.token);
    client.global.set("loc", response.headers.valueOf("Location"));
%}

### List items
# @delay 500
GET {{host}}/items?page=1&size=20
Authorization: Bearer {{token}}

###
https://example.com/ping
`;

  it('reads requests, captures, delays, auth and params', () => {
    const reqs = parseHttpFile(file);
    expect(reqs).toHaveLength(3);
    expect(reqs[0]).toMatchObject({
      name: 'Login',
      method: 'POST',
      url: '{{host}}/auth/login',
      body: { type: 'json', text: '{"user": "ann"}' },
      captures: [
        { variable: 'token', from: 'json', path: 'data.token' },
        { variable: 'loc', from: 'header', path: 'Location' },
      ],
    });
    expect(reqs[1]).toMatchObject({
      name: 'List items',
      delayMs: 500,
      url: '{{host}}/items',
      params: [kv('page', '1'), kv('size', '20')],
      auth: { type: 'bearer', token: '{{token}}' },
      headers: [],
    });
    expect(reqs[2]).toMatchObject({
      method: 'GET',
      url: 'https://example.com/ping',
    });
  });

  it('writes what it reads', () => {
    const col = newCollection({ requests: parseHttpFile(file) });
    const again = parseHttpFile(collectionToHttp(col));
    const strip = (r: any) => ({ ...r, id: '' });
    expect(again.map(strip)).toEqual(col.requests.map(strip));
  });
});

describe('environments and state', () => {
  it('round-trips http-client.env.json and merges by name', () => {
    const envs = environmentsFromJson(
      '{"dev":{"host":"http://d","port":3000},"prod":{"host":"http://p"}}',
    );
    expect(envs.map((e) => e.name)).toEqual(['dev', 'prod']);
    expect(envs[0].variables).toEqual([
      kv('host', 'http://d'),
      kv('port', '3000'),
    ]);
    expect(JSON.parse(environmentsToJson(envs))).toEqual({
      dev: { host: 'http://d', port: '3000' },
      prod: { host: 'http://p' },
    });
    const merged = mergeEnvironments(
      [{ id: 'x', name: 'dev', variables: [], auths: [] }],
      envs,
    );
    expect(merged.map((e) => [e.id === 'x', e.name])).toEqual([
      [true, 'dev'],
      [false, 'prod'],
    ]);
    expect(() => environmentsFromJson('[1]')).toThrow();
  });

  it('parses anything stored without breaking', () => {
    expect(parseState('nope').collections).toEqual([]);
    const s = parseState({
      collections: [
        {
          name: 'A',
          requests: [
            {
              method: 'post',
              delayMs: -5,
              captures: [{ variable: 't', from: 'odd' }],
            },
          ],
        },
      ],
      activeEnv: 'missing',
    });
    expect(s.collections[0].requests[0]).toMatchObject({
      method: 'POST',
      delayMs: 0,
      captures: [{ variable: 't', from: 'json' }],
    });
    expect(s.activeEnv).toBe('env-local');
  });

  it('moves requests between collections', () => {
    const a = newRequest({ name: 'a' });
    const b = newRequest({ name: 'b' });
    const c1 = newCollection({ requests: [a, b] });
    const c2 = newCollection({ requests: [] });
    let s = { ...emptyState(), collections: [c1, c2] };
    s = moveRequest(s, b.id, c1.id, a.id);
    expect(s.collections[0].requests.map((r) => r.name)).toEqual(['b', 'a']);
    s = moveRequest(s, a.id, c2.id, null);
    expect(s.collections.map((c) => c.requests.map((r) => r.name))).toEqual([
      ['b'],
      ['a'],
    ]);
  });
});
