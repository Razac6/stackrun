// Search across Stackrun (Ctrl+K / ⌘K): notes, command packages and their commands, HTTP
// requests, and the tools themselves. Pure, so it is tested without the window.
import type { CommandsState } from '../pages/notes/commandsModel';
import type { HttpState } from '../pages/http/httpModel';

export type ResultKind = 'tool' | 'note' | 'package' | 'command' | 'request';

export interface SearchResult {
  kind: ResultKind;
  id: string; // what to open: note id, package id, request id, tool page
  title: string;
  detail: string; // a second line: where it is / what it does
  score: number;
}

export interface SearchSources {
  tools: { page: string; text: string }[];
  notes: {
    id?: number;
    title: string;
    content: string;
    notebook?: string;
    tags?: string[];
  }[];
  commands: CommandsState | null;
  http: HttpState | null;
}

/** 0 = no match; higher = better (whole words, at the start, in the title). */
export const matchScore = (query: string, title: string, rest = ''): number => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const t = title.toLowerCase();
  const r = rest.toLowerCase();
  let score = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const w of words) {
    if (t.startsWith(w)) score += 12;
    else if (
      new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)
    )
      score += 8;
    else if (t.includes(w)) score += 5;
    else if (r.includes(w)) score += 2;
    else return 0; // every word has to be somewhere
  }
  return score;
};

const snippetAround = (text: string, query: string, size = 70) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  const first = query.toLowerCase().split(/\s+/).filter(Boolean)[0] || '';
  const at = first ? flat.toLowerCase().indexOf(first) : -1;
  if (at < 0) return flat.slice(0, size);
  const start = Math.max(0, at - 20);
  return `${start ? '…' : ''}${flat.slice(start, start + size)}`;
};

export const searchAll = (
  query: string,
  src: SearchSources,
  limit = 40,
): SearchResult[] => {
  const q = query.trim();
  const out: SearchResult[] = [];
  const push = (r: Omit<SearchResult, 'score'>, score: number) => {
    if (score > 0) out.push({ ...r, score });
  };

  src.tools.forEach((t) => {
    const score = q ? matchScore(q, t.text) : 1;
    // a matching tool goes a bit above content with the same words
    push(
      { kind: 'tool', id: t.page, title: t.text, detail: 'Open' },
      score && q ? score + 3 : score,
    );
  });
  if (!q) return out.slice(0, limit);

  src.notes.forEach((n) => {
    if (n.id === undefined) return;
    const title = n.title || 'Untitled';
    const extra = `${n.content} ${n.notebook || ''} ${(n.tags || []).map((t) => `#${t}`).join(' ')}`;
    push(
      {
        kind: 'note',
        id: String(n.id),
        title,
        detail: [n.notebook, snippetAround(n.content, q)]
          .filter(Boolean)
          .join(' · '),
      },
      matchScore(q, title, extra),
    );
  });

  const groups = src.commands?.groups || [];
  const nameOf = (id?: string) => groups.find((g) => g.id === id)?.name || '';
  groups.forEach((g) => {
    push(
      {
        kind: 'package',
        id: g.id,
        title: g.name,
        detail: `Package · ${g.commands.length} step${g.commands.length === 1 ? '' : 's'}`,
      },
      matchScore(q, g.name, g.commands.map((c) => c.name).join(' ')),
    );
    g.commands.forEach((c) => {
      const title = c.packageId ? `${nameOf(c.packageId)} (package)` : c.name;
      push(
        {
          kind: 'command',
          id: g.id,
          title,
          detail:
            `${g.name} · ${c.packageId ? 'runs a package' : c.command}`.slice(
              0,
              120,
            ),
        },
        matchScore(q, title, `${c.command} ${c.cwd}`),
      );
    });
  });

  (src.http?.collections || []).forEach((col) =>
    col.requests.forEach((r) =>
      push(
        {
          kind: 'request',
          id: r.id,
          title: r.name,
          detail: `${r.method} ${r.url} · ${col.name}`,
        },
        matchScore(
          q,
          r.name,
          `${r.method} ${r.url} ${col.name} ${r.body.text}`,
        ),
      ),
    ),
  );

  return out.sort((a, b) => b.score - a.score).slice(0, limit);
};
