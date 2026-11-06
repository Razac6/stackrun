import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  addHistory,
  clearHistory,
  flushHistory,
  HistoryEntry,
  listHistory,
  MAX_HISTORY,
  MAX_KEPT_BODY,
  registerHttpHistoryIpc,
} from './httpHistory';
import {
  maskSecrets,
  searchHistory,
} from '../renderer/pages/http/httpHistoryModel';

const entry = (i: number, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: `h${i}`,
  at: i,
  requestId: `r${i}`,
  name: `Request ${i}`,
  collection: 'Shop',
  sent: { method: 'GET', url: `http://x/items/${i}`, headers: [], body: '' },
  result: {
    id: `r${i}`,
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: [['content-type', 'application/json']],
    body: `{"id":${i}}`,
    binary: false,
    size: 8,
    timeMs: 3,
    url: `http://x/items/${i}`,
    redirects: [],
    truncated: false,
    error: null,
  },
  ...over,
});

describe('HTTP history', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackrun-hist-'));
  beforeAll(() => registerHttpHistoryIpc({ handle: () => {} } as any, dir));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('keeps the newest 100, in a file of its own', () => {
    clearHistory();
    for (let i = 0; i < MAX_HISTORY + 5; i += 1) addHistory(entry(i));
    const list = listHistory();
    expect(list).toHaveLength(MAX_HISTORY);
    expect(list[0].id).toBe(`h${MAX_HISTORY + 4}`);
    flushHistory();
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, 'http-history.json'), 'utf-8')),
    ).toHaveLength(MAX_HISTORY);
  });

  it('cuts a huge body', () => {
    const big = entry(1, {});
    big.result = { ...big.result, body: 'x'.repeat(400 * 1024) };
    addHistory(big);
    expect(listHistory()[0].result.body.length).toBe(MAX_KEPT_BODY);
    expect(listHistory()[0].result.truncated).toBe(true);
  });

  it('finds by URL, status and body; hides secrets', () => {
    const list = [
      entry(1),
      entry(2, {
        result: { ...entry(2).result, status: 404, body: 'not here' },
      }),
    ];
    expect(searchHistory(list, 'items/2 404').map((e) => e.id)).toEqual(['h2']);
    expect(searchHistory(list, '"id":1').map((e) => e.id)).toEqual(['h1']);
    expect(searchHistory(list, '')).toHaveLength(2);
    expect(maskSecrets([['Authorization', 'Bearer abcdefghijklmnop']])).toEqual(
      [['Authorization', 'Bearer abcde…']],
    );
  });
});
