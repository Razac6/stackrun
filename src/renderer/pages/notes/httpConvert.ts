// Converts a request copied from the browser's DevTools ("Copy as cURL (bash)",
// "Copy as cURL (cmd)" or "Copy as fetch") into the JetBrains HTTP Client format
// (.http files in WebStorm / IntelliJ):
//
//   ### Name
//   POST https://example.com/api
//   Content-Type: application/json
//
//   { "body": true }

export interface ParsedRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
}

// Headers the browser adds on its own - noise in a hand-run request
const BROWSER_NOISE = [
  /^sec-ch-/i,
  /^sec-fetch-/i,
  /^sec-gpc$/i,
  /^user-agent$/i,
  /^accept-language$/i,
  /^accept-encoding$/i,
  /^priority$/i,
  /^dnt$/i,
  /^connection$/i,
  /^upgrade-insecure-requests$/i,
  /^pragma$/i,
  /^cache-control$/i,
  /^referer$/i,
  /^origin$/i,
  /^te$/i,
];
export const isNoiseHeader = (name: string) =>
  BROWSER_NOISE.some((re) => re.test(name));

/** Splits a shell command into words: bash quoting ('…', "…", $'…', \) and cmd (^ escapes). */
export const shellSplit = (input: string) => {
  // Line continuations: bash "\<newline>", cmd "^<newline>"
  const isCmd = /\^\r?\n|\^"/.test(input);
  let text = input.replace(/\\\r?\n/g, ' ');
  // cmd: the shell strips "^" escapes first (^" ^{ ...), then the program sees C-runtime
  // quoting - "..." groups, \" is a literal quote
  if (isCmd) text = text.replace(/\^\r?\n/g, ' ').replace(/\^(.)/g, '$1');

  const words: string[] = [];
  let current = '';
  let inWord = false;
  let i = 0;
  const push = () => {
    if (inWord) words.push(current);
    current = '';
    inWord = false;
  };
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      push();
      i += 1;
    } else if (!isCmd && c === '$' && text[i + 1] === "'") {
      // ANSI-C quoting: $'…' with backslash escapes
      i += 2;
      inWord = true;
      while (i < text.length && text[i] !== "'") {
        if (text[i] === '\\' && i + 1 < text.length) {
          const next = text[i + 1];
          const map: Record<string, string> = {
            n: '\n',
            t: '\t',
            r: '\r',
            "'": "'",
            '\\': '\\',
            '"': '"',
          };
          if (
            next === 'u' &&
            /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))
          ) {
            current += String.fromCharCode(
              parseInt(text.slice(i + 2, i + 6), 16),
            );
            i += 6;
          } else if (
            next === 'x' &&
            /^[0-9a-fA-F]{2}$/.test(text.slice(i + 2, i + 4))
          ) {
            current += String.fromCharCode(
              parseInt(text.slice(i + 2, i + 4), 16),
            );
            i += 4;
          } else {
            current += map[next] ?? next;
            i += 2;
          }
        } else {
          current += text[i];
          i += 1;
        }
      }
      i += 1;
    } else if (c === "'" && !isCmd) {
      inWord = true;
      i += 1;
      while (i < text.length && text[i] !== "'") {
        current += text[i];
        i += 1;
      }
      i += 1;
    } else if (c === '"') {
      inWord = true;
      i += 1;
      while (i < text.length && text[i] !== '"') {
        if (!isCmd && text[i] === '\\' && /["\\$`]/.test(text[i + 1])) {
          current += text[i + 1];
          i += 2;
        } else if (isCmd && text[i] === '\\' && text[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          current += text[i];
          i += 1;
        }
      }
      i += 1;
    } else if (c === '\\' && !isCmd) {
      current += text[i + 1] ?? '';
      inWord = true;
      i += 2;
    } else {
      current += c;
      inWord = true;
      i += 1;
    }
  }
  push();
  return words;
};

const DATA_FLAGS = new Set([
  '-d',
  '--data',
  '--data-raw',
  '--data-binary',
  '--data-ascii',
  '--data-urlencode',
  '--json',
]);
// Flags with an argument that don't affect the request itself
const SKIP_WITH_ARG = new Set([
  '-o',
  '--output',
  '-A',
  '--user-agent',
  '--connect-timeout',
  '-m',
  '--max-time',
  '-x',
  '--proxy',
  '-e',
  '--referer',
  '-w',
  '--write-out',
]);

