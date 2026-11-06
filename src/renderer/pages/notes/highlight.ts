import hljs from 'highlight.js/lib/common';
import http from 'highlight.js/lib/languages/http';
import { alpha, Theme } from '@mui/material/styles';

// One highlight.js instance for notes: the common languages plus the HTTP request format
hljs.registerLanguage('http', http);

export type CodeLanguage =
  | 'json'
  | 'markdown'
  | 'http'
  | 'sql'
  | 'javascript'
  | 'plain';

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Highlighted HTML (already escaped) for a block of code in a known or guessed language. */
export const highlightCode = (code: string, language?: string) => {
  if (language === 'plain' || language === 'text') return escapeHtml(code);
  // JetBrains .http files: "###" separators aren't part of highlight.js' http grammar
  if (language === 'http') {
    return code
      .split(/(^###.*$)/m)
      .map((part) =>
        part.startsWith('###')
          ? `<span class="hljs-comment">${escapeHtml(part)}</span>`
          : hljs.highlight(part, { language: 'http', ignoreIllegals: true })
              .value,
      )
      .join('');
  }
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  }
  if (!code.trim()) return escapeHtml(code);
  return hljs.highlightAuto(code).value;
};

/** Theme-aware colours for highlight.js classes (works in light and dark palettes). */
export const codeColors = (theme: Theme) => {
  const dark = theme.palette.mode === 'dark';
  const c = {
    key: dark ? '#9cdcfe' : '#0b5cad',
    string: dark ? '#ce9178' : '#a31515',
    number: dark ? '#b5cea8' : '#098658',
    keyword: dark ? '#c586c0' : '#7a1fa2',
    title: dark ? '#dcdcaa' : '#795e26',
    comment: dark ? '#6a9955' : '#6a737d',
  };
  return {
    '& .hljs-attr, & .hljs-attribute, & .hljs-property, & .hljs-variable': {
      color: c.key,
    },
    '& .hljs-string, & .hljs-regexp, & .hljs-template-string': {
      color: c.string,
    },
    '& .hljs-number, & .hljs-literal, & .hljs-symbol, & .hljs-bullet': {
      color: c.number,
    },
    '& .hljs-keyword, & .hljs-built_in, & .hljs-type, & .hljs-selector-tag': {
      color: c.keyword,
    },
    '& .hljs-title, & .hljs-section, & .hljs-name, & .hljs-function': {
      color: c.title,
      fontWeight: 600,
    },
    '& .hljs-comment, & .hljs-quote, & .hljs-meta': {
      color: c.comment,
      fontStyle: 'italic',
    },
    '& .hljs-punctuation': { color: alpha(theme.palette.text.primary, 0.6) },
    '& .hljs-strong': { fontWeight: 700 },
    '& .hljs-emphasis': { fontStyle: 'italic' },
    '& .hljs-link': { color: c.key, textDecoration: 'underline' },
    '& .hljs-addition': { color: theme.palette.success.main },
    '& .hljs-deletion': { color: theme.palette.error.main },
  };
};

export const MONO_FONT =
  '"JetBrains Mono", "Cascadia Code", Consolas, "SF Mono", Menlo, monospace';
