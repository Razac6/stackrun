import {
  Note,
  emptyFilter,
  filterNotes,
  sortNotes,
  paginate,
  fileToNote,
  noteToFile,
  snippet,
} from './notesModel';
import {
  parseJson,
  diffJson,
  lineDiff,
  formatJson,
  tokenizeJson,
} from './jsonTools';
import { parseCurl, parseFetch, toHttpClient, shellSplit } from './httpConvert';

const note = (over: Partial<Note>): Note => ({
  title: 'T',
  content: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  notebook: '',
  tags: [],
  pinned: false,
  format: 'markdown',
  ...over,
});

describe('notesModel', () => {
  const notes = [
    note({
      id: 1,
      title: 'Alpha',
      tags: ['api'],
      notebook: 'Work',
      updatedAt: '2026-01-03',
    }),
    note({
      id: 2,
      title: 'Beta',
      content: 'Payload for orders',
      updatedAt: '2026-01-05',
    }),
    note({
      id: 3,
      title: 'Gamma',
      pinned: true,
      format: 'json',
      updatedAt: '2026-01-01',
    }),
  ];

  it('filters by query words, notebook, tag and format', () => {
    expect(
      filterNotes(notes, { ...emptyFilter, query: 'orders payload' }).map(
        (n) => n.id,
      ),
    ).toEqual([2]);
    expect(
      filterNotes(notes, { ...emptyFilter, query: '#api' }).map((n) => n.id),
    ).toEqual([1]);
    expect(
      filterNotes(notes, { ...emptyFilter, notebook: 'Work' }).map((n) => n.id),
    ).toEqual([1]);
    expect(
      filterNotes(notes, { ...emptyFilter, notebook: '' }).map((n) => n.id),
    ).toEqual([2, 3]);
    expect(
      filterNotes(notes, { ...emptyFilter, format: 'json' }).map((n) => n.id),
    ).toEqual([3]);
  });

  it('sorts pinned first, then newest edit', () => {
    expect(sortNotes(notes, 'updated').map((n) => n.id)).toEqual([3, 2, 1]);
    expect(sortNotes(notes, 'title').map((n) => n.id)).toEqual([3, 1, 2]);
  });

  it('paginates and clamps the page', () => {
    const r = paginate([1, 2, 3, 4, 5], 9, 2);
    expect(r).toEqual({ page: 3, pageCount: 3, items: [5] });
  });

  it('round-trips markdown with front matter', () => {
    const original = note({
      title: 'API: notes',
      notebook: 'Work',
      tags: ['api', 'json'],
      pinned: true,
      content: '# Hi\n\nBody',
    });
    const file = noteToFile(original);
    expect(file.fileName).toBe('API-notes.md');
    const back = fileToNote(file.fileName, file.content);
    expect(back).toMatchObject({
      title: 'API: notes',
      notebook: 'Work',
      tags: ['api', 'json'],
      pinned: true,
      content: '# Hi\n\nBody',
      format: 'markdown',
    });
  });

  it('imports plain markdown (heading = title), block tag lists and json files', () => {
    expect(fileToNote('x.md', '# Title\n\ntext')).toMatchObject({
      title: 'Title',
      content: 'text',
    });
    expect(
      fileToNote('x.md', '---\ntags:\n  - A\n  - b c\n---\nbody').tags,
    ).toEqual(['a', 'b-c']);
    expect(fileToNote('resp.json', '{"a":1}')).toMatchObject({
      title: 'resp',
      format: 'json',
    });
  });

  it('strips markdown from snippets', () => {
    expect(
      snippet(note({ content: '## Head\n- **bold** [link](http://x)' })),
    ).toBe('Head bold link');
  });
});

