import { parseCsv, parseTsv, returnsRows, sqlPlan, toResult } from './sqlTools';

describe('SQL tool', () => {
  it('runs postgres through psql with the container credentials', () => {
    const plan = sqlPlan(
      'postgres',
      { POSTGRES_USER: 'app', POSTGRES_PASSWORD: 'pw' },
      'shop',
      'SELECT 1;',
    )!;
    expect(plan.env).toEqual({ PGPASSWORD: 'pw' });
    expect(plan.argv.slice(0, 6)).toEqual([
      'psql',
      '-X',
      '-U',
      'app',
      '-d',
      'shop',
    ]);
    expect(plan.stdin).toBe('SELECT 1;');
  });

  it('runs mysql / mariadb as root when there is a root password, and counts changes', () => {
    const plan = sqlPlan(
      'mariadb',
      { MARIADB_ROOT_PASSWORD: 'r', MARIADB_USER: 'u' },
      'shop',
      'UPDATE t SET a = 1;',
    )!;
    expect(plan.env).toEqual({ MYSQL_PWD: 'r' });
    expect(plan.argv.slice(0, 3)).toEqual(['mariadb', '-u', 'root']);
    expect(plan.alt![0]).toBe('mysql');
    expect(plan.stdin).toContain('SELECT ROW_COUNT() AS __affected');
    expect(sqlPlan('mysql', {}, '', 'show tables')!.stdin).toBe(
      'show tables;\n',
    );
    expect(sqlPlan('mongo', {}, '', 'x')).toBeNull();
  });

  it('tells reading statements from changes', () => {
    expect(returnsRows('  -- hi\nselect 1')).toBe(true);
    expect(returnsRows('WITH x AS (SELECT 1) SELECT * FROM x')).toBe(true);
    expect(returnsRows('insert into t values (1)')).toBe(false);
  });

  it('parses psql CSV with quotes, commas and new lines', () => {
    expect(parseCsv('id,name\n1,"a, b"\n2,"say ""hi""\nthere"\n')).toEqual([
      ['id', 'name'],
      ['1', 'a, b'],
      ['2', 'say "hi"\nthere'],
    ]);
  });

  it('parses mysql batch output', () => {
    expect(parseTsv('id\tname\n1\ta\\tb\n2\tNULL\n')).toEqual([
      ['id', 'name'],
      ['1', 'a\tb'],
      ['2', 'NULL'],
    ]);
  });

  it('turns output into rows or a status', () => {
    expect(toResult('postgres', 'id,n\n1,a\n2,b\n', 1, 5)).toMatchObject({
      columns: ['id', 'n'],
      rows: [['1', 'a']],
      truncated: true,
      message: '2 rows',
    });
    expect(toResult('postgres', 'UPDATE 3\n', 100, 1).message).toBe('UPDATE 3');
    expect(
      toResult('postgres', 'CREATE TABLE\nINSERT 0 2\nid\n7\n', 100, 1),
    ).toMatchObject({
      columns: ['id'],
      rows: [['7']],
    });
    expect(toResult('mysql', '__affected\n4\n', 100, 1).message).toBe(
      '4 rows affected',
    );
    expect(toResult('mysql', '', 100, 1).message).toBe('Done');
  });
});

describe('SQL connection', () => {
  // eslint-disable-next-line global-require
  const t = require('./sqlTools');
  it('logs in like the image does, or as typed in', () => {
    expect(
      t.credentials('postgres', {
        POSTGRESQL_USERNAME: 'app',
        POSTGRESQL_PASSWORD: 'pw',
      }),
    ).toEqual({ user: 'app', password: 'pw' });
    expect(
      t.credentials('postgres', { POSTGRESQL_POSTGRES_PASSWORD: 'admin' }),
    ).toEqual({ user: 'postgres', password: 'admin' });
    expect(
      t.credentials(
        'postgres',
        { POSTGRES_PASSWORD: 'x' },
        { user: 'me', password: 'mine' },
      ),
    ).toEqual({ user: 'me', password: 'mine' });
    expect(t.defaultDatabase('postgres', { POSTGRESQL_DATABASE: 'shop' })).toBe(
      'shop',
    );
  });

  it('runs in the chosen schema, over TCP when asked', () => {
    const plan = t.sqlPlan('postgres', {}, 'shop', 'SELECT 1;', false, {
      schema: 'billing',
      tcp: true,
    });
    expect(plan.stdin).toBe('SET search_path TO "billing", public;\nSELECT 1;');
    expect(plan.argv).toContain('127.0.0.1');
    // a strange schema name is not put into SQL
    expect(
      t.sqlPlan('postgres', {}, 'shop', 'SELECT 1;', false, {
        schema: 'x"; drop',
      }).stdin,
    ).toBe('SELECT 1;');
    expect(t.listTablesSql('postgres', 'billing')).toContain(
      "n.nspname = 'billing'",
    );
  });

  it('knows a missing socket and a refused login', () => {
    expect(
      t.socketProblem(
        'psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory',
      ),
    ).toBe(true);
    expect(
      t.loginHint('FATAL:  password authentication failed for user "x"'),
    ).toMatch(/Connection/);
  });
});
