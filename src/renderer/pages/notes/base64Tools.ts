// Base64 <-> file helpers: accept raw base64, URL-safe base64 or a data: URL, recognise the
// file type from its first bytes, and build data URLs for previews.

export interface DecodedBase64 {
  base64: string; // clean, standard alphabet, padded
  bytes: Uint8Array;
  mime: string;
  extension: string;
  declaredMime?: string; // from a data: URL prefix
}

const SIGNATURES: {
  mime: string;
  extension: string;
  test: (b: Uint8Array) => boolean;
}[] = [
  {
    mime: 'application/pdf',
    extension: 'pdf',
    test: (b) =>
      b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46, // %PDF
  },
  {
    mime: 'image/png',
    extension: 'png',
    test: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: 'image/jpeg',
    extension: 'jpg',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/gif',
    extension: 'gif',
    test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46,
  },
  {
    mime: 'image/webp',
    extension: 'webp',
    test: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
  {
    mime: 'image/bmp',
    extension: 'bmp',
    test: (b) => b[0] === 0x42 && b[1] === 0x4d,
  },
  {
    mime: 'image/x-icon',
    extension: 'ico',
    test: (b) => b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0,
  },
  {
    mime: 'application/zip',
    extension: 'zip',
    test: (b) =>
      b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
  },
];

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'application/zip': 'zip',
  'application/json': 'json',
  'text/plain': 'txt',
};

export const extensionFor = (mime: string) =>
  EXTENSIONS[mime] || mime.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';

const looksLikeText = (bytes: Uint8Array) => {
  const sample = bytes.subarray(0, 512);
  if (!sample.length) return false;
  let printable = 0;
  sample.forEach((c) => {
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c >= 128)
      printable += 1;
  });
  return printable / sample.length > 0.95;
};

export const detectMime = (bytes: Uint8Array) => {
  const hit = SIGNATURES.find((s) => s.test(bytes));
  if (hit) return hit.mime;
  if (looksLikeText(bytes)) {
    // Only the ASCII structure matters here, so a byte-to-char mapping is enough
    const head = String.fromCharCode(...bytes.subarray(0, 512)).trimStart();
    if (/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml';
    if (/^[[{]/.test(head)) return 'application/json';
    return 'text/plain';
  }
  return 'application/octet-stream';
};

/** Throws with a readable message when the input isn't base64. */
export const decodeBase64 = (input: string): DecodedBase64 => {
  let text = input.trim().replace(/^["']|["']$/g, '');
  let declaredMime: string | undefined;
  const dataUrl = text.match(/^data:([^;,]*)(;[^,]*)?,/i);
  if (dataUrl) {
    declaredMime = dataUrl[1] || undefined;
    text = text.slice(dataUrl[0].length);
  }
  // Whitespace / line breaks, URL-safe alphabet, missing padding
  text = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!text) throw new Error('Paste base64 or a data: URL');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
    throw new Error('Not valid base64 (unexpected characters)');
  }
  text = text.replace(/=+$/, '');
  if (text.length % 4 === 1) throw new Error('Not valid base64 (wrong length)');
  text += '='.repeat((4 - (text.length % 4)) % 4);

  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const detected = detectMime(bytes);
  const mime =
    detected === 'application/octet-stream' && declaredMime
      ? declaredMime
      : detected;
  return {
    base64: text,
    bytes,
    mime,
    extension: extensionFor(mime),
    declaredMime,
  };
};

export const toDataUrl = (base64: string, mime: string) =>
  `data:${mime};base64,${base64}`;

export const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

export const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};
