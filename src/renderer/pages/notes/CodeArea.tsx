import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, IconButton, InputBase, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import CloseIcon from '@mui/icons-material/Close';
import FindReplaceIcon from '@mui/icons-material/FindReplace';
import {
  CodeLanguage,
  codeColors,
  highlightCode,
  MONO_FONT,
} from './highlight';

// A plain <textarea> with syntax highlighting: the highlighted copy of the text sits in a
// <pre> right behind it (same font, padding and scroll position) and the textarea's own
// text is transparent, so you see the colours but edit a normal, fast textarea - undo,
// selection, IME and spellcheck-off all work as usual. Tab inserts two spaces.
// Ctrl/Cmd+F opens find (and replace): every match is marked, Enter / Shift+Enter jump.

const PAD = 12;
const LINE_HEIGHT = 1.55;
const FONT_PX = 13;
const CHAR_PX = 7.8; // average monospace advance at 13px, for horizontal scroll-to-match

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const findMatches = (
  text: string,
  query: string,
  caseSensitive: boolean,
) => {
  if (!query) return [];
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: number[] = [];
  let i = hay.indexOf(needle);
  while (i !== -1 && out.length < 5000) {
    out.push(i);
    i = hay.indexOf(needle, i + Math.max(1, needle.length));
  }
  return out;
};

