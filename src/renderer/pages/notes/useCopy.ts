import { useCallback, useState } from 'react';

/** Copies text to the clipboard; `copied` holds the last copied key for ~1.5 s (for "Copied!" feedback). */
export default function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(async (text: string, key = 'default') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch (e) {
      console.error('Copy failed', e);
    }
  }, []);
  return { copy, copied };
}
