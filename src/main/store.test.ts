/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MAX_VERSIONS_PER_NOTE, Store, VERSION_COALESCE_MS } from './store';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stackrun-store-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('Store', () => {
  it('keeps notes and settings across restarts', () => {
    const file = path.join(tmp, 'a', 'data.json');
    const a = new Store(file);
    const note = a.createNote({ title: 'T', content: 'x', tags: ['db'] });
    a.setSetting('theme', 'luma');
    const b = new Store(file);
    expect(b.getNotes()).toEqual([
      expect.objectContaining({ id: note.id, title: 'T', tags: ['db'] }),
    ]);
    expect(b.getAllSettings()).toEqual({ theme: 'luma' });
  });

  it('cleans up what it is given', () => {
    const s = new Store(null);
    const n = s.createNote({ title: 'x', format: 'yaml', tags: '["a"]' });
    expect(n).toMatchObject({ format: 'markdown', tags: ['a'], pinned: false });
  });

  it('keeps versions, folding quick edits together', () => {
    let now = Date.parse('2026-01-01T10:00:00Z');
    const s = new Store(null, () => now);
    const n = s.createNote({ title: 'T', content: 'v1' });
    s.updateNote({ ...n, content: 'v2' });
    now += 1000;
    s.updateNote({ ...n, content: 'v3' }); // within the window: no new version
    expect(s.getNoteVersions(n.id).map((v) => v.content)).toEqual(['v1']);
    now += VERSION_COALESCE_MS;
    s.updateNote({ ...n, content: 'v4' });
    s.updateNote({ ...n, content: 'v5' }, { forceVersion: true });
    expect(s.getNoteVersions(n.id).map((v) => v.content)).toEqual([
      'v4',
      'v3',
      'v1',
    ]);
    // tags / pin only: no version
    s.updateNote({ ...n, content: 'v5', pinned: true });
    expect(s.getNoteVersions(n.id)).toHaveLength(3);
  });

  it('caps versions per note and drops them with the note', () => {
    const s = new Store(null);
    const n = s.createNote({ title: 'T', content: '0' });
    for (let i = 1; i <= MAX_VERSIONS_PER_NOTE + 5; i += 1)
      s.updateNote({ ...n, content: String(i) }, { forceVersion: true });
    const versions = s.getNoteVersions(n.id);
    expect(versions).toHaveLength(MAX_VERSIONS_PER_NOTE);
    expect(versions[0].content).toBe(String(MAX_VERSIONS_PER_NOTE + 4));
    s.deleteNote(n.id);
    expect(s.getNotes()).toEqual([]);
    expect(s.getNoteVersions(n.id)).toEqual([]);
  });

  it('starts fresh, keeping the file aside, when the file is broken', () => {
    const file = path.join(tmp, 'broken.json');
    fs.writeFileSync(file, '{nope');
    const s = new Store(file);
    expect(s.getNotes()).toEqual([]);
    expect(
      fs.readdirSync(tmp).some((f) => f.startsWith('broken.json.broken-')),
    ).toBe(true);
  });
});
