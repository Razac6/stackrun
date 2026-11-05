// Stackrun's own data: notes (with version history) and settings, in one JSON file under
// userData. Small enough to rewrite whole on every change; written to a temp file and
// renamed, so a crash mid-write never leaves half a file behind.
import fs from 'fs';
import path from 'path';

export type NoteFormat = 'markdown' | 'json' | 'sql';

export interface StoredNote {
  id: number;
  title: string;
  content: string;
  notebook: string;
  tags: string[];
  pinned: boolean;
  format: NoteFormat;
  createdAt: string;
  updatedAt: string;
}

export interface NoteVersion {
  id: number;
  noteId: number;
  title: string;
  content: string;
  format: NoteFormat;
  savedAt: string;
}

interface Data {
  nextId: number;
  notes: StoredNote[];
  versions: NoteVersion[];
  settings: Record<string, string>;
}

// Autosave fires every few seconds while typing, so edits within this window of the last
// snapshot are folded into it; `forceVersion` (used by restore) always snapshots.
export const VERSION_COALESCE_MS = 5 * 60 * 1000;
export const MAX_VERSIONS_PER_NOTE = 50;

const noteFormat = (value: unknown): NoteFormat =>
  value === 'json' || value === 'sql' ? value : 'markdown';

const noteTags = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (e) {
    return [];
  }
};

const empty = (): Data => ({
  nextId: 1,
  notes: [],
  versions: [],
  settings: {},
});

export class Store {
  private file: string | null;

  private data: Data;

  private now: () => number;

  /** `file` null keeps everything in memory (tests). */
  constructor(file: string | null, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    this.data = this.load();
  }

  private load(): Data {
    if (!this.file || !fs.existsSync(this.file)) return empty();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      return {
        nextId: Number(raw.nextId) || 1,
        notes: Array.isArray(raw.notes) ? raw.notes : [],
        versions: Array.isArray(raw.versions) ? raw.versions : [],
        settings:
          raw.settings && typeof raw.settings === 'object' ? raw.settings : {},
      };
    } catch (e) {
      // keep the unreadable file for a look later, start fresh
      fs.renameSync(this.file, `${this.file}.broken-${this.now()}`);
      return empty();
    }
  }

  private save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf-8');
    fs.renameSync(tmp, this.file);
  }

  private iso() {
    return new Date(this.now()).toISOString();
  }

  private id() {
    const id = this.data.nextId;
    this.data.nextId += 1;
    return id;
  }

  getNotes(): StoredNote[] {
    return this.data.notes.map((n) => ({ ...n, tags: [...n.tags] }));
  }

  createNote(note: any): StoredNote {
    const createdAt = note?.createdAt || this.iso();
    const created: StoredNote = {
      id: this.id(),
      title: String(note?.title ?? ''),
      content: String(note?.content ?? ''),
      notebook: String(note?.notebook || ''),
      tags: noteTags(note?.tags),
      pinned: !!note?.pinned,
      format: noteFormat(note?.format),
      createdAt,
      updatedAt: note?.updatedAt || createdAt,
    };
    this.data.notes.push(created);
    this.save();
    return { ...created };
  }

  private snapshot(note: StoredNote, force: boolean) {
    const mine = this.data.versions.filter((v) => v.noteId === note.id);
    const last = mine[mine.length - 1];
    if (
      !force &&
      last &&
      this.now() - new Date(last.savedAt).getTime() < VERSION_COALESCE_MS
    )
      return;
    this.data.versions.push({
      id: this.id(),
      noteId: note.id,
      title: note.title,
      content: note.content,
      format: note.format,
      savedAt: this.iso(),
    });
    const extra = mine.length + 1 - MAX_VERSIONS_PER_NOTE;
    if (extra > 0) {
      const drop = new Set(mine.slice(0, extra).map((v) => v.id));
      this.data.versions = this.data.versions.filter((v) => !drop.has(v.id));
    }
  }

  updateNote(note: any, options: { forceVersion?: boolean } = {}) {
    const current = this.data.notes.find((n) => n.id === Number(note?.id));
    if (!current) return null;
    const next = {
      title: String(note.title ?? ''),
      content: String(note.content ?? ''),
      format: noteFormat(note.format),
    };
    if (
      current.title !== next.title ||
      current.content !== next.content ||
      current.format !== next.format
    )
      this.snapshot(current, !!options.forceVersion);
    Object.assign(current, next, {
      notebook: String(note.notebook || ''),
      tags: noteTags(note.tags),
      pinned: !!note.pinned,
      updatedAt: this.iso(),
    });
    this.save();
    return { ...current, tags: [...current.tags] };
  }

  /** Newest first. */
  getNoteVersions(noteId: number): NoteVersion[] {
    return this.data.versions
      .filter((v) => v.noteId === Number(noteId))
      .reverse()
      .map((v) => ({ ...v }));
  }

  deleteNote(noteId: number) {
    const id = Number(noteId);
    this.data.notes = this.data.notes.filter((n) => n.id !== id);
    this.data.versions = this.data.versions.filter((v) => v.noteId !== id);
    this.save();
    return id;
  }

  getAllSettings(): Record<string, string> {
    return { ...this.data.settings };
  }

  setSetting(key: string, value: string) {
    this.data.settings[String(key)] = String(value);
    this.save();
  }
}
