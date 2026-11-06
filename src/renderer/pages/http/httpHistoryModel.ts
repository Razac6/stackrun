// HTTP Client history (renderer, pure): finding entries by what was sent and what came back.
import type { HistoryEntry } from '../../../main/httpHistory';

/** Entries that have every word somewhere: name, method, URL, status, headers, bodies. */
export const searchHistory = (list: HistoryEntry[], query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((e) => {
    const text = [
      e.name,
      e.collection,
      e.sent.method,
      e.sent.url,
      e.result.error ? 'error' : String(e.result.status),
      e.result.statusText,
      e.result.error || '',
      e.sent.body,
      e.result.body,
      ...e.result.headers.map(([k, v]) => `${k}: ${v}`),
    ]
      .join('\n')
      .toLowerCase();
    return words.every((w) => text.includes(w));
  });
};

/** Authorization / cookies are not kept in the history file as they were. */
export const maskSecrets = (headers: [string, string][]): [string, string][] =>
  headers.map(([k, v]) =>
    /^(authorization|proxy-authorization|cookie|x-api-key)$/i.test(k)
      ? [k, `${v.slice(0, 12)}…`]
      : [k, v],
  );
