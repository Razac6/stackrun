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
