// What WebStorm users actually have: @file variables, $auth.token, several environments
// in one http-client.env.json with Security.Auth, plus a private file with the secrets.
import {
  applyHttpText,
  authIdsUsed,
  buildRequest,
  collectionToHttpText,
  emptyState,
  environmentsToJson,
  fill,
  mergeEnvironments,
  mergeKVs,
  newCollection,
  parseHttpFileFull,
  readEnvFile,
  requestIndexAt,
  resolveOAuth,
  variablesFor,
} from './httpModel';

const httpFile = `@baseUrl = {{host}}/api/v1

### Get token (password)
POST {{host}}/auth/token
Content-Type: application/x-www-form-urlencoded

grant_type=password&username={{user}}&password={{password}}

> {%
    client.global.set("access_token", response.body["access_token"]);
%}

### List orders
GET {{baseUrl}}/orders?status=open
Authorization: Bearer {{$auth.token("keycloak")}}
Accept: application/json

<> 2024-01-01T000000.200.json

### Create order
POST {{baseUrl}}/orders HTTP/1.1
Authorization: Bearer {{access_token}}
Content-Type: application/json

{
  "item": "x"
}
`;

const envFile = `{
  "$shared": { "apiVersion": "v1" },
  "local": {
    "host": "http://localhost:3000",
    "user": "dev",
    "Security": { "Auth": { "keycloak": {
      "Type": "OAuth2",
      "Grant Type": "Client Credentials",
      "Client ID": "orders-api",
      "Client Secret": "{{clientSecret}}",
      "Client Credentials": "basic",
      "Token URL": "{{host}}/realms/dev/protocol/openid-connect/token",
      "Scope": "openid"
    } } }
  },
  "dev": { "host": "https://dev.example.com", "user": "qa" }
}`;
const privateFile = `{ "local": { "password": "secret", "clientSecret": "s3cr3t" }, "dev": { "password": "devpass" } }`;

describe('WebStorm .http files', () => {
  it('keeps @variables, $auth.token as OAuth, drops response references', () => {
    const { requests, variables } = parseHttpFileFull(httpFile);
    expect(variables).toEqual([
      { key: 'baseUrl', value: '{{host}}/api/v1', enabled: true },
    ]);
    expect(requests.map((r) => r.name)).toEqual([
      'Get token (password)',
      'List orders',
      'Create order',
    ]);
    expect(requests[1].auth).toEqual({ type: 'oauth2', authId: 'keycloak' });
    expect(requests[1].body.type).toBe('none'); // the <> line is not a body
    expect(requests[2].auth).toEqual({
      type: 'bearer',
      token: '{{access_token}}',
    });
  });

  it('fills $auth.token from a fetched token and @variables from the file', () => {
    const { requests, variables } = parseHttpFileFull(httpFile);
    const col = newCollection({ requests, variables });
    const vars = {
      ...variablesFor(
        {
          ...emptyState(),
          environments: [{ id: 'l', name: 'local', variables: [], auths: [] }],
          activeEnv: 'l',
          constants: [{ key: 'host', value: 'http://h', enabled: true }],
        },
        col,
      ),
      '$auth.token:keycloak': 'TOKEN',
    };
    expect(authIdsUsed(requests[1], col)).toEqual(['keycloak']);
    const built = buildRequest(requests[1], col, vars);
    expect(built.url).toBe('http://h/api/v1/orders?status=open');
    expect(built.headers).toContainEqual(['Authorization', 'Bearer TOKEN']);
    expect(fill('{{$auth.token("keycloak")}}', {})).toBe(
      '{{$auth.token("keycloak")}}',
    );
  });
});

describe('WebStorm env files', () => {
  it('reads several environments, $shared and Security.Auth, then the private file', () => {
    const main = readEnvFile(envFile);
    expect(main.shared).toEqual([
      { key: 'apiVersion', value: 'v1', enabled: true },
    ]);
    expect(main.environments.map((e) => e.name)).toEqual(['local', 'dev']);
    const local = main.environments[0];
    expect(local.variables.map((v) => v.key)).toEqual(['host', 'user']);
    expect(local.auths).toEqual([
      expect.objectContaining({
        id: 'keycloak',
        grant: 'client_credentials',
        clientId: 'orders-api',
        clientSecret: '{{clientSecret}}',
        clientAuth: 'basic',
        scope: 'openid',
      }),
    ]);

    const merged = mergeEnvironments(
      main.environments,
      readEnvFile(privateFile).environments,
    );
    // the private file adds to the variables, it does not wipe them
    expect(merged[0].variables.map((v) => [v.key, v.value])).toEqual([
      ['host', 'http://localhost:3000'],
      ['user', 'dev'],
      ['password', 'secret'],
      ['clientSecret', 's3cr3t'],
    ]);
    expect(merged[0].auths).toHaveLength(1);
    const resolved = resolveOAuth(merged[0].auths[0], {
      host: 'http://localhost:3000',
      clientSecret: 's3cr3t',
    });
    expect(resolved.tokenUrl).toBe(
      'http://localhost:3000/realms/dev/protocol/openid-connect/token',
    );
    expect(resolved.clientSecret).toBe('s3cr3t');
    expect(mergeKVs([], main.shared)).toEqual(main.shared);
  });

  it('writes the same shape back', () => {
    const { environments, shared } = readEnvFile(envFile);
    const again = readEnvFile(environmentsToJson(environments, shared));
    expect(again.shared).toEqual(shared);
    expect(
      again.environments.map((e) => [
        e.name,
        e.variables,
        e.auths.map((a) => ({ ...a })),
      ]),
    ).toEqual(
      environments.map((e) => [
        e.name,
        e.variables,
        e.auths.map((a) => ({ ...a })),
      ]),
    );
  });
});

describe('the .http text editor', () => {
  it('round-trips a collection and keeps request ids by position', () => {
    const { requests, variables } = parseHttpFileFull(httpFile);
    const col = newCollection({ requests, variables });
    const text = collectionToHttpText(col);
    const back = applyHttpText(col, text);
    expect(back.requests.map((r) => r.id)).toEqual(
      col.requests.map((r) => r.id),
    );
    expect(back.variables).toEqual(col.variables);
    const edited = applyHttpText(
      col,
      text.replace('List orders', 'All orders'),
    );
    expect(edited.requests[1]).toMatchObject({
      id: col.requests[1].id,
      name: 'All orders',
    });
  });

  it('finds the request under the cursor', () => {
    expect(requestIndexAt(httpFile, 5)).toBeNull(); // the @variable line
    expect(requestIndexAt(httpFile, httpFile.indexOf('/auth/token'))).toBe(0);
    expect(requestIndexAt(httpFile, httpFile.indexOf('status=open'))).toBe(1);
    expect(requestIndexAt(httpFile, httpFile.indexOf('"item"'))).toBe(2);
  });
});
