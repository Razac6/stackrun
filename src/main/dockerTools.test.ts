import {
  connectionStrings,
  dbHostPort,
  detectDb,
  envToMap,
  isSafeContainerRef,
  parseContainers,
  parseMounts,
  parsePorts,
  parseVolumes,
  reclaimedSpace,
} from './dockerTools';
import { filterVolumes } from '../renderer/pages/notes/DockerVolumes';
import { filterContainers } from '../renderer/pages/notes/DockerTool';

const psLine = (o: Record<string, string>) => JSON.stringify(o);

const OUTPUT = [
  psLine({
    ID: 'a1b2c3d4e5f6a7b8c9d0',
    Names: 'shop-db-1',
    Image: 'postgres:16-alpine',
    State: 'running',
    Status: 'Up 2 hours',
    Ports: '0.0.0.0:5433->5432/tcp, :::5433->5432/tcp',
    Labels: 'com.docker.compose.project=shop,com.docker.compose.service=db',
    Mounts: 'shop_pgdata,/Users/me/init.sql',
    CreatedAt: '2026-11-01 10:00:00 +0100 CET',
  }),
  psLine({
    ID: 'ffeeddccbbaa',
    Names: 'cache',
    Image: 'redis:7',
    State: 'exited',
    Status: 'Exited (0) 3 days ago',
    Ports: '',
    Labels: '',
  }),
  'not json',
  psLine({
    ID: '0123456789ab',
    Names: 'web',
    Image: 'nginx:latest',
    State: 'running',
    Status: 'Up 5 minutes',
    Ports: '0.0.0.0:8000-8001->80-81/tcp, 443/tcp',
    Labels: 'com.docker.compose.project=shop',
  }),
].join('\n');

describe('dockerTools', () => {
  it('parses docker ps JSON lines', () => {
    const list = parseContainers(OUTPUT);
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({
      id: 'a1b2c3d4e5f6',
      name: 'shop-db-1',
      state: 'running',
      project: 'shop',
      db: 'postgres',
      ports: [{ hostPort: 5433, containerPort: 5432, protocol: 'tcp' }],
    });
    expect(list[1]).toMatchObject({ db: 'redis', ports: [], project: null });
    expect(list[2].db).toBeNull();
    expect(list[2].ports.map((p) => p.hostPort)).toEqual([8000, 8001]);
  });

  it('recognises database images', () => {
    expect(detectDb('postgres')).toBe('postgres');
    expect(detectDb('docker.io/library/mysql:8.0')).toBe('mysql');
    expect(detectDb('mariadb:11')).toBe('mariadb');
    expect(detectDb('mcr.microsoft.com/mssql/server:2022-latest')).toBe(
      'mssql',
    );
    expect(detectDb('bitnami/mongodb:7')).toBe('mongo');
    expect(detectDb('gvenzl/oracle-free')).toBe('oracle');
    expect(detectDb('node:20')).toBeNull();
    expect(detectDb('my-postgres-exporter:1')).toBeNull();
  });

  it('builds connection strings from env + published port', () => {
    const env = envToMap([
      'POSTGRES_USER=app',
      'POSTGRES_PASSWORD=p@ss word',
      'POSTGRES_DB=shop',
      'PATH=/usr/bin',
    ]);
    const pg = connectionStrings('postgres', env, 5433);
    expect(pg[0].value).toBe(
      'postgresql://app:p%40ss%20word@localhost:5433/shop',
    );
    expect(pg[1].value).toBe('jdbc:postgresql://localhost:5433/shop');
    expect(connectionStrings('postgres', {}, 5432)[0].value).toBe(
      'postgresql://postgres@localhost:5432/postgres',
    );
    expect(
      connectionStrings(
        'mysql',
        { MYSQL_ROOT_PASSWORD: 'root', MYSQL_DATABASE: 'db' },
        3306,
      )[0].value,
    ).toBe('mysql://root:root@localhost:3306/db');
    expect(
      connectionStrings(
        'mongo',
        { MONGO_INITDB_ROOT_USERNAME: 'u', MONGO_INITDB_ROOT_PASSWORD: 'p' },
        27017,
      )[0].value,
    ).toBe('mongodb://u:p@localhost:27017/?authSource=admin');
    expect(connectionStrings('redis', {}, 6379)[0].value).toBe(
      'redis://localhost:6379',
    );
    expect(connectionStrings('postgres', env, null)).toEqual([]);
  });

  it('picks the host port of the database port', () => {
    const [db] = parseContainers(OUTPUT);
    expect(dbHostPort(db)).toBe(5433);
    expect(parsePorts('127.0.0.1:15432->5432/tcp')[0].hostIp).toBe('127.0.0.1');
  });

  it('only passes plain container refs to the CLI', () => {
    expect(isSafeContainerRef('shop-db-1')).toBe(true);
    expect(isSafeContainerRef('a1b2c3d4e5f6')).toBe(true);
    expect(isSafeContainerRef('--rm')).toBe(false);
    expect(isSafeContainerRef('x; rm -rf /')).toBe(false);
    expect(isSafeContainerRef('')).toBe(false);
  });

  it('filters and sorts containers', () => {
    const list = parseContainers(OUTPUT);
    const base = {
      query: '',
      state: 'all' as const,
      dbOnly: false,
      project: '',
    };
    expect(filterContainers(list, base).map((c) => c.name)).toEqual([
      'shop-db-1',
      'web',
      'cache',
    ]);
    expect(
      filterContainers(list, { ...base, state: 'stopped' }).map((c) => c.name),
    ).toEqual(['cache']);
    expect(
      filterContainers(list, { ...base, dbOnly: true }).map((c) => c.name),
    ).toEqual(['shop-db-1', 'cache']);
    expect(
      filterContainers(list, { ...base, query: '5433' }).map((c) => c.name),
    ).toEqual(['shop-db-1']);
    expect(
      filterContainers(list, { ...base, project: 'shop', state: 'running' }),
    ).toHaveLength(2);
  });

  it('lists volumes with users, projects and sizes', () => {
    const containers = parseContainers(OUTPUT);
    expect(containers[0].volumes).toEqual(['shop_pgdata']);
    expect(parseMounts('a,/abs/path,C:\\dir,b')).toEqual(['a', 'b']);
    const anon = 'f'.repeat(64);
    const volumes = parseVolumes(
      [
        JSON.stringify({ Name: anon, Driver: 'local', Labels: '' }),
        JSON.stringify({
          Name: 'shop_pgdata',
          Driver: 'local',
          Labels: 'com.docker.compose.project=shop',
        }),
        JSON.stringify({ Name: 'old_data', Driver: 'local', Labels: '' }),
      ].join('\n'),
      containers,
      JSON.stringify({ Volumes: [{ Name: 'shop_pgdata', Size: '48.2MB' }] }),
    );
    expect(volumes.map((v) => v.name)).toEqual([
      'old_data',
      'shop_pgdata',
      anon,
    ]);
    expect(volumes[1]).toMatchObject({
      project: 'shop',
      usedBy: ['shop-db-1'],
      size: '48.2MB',
    });
    expect(volumes[2].anonymous).toBe(true);
    expect(filterVolumes(volumes, '', true).map((v) => v.name)).toEqual([
      'old_data',
      anon,
    ]);
    expect(filterVolumes(volumes, 'shop-db', false).map((v) => v.name)).toEqual(
      ['shop_pgdata'],
    );
    expect(
      reclaimedSpace('Deleted Volumes:\nx\n\nTotal reclaimed space: 1.2GB'),
    ).toBe('1.2GB');
  });
});