describe('jsonTools', () => {
  it('reports the error position', () => {
    const r = parseJson('{\n  "a": 1,\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.line).toBe(3);
  });

  it('formats with sorted keys', () => {
    expect(formatJson({ b: 1, a: { d: 1, c: 2 } }, 0, true)).toBe(
      '{"a":{"c":2,"d":1},"b":1}',
    );
  });

  it('diffs by path', () => {
    const d = diffJson(
      { a: 1, b: { c: [1, 2] }, gone: true },
      { a: 2, b: { c: [1] }, 'new key': null },
    );
    expect(d).toEqual([
      { path: '$.a', kind: 'changed', left: 1, right: 2 },
      { path: '$.b.c[1]', kind: 'removed', left: 2 },
      { path: '$.gone', kind: 'removed', left: true },
      { path: '$["new key"]', kind: 'added', right: null },
    ]);
  });

  it('line diff pairs changed lines', () => {
    const rows = lineDiff('a\nb\nc', 'a\nB\nc\nd');
    expect(rows.map((r) => r.kind)).toEqual([
      'same',
      'changed',
      'same',
      'added',
    ]);
    expect(rows[1]).toMatchObject({
      left: 'b',
      right: 'B',
      leftNo: 2,
      rightNo: 2,
    });
  });

  it('tokenizes keys and values', () => {
    const types = tokenizeJson('{"k": "v", "n": 1, "b": true, "z": null}')
      .filter((t) => t.type !== 'text' && t.type !== 'punct')
      .map((t) => t.type);
    expect(types).toEqual([
      'key',
      'string',
      'key',
      'number',
      'key',
      'boolean',
      'key',
      'null',
    ]);
  });
});

describe('httpConvert', () => {
  it('parses a bash "Copy as cURL"', () => {
    const req = parseCurl(
      `curl 'https://api.example.com/orders?x=1' \\\n  -H 'accept: application/json' \\\n  -H 'sec-ch-ua: "Chromium"' \\\n  -H 'authorization: Bearer abc' \\\n  --data-raw $'{"name":"it\\'s"}' \\\n  --compressed`,
    );
    expect(req).toEqual({
      method: 'POST',
      url: 'https://api.example.com/orders?x=1',
      headers: [
        ['accept', 'application/json'],
        ['sec-ch-ua', '"Chromium"'],
        ['authorization', 'Bearer abc'],
      ],
      body: '{"name":"it\'s"}',
    });
    expect(toHttpClient(req, { name: 'Create order' })).toBe(
      '### Create order\nPOST https://api.example.com/orders?x=1\naccept: application/json\nauthorization: Bearer abc\n\n{\n  "name": "it\'s"\n}\n',
    );
  });

  it('parses a Windows cmd "Copy as cURL"', () => {
    const req = parseCurl(
      'curl ^"https://x.dev/a^" ^\n  -H ^"content-type: application/json^" ^\n  --data-raw ^"^{^\\^"a^\\^":1^}^"',
    );
    expect(req.url).toBe('https://x.dev/a');
    expect(req.headers).toEqual([['content-type', 'application/json']]);
    expect(req.body).toBe('{"a":1}');
  });

  it('parses "Copy as fetch"', () => {
    const req = parseFetch(
      'fetch("https://x.dev/api", {\n  "headers": {\n    "accept": "*/*"\n  },\n  "body": "{\\"a\\":1}",\n  "method": "PUT",\n  "mode": "cors"\n});',
    );
    expect(req).toEqual({
      method: 'PUT',
      url: 'https://x.dev/api',
      headers: [['accept', '*/*']],
      body: '{"a":1}',
    });
  });

  it('splits shell words', () => {
    expect(shellSplit(`a 'b c' "d \\"e\\"" f\\ g`)).toEqual([
      'a',
      'b c',
      'd "e"',
      'f g',
    ]);
  });
});

describe('base64Tools', () => {
  // eslint-disable-next-line global-require
  const { decodeBase64, bytesToBase64 } = require('./base64Tools');

  it('decodes a PDF and detects its type', () => {
    const b64 = btoa('%PDF-1.4\n%âãÏÓ\n');
    expect(decodeBase64(b64)).toMatchObject({
      mime: 'application/pdf',
      extension: 'pdf',
    });
  });

  it('accepts data URLs, URL-safe chars, whitespace and missing padding', () => {
    const png = String.fromCharCode(
      0x89,
      0x50,
      0x4e,
      0x47,
      13,
      10,
      26,
      10,
      0xfb,
      0xff,
    );
    const b64 = btoa(png);
    const urlSafe = b64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const r = decodeBase64(
      `data:image/png;base64,${urlSafe.slice(0, 4)}\n${urlSafe.slice(4)}`,
    );
    expect(r.mime).toBe('image/png');
    expect(r.declaredMime).toBe('image/png');
    expect(r.bytes.length).toBe(10);
  });

  it('recognises JSON text and rejects garbage', () => {
    expect(decodeBase64(btoa('{"a":1}')).mime).toBe('application/json');
    expect(() => decodeBase64('not base64!')).toThrow('Not valid base64');
  });

  it('encodes bytes', () => {
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe('aGk=');
  });
});

describe('sqlTools', () => {
  // eslint-disable-next-line global-require
  const {
    formatSql,
    minifySql,
    checkSql,
    normalizeSql,
  } = require('./sqlTools');

  it('formats clauses, lists and conditions; leaves strings alone', () => {
    expect(
      formatSql(
        "select a, count(b) as n from t left join u on u.id = t.id and u.x = 'and from' where a > 1 group by a",
      ),
    ).toBe(
      [
        'SELECT',
        '  a,',
        '  COUNT(b) AS n',
        'FROM t',
        'LEFT JOIN u',
        '  ON u.id = t.id',
        "  AND u.x = 'and from'",
        'WHERE a > 1',
        'GROUP BY',
        '  a',
      ].join('\n'),
    );
  });

  it('keeps IN ( spaced, nests subqueries, escapes quotes', () => {
    const out = formatSql(
      "delete from t where id in (select id from x where n = 'it''s')",
    );
    expect(out).toContain('DELETE FROM t');
    expect(out).toContain('WHERE id IN (');
    expect(out).toContain("WHERE n = 'it''s')");
  });

  it('minifies to one line', () => {
    expect(
      minifySql('SELECT\n  a,\n  b -- note\nFROM t\nWHERE ( x = 1 )'),
    ).toBe('SELECT a, b FROM t WHERE (x = 1)');
  });

  it('normalises so formatting and keyword case do not count as differences', () => {
    expect(normalizeSql('select a from t')).toBe(
      normalizeSql('SELECT\n   a\nFROM   t'),
    );
  });

  it('finds unbalanced brackets and quotes', () => {
    expect(checkSql('select (a from t')).toEqual({
      ok: false,
      error: 'Missing )',
      line: 1,
    });
    expect(checkSql("select 1\nwhere a = 'x")).toMatchObject({
      ok: false,
      line: 2,
    });
    expect(checkSql('select a) from t')).toMatchObject({
      ok: false,
      error: 'Unexpected )',
    });
    expect(checkSql("select '[x]' from [my table]")).toEqual({ ok: true });
  });
});

describe('repairJson', () => {
  // eslint-disable-next-line global-require
  const { repairJson } = require('./jsonTools');
  const fix = (s: string) => {
    const r = repairJson(s);
    expect(r.ok).toBe(true);
    return JSON.parse(r.text);
  };

  it('fixes JS object literals', () => {
    expect(
      fix("{name: 'Ann', tags: ['a', 'b',], // note\n active: true,}"),
    ).toEqual({ name: 'Ann', tags: ['a', 'b'], active: true });
  });

  it('fixes Python dicts', () => {
    expect(fix("{'a': True, 'b': None, 'c': False}")).toEqual({
      a: true,
      b: null,
      c: false,
    });
  });

  it('adds missing commas and closes brackets', () => {
    expect(fix('{"a": 1\n "b": [1 2 3]\n "c": {"d": "x"')).toEqual({
      a: 1,
      b: [1, 2, 3],
      c: { d: 'x' },
    });
  });

  it('removes text around, wraps several values, escapes newlines', () => {
    expect(fix('response = {"a": 1};')).toEqual({ a: 1 });
    expect(fix('{"a":1}\n{"a":2}')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(fix('{"text": "line1\nline2"}')).toEqual({ text: 'line1\nline2' });
    expect(fix('{"q": "say \\"hi\\""}')).toEqual({ q: 'say "hi"' });
  });

  it('reports what it changed', () => {
    expect(repairJson("{a: 'x',}").fixes).toEqual(
      expect.arrayContaining([
        'Converted single quotes to double quotes',
        'Quoted unquoted keys',
        'Removed trailing commas',
      ]),
    );
    expect(repairJson('{"ok": 1}').fixes).toEqual([]);
  });
});

describe('repairSql / repairMarkdown', () => {
  // eslint-disable-next-line global-require
  const { repairSql, checkSql } = require('./sqlTools');
  // eslint-disable-next-line global-require
  const { repairMarkdown } = require('./markdownTools');

  it('balances brackets, closes strings, drops dangling commas', () => {
    const r = repairSql("select a, b, from t where id in (1, 2 and name = 'x");
    expect(r.ok).toBe(true);
    expect(checkSql(r.text).ok).toBe(true);
    expect(r.text).toContain('FROM t');
    expect(r.text).not.toMatch(/,\s*FROM/);
    expect(r.fixes).toEqual(
      expect.arrayContaining([
        'Closed an unterminated string',
        'Added 1 missing )',
        'Removed dangling commas',
      ]),
    );
    expect(repairSql('select a) from t').fixes).toContain(
      'Removed an unmatched )',
    );
  });

  it('tidies markdown but leaves code blocks alone', () => {
    const r = repairMarkdown(
      '#Title\n* one\n+ two\n[] todo\n- [X] done   \n\n\n\n```js\n#not a heading\n* not a list',
    );
    expect(r.text).toBe(
      [
        '# Title',
        '- one',
        '- two',
        '- [ ] todo',
        '- [x] done',
        '',
        '```js',
        '#not a heading',
        '* not a list',
        '```',
      ].join('\n'),
    );
    expect(r.fixes).toEqual(
      expect.arrayContaining([
        'Added spaces after # in headings',
        'Unified list bullets',
        'Fixed checklist items',
        'Collapsed blank lines',
        'Closed an unclosed code block',
      ]),
    );
    // hashtags and bold text are not headings / bullets
    expect(repairMarkdown('#tag\n**bold** text').text).toBe(
      '#tag\n**bold** text',
    );
  });
});
