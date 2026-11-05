// Notes: data shape, filtering/sorting/paging, and .md / .json file (de)serialisation.
// Pure functions - the page and the tests share them.

export type NoteFormat = 'markdown' | 'json' | 'sql';

export const toNoteFormat = (value: unknown): NoteFormat =>
  value === 'json' || value === 'sql' ? value : 'markdown';

export interface Note {
  id?: number;
  title: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  userId?: number;
  notebook: string;
  tags: string[];
  pinned: boolean;
  format: NoteFormat;
}

export type NoteSort = 'updated' | 'created' | 'title';

export interface NoteFilter {
  query: string;
  notebook: string | null; // null = all, '' = notes without a notebook
  tag: string | null;
  pinnedOnly: boolean;
  format: NoteFormat | null;
}

export const emptyFilter: NoteFilter = {
  query: '',
  notebook: null,
  tag: null,
  pinnedOnly: false,
  format: null,
};

export const normalizeTag = (tag: string) =>
  tag.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase();

export const normalizeNote = (raw: any): Note => ({
  id: raw.id,
  title: raw.title || '',
  content: raw.content || '',
  createdAt: raw.createdAt || new Date().toISOString(),
  updatedAt: raw.updatedAt || raw.createdAt,
  userId: raw.userId,
  notebook: raw.notebook || '',
  tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
  pinned: !!raw.pinned,
  format: toNoteFormat(raw.format),
});

// Every search word must appear in the title, content, notebook or tags (any order)
export const matchesQuery = (note: Note, query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [
    note.title,
    note.content,
    note.notebook,
    note.tags.map((t) => `#${t}`).join(' '),
  ]
    .join('\n')
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
};

export const filterNotes = (notes: Note[], filter: NoteFilter) =>
  notes.filter(
    (n) =>
      (filter.notebook === null || n.notebook === filter.notebook) &&
      (filter.tag === null || n.tags.includes(filter.tag)) &&
      (!filter.pinnedOnly || n.pinned) &&
      (filter.format === null || n.format === filter.format) &&
      matchesQuery(n, filter.query),
  );

// Pinned first, then by the chosen order
export const sortNotes = (notes: Note[], sort: NoteSort) =>
  [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === 'title') return a.title.localeCompare(b.title);
    const key = sort === 'created' ? 'createdAt' : 'updatedAt';
    return String(b[key] || '').localeCompare(String(a[key] || ''));
  });

export const paginate = <T>(items: T[], page: number, pageSize: number) => {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  return {
    page: current,
    pageCount,
    items: items.slice((current - 1) * pageSize, current * pageSize),
  };
};

// name -> count, sorted by name
export const countBy = (values: string[]) => {
  const counts = new Map<string, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
};

// Plain-text preview for the list: markdown syntax stripped, JSON collapsed
export const snippet = (note: Note, length = 140) => {
  const text =
    note.format !== 'markdown'
      ? note.content.replace(/\s+/g, ' ')
      : note.content
          .replace(/```[\s\S]*?```/g, ' ')
          .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
          .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
          .replace(/[*_`~]/g, '')
          .replace(/\s+/g, ' ');
  const trimmed = text.trim();
  return trimmed.length > length ? `${trimmed.slice(0, length)}…` : trimmed;
};

// --- Files ---------------------------------------------------------------------------

const slug = (title: string) =>
  title
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'note';

const yamlString = (value: string) =>
  /^[\w .,@()-]*$/.test(value) ? value : JSON.stringify(value);

/** Markdown notes export with YAML front matter (title, notebook, tags...); JSON notes as .json */
export const noteToFile = (note: Note) => {
  if (note.format !== 'markdown') {
    return {
      fileName: `${slug(note.title)}.${note.format}`,
      content: note.content,
    };
  }
  const front = [
    '---',
    `title: ${yamlString(note.title)}`,
    note.notebook ? `notebook: ${yamlString(note.notebook)}` : null,
    note.tags.length ? `tags: [${note.tags.map(yamlString).join(', ')}]` : null,
    note.pinned ? 'pinned: true' : null,
    `created: ${note.createdAt}`,
    '---',
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');
  return { fileName: `${slug(note.title)}.md`, content: front + note.content };
};

const unquote = (value: string) => {
  const v = value.trim();
  if (v.startsWith('"')) {
    try {
      return JSON.parse(v);
    } catch (e) {
      return v.slice(1, -1);
    }
  }
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  return v;
};

const parseList = (value: string) => {
  const v = value.trim();
  const inner = v.startsWith('[') ? v.slice(1, -1) : v;
  return inner
    .split(',')
    .map((t) => normalizeTag(unquote(t)))
    .filter(Boolean);
};

/** Parses an imported file. Front matter is optional; a leading "# Heading" becomes the title. */
export const fileToNote = (fileName: string, text: string): Note => {
  const base = fileName.replace(/\.[^.]+$/, '');
  const now = new Date().toISOString();
  const note: Note = {
    title: base,
    content: text,
    createdAt: now,
    notebook: '',
    tags: [],
    pinned: false,
    format: toNoteFormat(fileName.match(/\.(json|sql)$/i)?.[1].toLowerCase()),
  };
  if (note.format !== 'markdown') return note;

  // Strip a byte-order mark
  const body = text.replace(/^\uFEFF/, '');
  const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (match) {
    note.content = body.slice(match[0].length);
    const lines = match[1].split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const kv = lines[i].match(/^(\w+):\s*(.*)$/);
      if (kv) {
        const [, key, value] = kv;
        if (key === 'title') note.title = unquote(value) || note.title;
        if (key === 'notebook') note.notebook = unquote(value);
        if (key === 'pinned') note.pinned = value.trim() === 'true';
        if (key === 'created' && !Number.isNaN(Date.parse(value.trim()))) {
          note.createdAt = value.trim();
        }
        if (key === 'tags') {
          if (value.trim()) note.tags = parseList(value);
          else {
            // Block list: "tags:\n  - a\n  - b"
            const tags: string[] = [];
            while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
              i += 1;
              tags.push(
                normalizeTag(unquote(lines[i].replace(/^\s*-\s+/, ''))),
              );
            }
            note.tags = tags.filter(Boolean);
          }
        }
      }
    }
  } else {
    const heading = body.match(/^#\s+(.+)\r?\n/);
    if (heading) {
      note.title = heading[1].trim();
      note.content = body.slice(heading[0].length).replace(/^\s*\n/, '');
    }
  }
  return note;
};