describe('database reset', () => {
  // eslint-disable-next-line global-require
  const {
    resetDbPlan,
    resetDbShellCommand,
    defaultDbName,
  } = require('./dockerTools');

  it('drops and recreates a postgres database', () => {
    const env = {
      POSTGRES_USER: 'app',
      POSTGRES_PASSWORD: "it's",
      POSTGRES_DB: 'shop',
    };
    expect(defaultDbName('postgres', env)).toBe('shop');
    const plan = resetDbPlan('postgres', env, 'shop');
    expect(plan.error).toBeNull();
    const [step] = plan.steps;
    expect(step.env).toEqual({ PGPASSWORD: "it's" });
    expect(step.argv.slice(0, 4)).toEqual(['psql', '-U', 'app', '-d']);
    expect(step.argv).toContain('template1');
    expect(step.argv).toContain('DROP DATABASE IF EXISTS "shop";');
    expect(step.argv).toContain('CREATE DATABASE "shop" OWNER "app";');
    const shell = resetDbShellCommand('shop-db-1', plan.steps);
    expect(
      shell.startsWith(
        "docker exec -e 'PGPASSWORD=it'\\''s' shop-db-1 psql -U app",
      ),
    ).toBe(true);
  });

  it('uses root for mysql and re-grants the app user', () => {
    const plan = resetDbPlan(
      'mysql',
      {
        MYSQL_ROOT_PASSWORD: 'root',
        MYSQL_USER: 'app',
        MYSQL_DATABASE: 'shop',
      },
      'shop',
    );
    const [step] = plan.steps;
    expect(step.env).toEqual({ MYSQL_PWD: 'root' });
    expect(step.argv.slice(0, 3)).toEqual(['mysql', '-u', 'root']);
    expect(step.argv[4]).toContain('DROP DATABASE IF EXISTS `shop`;');
    expect(step.argv[4]).toContain(
      "GRANT ALL PRIVILEGES ON `shop`.* TO 'app'@'%';",
    );
    expect(step.alt[0]).toBe('mariadb');
    expect(resetDbPlan('mariadb', {}, 'x').steps[0].argv[0]).toBe('mariadb');
  });

  it('rejects odd names and unsupported kinds', () => {
    expect(resetDbPlan('postgres', {}, 'x"; DROP').error).toMatch(
      /database name/,
    );
    expect(resetDbPlan('mysql', {}, '').error).toMatch(/database name/);
    expect(resetDbPlan('oracle', {}, 'x').error).toMatch(/supported/);
    expect(resetDbPlan('redis', { REDIS_PASSWORD: 'p' }, '').steps[0]).toEqual({
      env: { REDISCLI_AUTH: 'p' },
      argv: ['redis-cli', 'FLUSHALL'],
    });
  });
});
