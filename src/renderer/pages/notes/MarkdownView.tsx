import React, { useMemo } from 'react';
import { Box } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { codeColors, highlightCode, MONO_FONT } from './highlight';

// Rendered markdown (GFM: tables, task lists, fenced code with syntax highlighting).
// Output is sanitised with DOMPurify, and links open in the system browser instead of
// navigating the app window.

const marked = new Marked({ gfm: true, breaks: true });
marked.use({
  renderer: {
    code({ text, lang }) {
      const language = (lang || '').trim().split(/\s+/)[0].toLowerCase();
      return `<pre><code class="hljs${language ? ` language-${language}` : ''}">${highlightCode(text, language || undefined)}</code></pre>\n`;
    },
  },
});

export const renderMarkdown = (source: string) =>
  DOMPurify.sanitize(marked.parse(source, { async: false }) as string);

export default function MarkdownView({ source }: { source: string }) {
  const theme = useTheme();
  const html = useMemo(() => renderMarkdown(source), [source]);

  const onClick = (e: React.MouseEvent) => {
    const link = (e.target as HTMLElement).closest('a');
    if (!link) return;
    e.preventDefault();
    const href = link.getAttribute('href') || '';
    if (/^(https?:|mailto:)/i.test(href)) {
      window.electron?.shell?.openExternal(href);
    }
  };

  return (
    <Box
      onClick={onClick}
      sx={{
        fontSize: '0.9375rem',
        lineHeight: 1.65,
        color: 'text.primary',
        wordBreak: 'break-word',
        '& > :first-of-type': { mt: 0 },
        '& h1, & h2, & h3, & h4': {
          fontWeight: 600,
          lineHeight: 1.3,
          mt: 2.5,
          mb: 1,
        },
        '& h1': { fontSize: '1.6rem' },
        '& h2': { fontSize: '1.3rem' },
        '& h3': { fontSize: '1.1rem' },
        '& p': { my: 1 },
        '& a': { color: 'primary.main', cursor: 'pointer' },
        '& ul, & ol': { pl: 3, my: 1 },
        '& li > input[type=checkbox]': { mr: 1, verticalAlign: 'middle' },
        '& li:has(> input[type=checkbox])': { listStyle: 'none', ml: -2.5 },
        '& blockquote': {
          m: 0,
          my: 1.5,
          pl: 2,
          borderLeft: 3,
          borderColor: 'divider',
          color: 'text.secondary',
        },
        '& code': {
          fontFamily: MONO_FONT,
          fontSize: '0.85em',
          px: 0.5,
          py: 0.25,
          borderRadius: 1,
          bgcolor: alpha(theme.palette.text.primary, 0.06),
        },
        '& pre': {
          my: 1.5,
          p: 1.5,
          borderRadius: 2,
          overflow: 'auto',
          bgcolor: alpha(theme.palette.text.primary, 0.04),
          border: 1,
          borderColor: 'divider',
        },
        '& pre code': {
          p: 0,
          bgcolor: 'transparent',
          fontSize: '0.8125rem',
          lineHeight: 1.55,
          ...codeColors(theme),
        },
        '& table': { borderCollapse: 'collapse', my: 1.5 },
        '& th, & td': {
          border: 1,
          borderColor: 'divider',
          px: 1.25,
          py: 0.5,
          textAlign: 'left',
        },
        '& th': { bgcolor: alpha(theme.palette.text.primary, 0.04) },
        '& hr': { border: 0, borderTop: 1, borderColor: 'divider', my: 2 },
        '& img': { maxWidth: '100%', borderRadius: 2 },
      }}
      // Sanitised by DOMPurify above
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
