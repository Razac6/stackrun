import { splitStatements, statementAt, toCsv } from './sqlModel';

describe('splitting SQL', () => {
  it('splits on ; but not inside quotes, comments or $$ bodies', () => {
    const sql = `SELECT 'a;b' AS x; -- c;d
INSERT INTO t VALUES (1, "q;q");
/* skip; this */ UPDATE t SET a = 1;
CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;
SELECT \`a;b\` FROM t`;
    expect(splitStatements(sql).map((s) => s.text.split(/\s+/)[0])).toEqual([
      'SELECT',
      '--',
      '/*',
      'CREATE',
      'SELECT',
    ]);
    expect(splitStatements(sql)[3].text).toContain('END; $$ LANGUAGE plpgsql');
    expect(splitStatements('  ;; -- only a comment\n')).toEqual([]);
  });

  it('finds the statement under the cursor', () => {
    const sql = 'SELECT 1;\nSELECT 2;\n\nSELECT 3';
    expect(statementAt(sql, 3)!.text).toBe('SELECT 1');
    expect(statementAt(sql, sql.indexOf('2'))!.text).toBe('SELECT 2');
    expect(statementAt(sql, sql.length)!.text).toBe('SELECT 3');
    expect(statementAt('', 0)).toBeNull();
  });

  it('copies rows as CSV', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['1', 'x,y'],
          ['2', 'say "hi"'],
        ],
      ),
    ).toBe('a,b\n1,"x,y"\n2,"say ""hi"""');
  });
});

describe('searching the result and timing queries', () => {
  // eslint-disable-next-line global-require
  const m = require('./sqlModel');
  // eslint-disable-next-line global-require
  const t = require('../../../main/sqlTools');
  const rows = [
    ['1', 'anna', '30', 'NULL'],
    ['2', 'Bob', '17', 'x@y.z'],
    ['3', 'bobby', '45', ''],
  ];

  it('filters by any cell and per column', () => {
    expect(m.filterRows(rows, 'bob', {})).toEqual([1, 2]);
    expect(m.filterRows(rows, '', { 2: '>18' })).toEqual([0, 2]);
    expect(m.filterRows(rows, '', { 1: '=bob' })).toEqual([1]);
    expect(m.filterRows(rows, '', { 1: '!bob' })).toEqual([0]);
    expect(m.filterRows(rows, '', { 3: 'null' })).toEqual([0, 2]);
    expect(m.filterRows(rows, '', { 3: '!null' })).toEqual([1]);
    expect(m.filterRows(rows, 'bob', { 2: '<=17' })).toEqual([1]);
    expect(m.filterRows(rows, '', { 0: ' ' })).toEqual([0, 1, 2]);
  });

  it('keeps timings per query and compares them', () => {
    const key = m.timingKey('pg', 'shop', 'SELECT *\n  FROM t ;');
    expect(key).toBe(m.timingKey('pg', 'shop', 'SELECT * FROM t'));
    const one = {
      at: 1,
      label: 'before',
      ms: 40,
      minMs: 38,
      maxMs: 45,
      method: 'server',
    };
    let all = m.addTiming({}, key, one);
    all = m.addTiming(all, key, { ...one, at: 2, label: 'after', ms: 10 });
    expect(all[key].map((x: any) => x.label)).toEqual(['before', 'after']);
    expect(m.change(10, 40)).toEqual({ pct: -75, text: '-75%', faster: true });
    expect(m.change(44, 40).text).toBe('+10%');
    expect(m.change(5)).toBeNull();
    expect(m.msText(0.423)).toBe('0.42 ms');
    expect(m.msText(1234)).toBe('1.23 s');
    expect(m.parseTimings('nope')).toEqual({});
  });

  it('reads the server time from EXPLAIN ANALYZE', () => {
    expect(t.explainAnalyzeSql('SELECT 1;')).toBe(
      'EXPLAIN (ANALYZE, FORMAT JSON) SELECT 1;',
    );
    expect(
      t.explainTime(
        JSON.stringify([
          { Plan: {}, 'Planning Time': 0.5, 'Execution Time': 2.25 },
        ]),
      ),
    ).toBe(2.75);
    expect(t.explainTime('not json')).toBeNull();
    const pg = t.serverTiming('postgres', 'UPDATE t SET a = 1;');
    expect(pg.sql).toBe('EXPLAIN (ANALYZE, FORMAT JSON) UPDATE t SET a = 1;');
    expect(
      pg.read(['QUERY PLAN', '[{"Execution Time": 3, "Planning Time": 1}]']),
    ).toBe(4);
    const my = t.serverTiming('mysql', 'SELECT * FROM t');
    expect(
      my.read([
        '-> Filter: (t.h = 1)  (cost=5 rows=1) (actual time=0.05..12.5 rows=1 loops=1)\n    -> Table scan on t  (actual time=0.01..9 rows=50000 loops=1)',
      ]),
    ).toBe(12.5);
    expect(
      t
        .serverTiming('mariadb', 'SELECT 1')
        .read(['{ "r_total_time_ms": 0.75 }']),
    ).toBe(0.75);
    expect(t.serverTiming('mysql', 'UPDATE t SET a = 1')).toBeNull();
    expect(t.serverTiming('postgres', 'SELECT 1; SELECT 2')).toBeNull();
    expect(t.median([5, 1, 3])).toBe(3);
    expect(t.median([4, 1, 3, 2])).toBe(2.5);
  });
});