export const parseCurl = (command: string): ParsedRequest => {
  const words = shellSplit(command.trim());
  if (!/^curl(\.exe)?$/i.test(words[0] || '')) {
    throw new Error('Not a curl command');
  }
  let method = '';
  let url = '';
  const headers: [string, string][] = [];
  const data: string[] = [];
  let isJsonFlag = false;
  let forceGet = false;

  for (let i = 1; i < words.length; i += 1) {
    const w = words[i];
    const arg = () => {
      i += 1;
      return words[i] ?? '';
    };
    if (w === '-X' || w === '--request') method = arg().toUpperCase();
    else if (w === '-H' || w === '--header') {
      const h = arg();
      const idx = h.indexOf(':');
      if (idx > 0)
        headers.push([h.slice(0, idx).trim(), h.slice(idx + 1).trim()]);
    } else if (w === '-b' || w === '--cookie') headers.push(['Cookie', arg()]);
    else if (w === '-u' || w === '--user') {
      headers.push(['Authorization', `Basic ${btoa(arg())}`]);
    } else if (DATA_FLAGS.has(w)) {
      if (w === '--json') isJsonFlag = true;
      data.push(arg());
    } else if (w === '-G' || w === '--get') forceGet = true;
    else if (w === '--url') url = arg();
    else if (SKIP_WITH_ARG.has(w)) arg();
    else if (w.startsWith('-')) {
      // other boolean flags (--compressed, -L, -k, -s, -i...) - ignore
    } else if (!url) url = w;
  }
  if (!url) throw new Error('No URL found in the curl command');

  let body: string | undefined = data.length ? data.join('&') : undefined;
  if (forceGet && body) {
    url += (url.includes('?') ? '&' : '?') + body;
    body = undefined;
  }
  if (isJsonFlag && !headers.some(([k]) => /^content-type$/i.test(k))) {
    headers.push(['Content-Type', 'application/json']);
  }
  return {
    method: method || (body !== undefined ? 'POST' : 'GET'),
    url,
    headers,
    body,
  };
};

/** `fetch("url", { method, headers: {...}, body: "..." })` as copied from DevTools. */
export const parseFetch = (snippet: string): ParsedRequest => {
  const m = snippet.match(
    /fetch\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`)\s*(?:,\s*([\s\S]*?))?\)\s*;?\s*$/,
  );
  if (!m) throw new Error('Not a fetch() call');
  const url = m[1].startsWith('"') ? JSON.parse(m[1]) : m[1].slice(1, -1);
  let options: any = {};
  if (m[2]) {
    // DevTools emits JSON-compatible options apart from `null` bodies and undefined
    try {
      options = JSON.parse(m[2]);
    } catch (e) {
      throw new Error(
        'Could not read the fetch options (expected the DevTools format)',
      );
    }
  }
  const headers: [string, string][] = Object.entries(
    (options.headers || {}) as Record<string, string>,
  ).map(([k, v]) => [k, String(v)]);
  if (options.referrer) headers.push(['Referer', options.referrer]);
  return {
    method: String(options.method || 'GET').toUpperCase(),
    url,
    headers,
    body: options.body == null ? undefined : String(options.body),
  };
};

export const parseRequest = (input: string): ParsedRequest => {
  const text = input.trim();
  if (/^curl(\.exe)?\s/i.test(text)) return parseCurl(text);
  if (/^(await\s+)?fetch\s*\(/.test(text))
    return parseFetch(text.replace(/^await\s+/, ''));
  throw new Error(
    'Paste a "Copy as cURL" or "Copy as fetch" request from DevTools',
  );
};

export interface HttpOptions {
  name?: string;
  dropNoise?: boolean;
  prettyBody?: boolean;
}

/** Renders a request in the JetBrains HTTP Client (.http) format. */
export const toHttpClient = (req: ParsedRequest, options: HttpOptions = {}) => {
  const { name, dropNoise = true, prettyBody = true } = options;
  const headers = dropNoise
    ? req.headers.filter(([k]) => !isNoiseHeader(k))
    : req.headers;
  const lines = [
    `### ${name || `${req.method} ${req.url.replace(/^https?:\/\//, '').split('?')[0]}`}`,
  ];
  lines.push(`${req.method} ${req.url}`);
  headers.forEach(([k, v]) => lines.push(`${k}: ${v}`));
  if (req.body !== undefined && req.body !== '') {
    let body = req.body;
    if (prettyBody) {
      try {
        body = JSON.stringify(JSON.parse(body), null, 2);
      } catch (e) {
        // not JSON - keep as is
      }
    }
    lines.push('', body);
  }
  return `${lines.join('\n')}\n`;
};