export default function CodeArea({
  value,
  onChange,
  language,
  placeholder,
  readOnly,
  errorLine,
  minHeight = 160,
  ariaLabel,
}: {
  value: string;
  onChange?: (value: string) => void;
  language: CodeLanguage;
  placeholder?: string;
  readOnly?: boolean;
  errorLine?: number;
  minHeight?: number | string;
  ariaLabel?: string;
}) {
  const theme = useTheme();
  const preRef = useRef<HTMLPreElement>(null);
  const marksRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const findRef = useRef<HTMLInputElement>(null);

  const [findOpen, setFindOpen] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [current, setCurrent] = useState(0);

  const html = useMemo(
    // A trailing newline needs a character after it or the last line has no height
    () => `${highlightCode(value, language)}\n `,
    [value, language],
  );
  const lineCount = value.split('\n').length;

  const matches = useMemo(
    () => (findOpen ? findMatches(value, query, caseSensitive) : []),
    [findOpen, value, query, caseSensitive],
  );
  const active = matches.length ? Math.min(current, matches.length - 1) : -1;

  // The match marks: same text, transparent, with <mark>s, under the highlighted layer
  const marksHtml = useMemo(() => {
    if (!matches.length) return '';
    let out = '';
    let last = 0;
    matches.forEach((start, i) => {
      out += escapeHtml(value.slice(last, start));
      const end = start + query.length;
      out += `<mark class="${i === active ? 'current' : ''}">${escapeHtml(value.slice(start, end))}</mark>`;
      last = end;
    });
    return `${out + escapeHtml(value.slice(last))}\n `;
  }, [matches, value, query, active]);

  const syncScroll = () => {
    const el = textareaRef.current;
    if (!el) return;
    [preRef.current, marksRef.current].forEach((pre) => {
      if (pre) {
        pre.scrollTop = el.scrollTop;
        pre.scrollLeft = el.scrollLeft;
      }
    });
    if (gutterRef.current) gutterRef.current.scrollTop = el.scrollTop;
  };

  // Bring the current match into view (and select it in the textarea)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || active < 0) return;
    const start = matches[active];
    const before = value.slice(0, start);
    const line = before.split('\n').length - 1;
    const column = start - (before.lastIndexOf('\n') + 1);
    const lineHeight = FONT_PX * LINE_HEIGHT;
    el.scrollTop = Math.max(0, line * lineHeight - el.clientHeight / 3);
    el.scrollLeft = Math.max(0, column * CHAR_PX - el.clientWidth / 2);
    el.setSelectionRange(start, start + query.length);
    syncScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, matches]);

  const openFind = () => {
    const el = textareaRef.current;
    const selected =
      el && el.selectionEnd > el.selectionStart
        ? value.slice(el.selectionStart, el.selectionEnd)
        : '';
    if (selected && !selected.includes('\n')) setQuery(selected);
    setFindOpen(true);
    requestAnimationFrame(() => findRef.current?.select());
  };

  const closeFind = () => {
    setFindOpen(false);
    textareaRef.current?.focus();
  };

  const step = (direction: 1 | -1) => {
    if (!matches.length) return;
    setCurrent(
      (c) =>
        (Math.min(c, matches.length - 1) + direction + matches.length) %
        matches.length,
    );
  };

  const replaceOne = () => {
    if (active < 0 || !onChange || readOnly) return;
    const start = matches[active];
    onChange(
      value.slice(0, start) + replacement + value.slice(start + query.length),
    );
  };

  const replaceAll = () => {
    if (!matches.length || !onChange || readOnly) return;
    let out = '';
    let last = 0;
    matches.forEach((start) => {
      out += value.slice(last, start) + replacement;
      last = start + query.length;
    });
    onChange(out + value.slice(last));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openFind();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      setShowReplace(true);
      openFind();
      return;
    }
    if (e.key === 'Escape' && findOpen) {
      setFindOpen(false);
      return;
    }
    if (e.key !== 'Tab' || readOnly || !onChange) return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: start, selectionEnd: end } = el;
    const next = `${value.slice(0, start)}  ${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      el.selectionStart = start + 2;
      el.selectionEnd = start + 2;
    });
  };

  const font = {
    fontFamily: MONO_FONT,
    fontSize: `${FONT_PX}px`,
    lineHeight: LINE_HEIGHT,
    tabSize: 2,
    letterSpacing: 0,
  };
  const layer = {
    ...font,
    position: 'absolute' as const,
    inset: 0,
    m: 0,
    p: `${PAD}px`,
    overflow: 'hidden',
    whiteSpace: 'pre' as const,
    pointerEvents: 'none' as const,
  };

  const findInput = (props: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    inputRef?: React.Ref<HTMLInputElement>;
    onEnter?: (shift: boolean) => void;
  }) => (
    <InputBase
      inputRef={props.inputRef}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => {
        props.onChange(e.target.value);
        setCurrent(0);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          props.onEnter?.(e.shiftKey);
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          closeFind();
        }
      }}
      inputProps={{ 'aria-label': props.placeholder, spellCheck: false }}
      sx={{
        fontSize: '0.8rem',
        px: 1,
        height: 26,
        width: 170,
        borderRadius: 1,
        bgcolor: 'background.default',
        border: 1,
        borderColor: 'divider',
      }}
    />
  );

  return (
    <Box
      sx={{
        position: 'relative',
        display: 'flex',
        height: '100%',
        minHeight,
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        bgcolor: alpha(theme.palette.text.primary, 0.025),
        overflow: 'hidden',
        '&:focus-within': { borderColor: 'text.secondary' },
      }}
    >
      {/* Line numbers */}
      <Box
        ref={gutterRef}
        aria-hidden
        sx={{
          ...font,
          flexShrink: 0,
          overflow: 'hidden',
          py: `${PAD}px`,
          px: 1,
          minWidth: 36,
          textAlign: 'right',
          color: 'text.disabled',
          borderRight: 1,
          borderColor: 'divider',
          userSelect: 'none',
        }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <Box
            key={i}
            sx={
              errorLine === i + 1
                ? { color: 'error.main', fontWeight: 700 }
                : undefined
            }
          >
            {i + 1}
          </Box>
        ))}
      </Box>

      <Box sx={{ position: 'relative', flex: 1, minWidth: 0 }}>
        {matches.length > 0 && (
          <Box
            component="pre"
            ref={marksRef}
            aria-hidden
            sx={{
              ...layer,
              color: 'transparent',
              '& mark': {
                color: 'transparent',
                bgcolor: alpha(theme.palette.warning.main, 0.28),
                borderRadius: '2px',
              },
              '& mark.current': {
                bgcolor: alpha(theme.palette.warning.main, 0.7),
                outline: `1px solid ${theme.palette.warning.dark}`,
              },
            }}
            // escaped above
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: marksHtml }}
          />
        )}
        <Box
          component="pre"
          ref={preRef}
          aria-hidden
          sx={{ ...layer, ...codeColors(theme), color: 'text.primary' }}
          // highlight.js output is HTML-escaped
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <Box
          component="textarea"
          ref={textareaRef}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          aria-label={ariaLabel}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          wrap="off"
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            onChange?.(e.target.value)
          }
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
          sx={{
            ...font,
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            m: 0,
            p: `${PAD}px`,
            border: 0,
            outline: 0,
            resize: 'none',
            whiteSpace: 'pre',
            overflow: 'auto',
            bgcolor: 'transparent',
            color: 'transparent',
            caretColor: theme.palette.text.primary,
            '&::placeholder': { color: 'text.disabled' },
            '&::selection': {
              bgcolor: alpha(theme.palette.primary.main, 0.25),
              color: 'transparent',
            },
          }}
        />

        {/* Find / replace bar */}
        {findOpen ? (
          <Box
            role="search"
            sx={{
              position: 'absolute',
              top: 6,
              right: 14,
              zIndex: 2,
              p: 0.75,
              borderRadius: 2,
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'divider',
              boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
              display: 'flex',
              flexDirection: 'column',
              gap: 0.5,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
              {!readOnly && onChange && (
                <Tooltip title="Replace">
                  <IconButton
                    size="small"
                    aria-label="Toggle replace"
                    onClick={() => setShowReplace((v) => !v)}
                    sx={{
                      p: 0.25,
                      color: showReplace ? 'primary.main' : 'text.secondary',
                    }}
                  >
                    <FindReplaceIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              )}
              {findInput({
                value: query,
                onChange: setQuery,
                placeholder: 'Find',
                inputRef: findRef,
                onEnter: (shift) => step(shift ? -1 : 1),
              })}
              <Tooltip title="Match case">
                <IconButton
                  size="small"
                  aria-label="Match case"
                  aria-pressed={caseSensitive}
                  onClick={() => setCaseSensitive((v) => !v)}
                  sx={{
                    p: 0.25,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    width: 24,
                    borderRadius: 1,
                    color: caseSensitive
                      ? 'primary.contrastText'
                      : 'text.secondary',
                    bgcolor: caseSensitive ? 'primary.main' : 'transparent',
                    '&:hover': {
                      bgcolor: caseSensitive ? 'primary.main' : 'action.hover',
                    },
                  }}
                >
                  Aa
                </IconButton>
              </Tooltip>
              <Typography
                variant="caption"
                color={
                  query && !matches.length ? 'error.main' : 'text.secondary'
                }
                sx={{
                  minWidth: 52,
                  textAlign: 'center',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {query
                  ? matches.length
                    ? `${active + 1}/${matches.length}`
                    : 'No results'
                  : ''}
              </Typography>
              <IconButton
                size="small"
                aria-label="Previous match"
                onClick={() => step(-1)}
                sx={{ p: 0.25 }}
              >
                <KeyboardArrowUpIcon sx={{ fontSize: 18 }} />
              </IconButton>
              <IconButton
                size="small"
                aria-label="Next match"
                onClick={() => step(1)}
                sx={{ p: 0.25 }}
              >
                <KeyboardArrowDownIcon sx={{ fontSize: 18 }} />
              </IconButton>
              <IconButton
                size="small"
                aria-label="Close find"
                onClick={closeFind}
                sx={{ p: 0.25 }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
            {showReplace && !readOnly && onChange && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  pl: '26px',
                }}
              >
                {findInput({
                  value: replacement,
                  onChange: setReplacement,
                  placeholder: 'Replace with',
                  onEnter: () => replaceOne(),
                })}
                <Typography
                  component="button"
                  type="button"
                  onClick={replaceOne}
                  disabled={active < 0}
                  sx={{
                    border: 0,
                    bgcolor: 'transparent',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    color: 'primary.main',
                    '&:disabled': { color: 'text.disabled', cursor: 'default' },
                  }}
                >
                  Replace
                </Typography>
                <Typography
                  component="button"
                  type="button"
                  onClick={replaceAll}
                  disabled={!matches.length}
                  sx={{
                    border: 0,
                    bgcolor: 'transparent',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    color: 'primary.main',
                    '&:disabled': { color: 'text.disabled', cursor: 'default' },
                  }}
                >
                  All
                </Typography>
              </Box>
            )}
          </Box>
        ) : (
          value.length > 0 && (
            <Tooltip title="Find (Ctrl+F)">
              <IconButton
                size="small"
                aria-label="Find in text"
                onClick={openFind}
                sx={{
                  position: 'absolute',
                  top: 6,
                  right: 14,
                  zIndex: 2,
                  p: 0.5,
                  opacity: 0.55,
                  bgcolor: 'background.paper',
                  '&:hover': { opacity: 1, bgcolor: 'background.paper' },
                }}
              >
                <FindReplaceIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )
        )}
      </Box>
    </Box>
  );
}

CodeArea.defaultProps = {
  onChange: undefined,
  placeholder: undefined,
  readOnly: false,
  errorLine: undefined,
  minHeight: 160,
  ariaLabel: undefined,
};
