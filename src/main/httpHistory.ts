// HTTP Client history: the last requests sent, with what came back. Kept in its own file
// in userData (not in the settings: responses can be big), newest first.
import fs from 'fs';
import path from 'path';
import type { IpcMain } from 'electron';
import type { HttpResult } from './httpClient';

export const MAX_HISTORY = 100;
export const MAX_KEPT_BODY = 64 * 1024; // a bigger response body is cut in the history

export interface HistoryEntry {
  id: string;
  at: number;
  requestId: string | null; // the saved request it came from (to open it again)
  name: string;
  collection: string;
  sent: {
    method: string;
    url: string;
    headers: [string, string][];
    body: string;
  };
  result: HttpResult;
  traceId?: string | null; // sent with "Trace" on
}

let file = '';
let cache: HistoryEntry[] | null = null;

const read = (): HistoryEntry[] => {
  if (cache) return cache;
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf-8'));
    cache = Array.isArray(list) ? list : [];
  } catch (e) {
    cache = [];
  }
  return cache;
};

// written a moment later, off the main thread's way: a burst of requests (Run all) is
// one write, and sending never waits for the disk
let pendingWrite: ReturnType<typeof setTimeout> | null = null;
export const flushHistory = () => {
  if (pendingWrite) clearTimeout(pendingWrite);
  pendingWrite = null;
  if (!file || !cache) return;
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache), 'utf-8');
  fs.renameSync(tmp, file);
};

const write = (list: HistoryEntry[]) => {
  cache = list;
  if (!file || pendingWrite) return;
  pendingWrite = setTimeout(flushHistory, 1500);
};

const cut = (text: string) =>
  text.length > MAX_KEPT_BODY ? text.slice(0, MAX_KEPT_BODY) : text;

/** Adds an entry (newest first), keeps the last MAX_HISTORY. */
export const addHistory = (entry: HistoryEntry) => {
  const body = entry.result?.body || '';
  const kept: HistoryEntry = {
    ...entry,
    sent: { ...entry.sent, body: cut(entry.sent.body || '') },
    result: {
      ...entry.result,
      body: cut(body),
      truncated: entry.result.truncated || body.length > MAX_KEPT_BODY,
    },
  };
  write(
    [kept, ...read().filter((e) => e.id !== kept.id)].slice(0, MAX_HISTORY),
  );
  return true;
};

export const listHistory = () => read();

export const deleteHistory = (id: string) => {
  write(read().filter((e) => e.id !== id));
  return true;
};

export const clearHistory = () => {
  write([]);
  return true;
};

export const registerHttpHistoryIpc = (ipcMain: IpcMain, dir: string) => {
  file = path.join(dir, 'http-history.json');
  cache = null;
  ipcMain.handle('http:history', () => listHistory());
  ipcMain.handle('http:history-add', (e, entry: HistoryEntry) =>
    entry && entry.id && entry.result ? addHistory(entry) : false,
  );
  ipcMain.handle('http:history-delete', (e, id: string) =>
    deleteHistory(String(id)),
  );
  ipcMain.handle('http:history-clear', () => clearHistory());
};
