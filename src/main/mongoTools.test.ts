import {
  MARK,
  mongoBrowse,
  mongoCell,
  mongoChanges,
  mongoCredentials,
  mongoPlan,
  mongoResult,
  mongoScript,
  mongoStatementAt,
  mongoStatements,
  splitLast,
} from './mongoTools';

const out = (v: unknown, more = false) =>
  `some warning\n${MARK}${JSON.stringify({ v, more })}\n`;

describe('MongoDB in the DB Client', () => {
  it('finds the last statement - with or without semicolons, over lines', () => {
    expect(splitLast('db.a.insertOne({ x: 1 })\ndb.a.find()')).toEqual({
      head: 'db.a.insertOne({ x: 1 })\n',
      last: 'db.a.find()',
    });
    expect(splitLast('db.a\n  .find({})\n  .limit(2);\n// done\n').last).toBe(
      'db.a\n  .find({})\n  .limit(2)',
    );
    expect(splitLast('db.a.find({ s: "x;\\ny" })').last).toBe(
      'db.a.find({ s: "x;\\ny" })',
    );
    expect(
      splitLast('db.a.insertMany([\n  { a: 1 },\n  { a: 2 }\n])').head,
    ).toBe('');
  });

  it('runs the statement under the cursor', () => {
    const code = 'db.a.insertOne({})\ndb.a.find()';
    expect(mongoStatements(code).map((s) => s.text)).toEqual([
      'db.a.insertOne({})',
      'db.a.find()',
    ]);
    expect(mongoStatementAt(code, code.length)?.text).toBe('db.a.find()');
    expect(mongoStatementAt(code, 3)?.text).toBe('db.a.insertOne({})');
  });

  it('captures the value of an expression, not of a declaration', () => {
    expect(mongoScript('db.a.find()', 10)).toContain(
      'let __r = (\ndb.a.find()\n);',
    );
    expect(mongoScript('const x = 1', 10)).toContain('const x = 1\nlet __r;');
  });

  it('logs in like the image does', () => {
    expect(
      mongoCredentials({
        MONGO_INITDB_ROOT_USERNAME: 'root',
        MONGO_INITDB_ROOT_PASSWORD: 'pw',
      }),
    ).toEqual({ user: 'root', password: 'pw', authDb: 'admin' });
    expect(mongoCredentials({ MONGODB_ROOT_PASSWORD: 'b' }).user).toBe('root');
    expect(
      mongoCredentials({ MONGODB_USERNAME: 'app', MONGODB_DATABASE: 'shop' })
        .authDb,
    ).toBe('shop');
    const plan = mongoPlan({}, 'shop', 'db.a.find()', 10, { port: 27018 });
    expect(plan.argv.slice(0, 7)).toEqual([
      'mongosh',
      '--quiet',
      '--norc',
      '--host',
      '127.0.0.1',
      '--port',
      '27018',
    ]);
    expect(plan.alt![0]).toBe('mongo');
  });

  it('turns documents into a table, _id first, ObjectId / Date as text', () => {
    const r = mongoResult(
      out([
        {
          name: 'a',
          _id: { $oid: 'abc' },
          at: { $date: '2020-01-01T00:00:00Z' },
        },
        { _id: { $oid: 'def' }, tags: ['x'], nested: { k: 1 } },
      ]),
      100,
      5,
    );
    expect(r.columns).toEqual(['_id', 'name', 'at', 'tags', 'nested']);
    expect(r.rows[0]).toEqual(['abc', 'a', '2020-01-01T00:00:00Z', '', '']);
    expect(r.rows[1]).toEqual(['def', '', '', '["x"]', '{"k":1}']);
    expect(r.message).toBe('2 documents');
    expect(mongoResult(out([{ a: 1 }], true), 1, 0)).toMatchObject({
      truncated: true,
      message: '1 document+',
    });
  });

  it('says what a write did, shows a value', () => {
    expect(
      mongoResult(
        out({ acknowledged: true, matchedCount: 2, modifiedCount: 1 }),
        9,
        0,
      ).message,
    ).toBe('2 matched, 1 modified');
    expect(
      mongoResult(
        out({ acknowledged: true, insertedIds: { 0: 'a', 1: 'b' } }),
        9,
        0,
      ).message,
    ).toBe('2 documents inserted');
    expect(
      mongoResult(out({ acknowledged: true, deletedCount: 1 }), 9, 0).message,
    ).toBe('1 document deleted');
    expect(mongoResult(out(3), 9, 0).rows).toEqual([['3']]);
    expect(mongoResult(out(null), 9, 0).message).toBe('Done');
    expect(mongoCell({ $numberLong: '12' })).toBe('12');
  });

  it('knows a change and how to browse a collection', () => {
    expect(mongoChanges('db.a.updateMany({}, {$set: {a: 1}})')).toBe(true);
    expect(mongoChanges('db.a.aggregate([{ $merge: "b" }])')).toBe(true);
    expect(mongoChanges('db.a.find({})')).toBe(false);
    expect(mongoBrowse('users')).toBe('db.users.find({}).limit(100)');
    expect(mongoBrowse('my-things')).toBe(
      'db.getCollection("my-things").find({}).limit(100)',
    );
  });
});
