import React, { useMemo, useState } from 'react';
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { codeColors, MONO_FONT } from './highlight';
import useCopy from './useCopy';

// Read-only, foldable view of a JSON value: every object / array can be collapsed on its
// own (click the arrow or the line), or all at once. Collapsed nodes show a summary
// ({…} 4 keys). Hovering a line offers its JSON path to copy.

type Line = {
  path: string;
  depth: number;
  key?: string;
  open?: '{' | '[';
  close?: '}' | ']';
  value?: unknown; // primitive
  size?: number; // children of a container
  comma: boolean;
  containerPath?: string; // for closing lines
};

const childPath = (path: string, key: string | number) =>
  typeof key === 'number'
    ? `${path}[${key}]`
    : /^[A-Za-z_$][\w$]*$/.test(key)
      ? `${path}.${key}`
      : `${path}[${JSON.stringify(key)}]`;

const buildLines = (
  value: unknown,
  collapsed: Set<string>,
  path = '$',
  depth = 0,
  key: string | undefined = undefined,
  comma = false,
  out: Line[] = [],
) => {
  const isArray = Array.isArray(value);
  if (value && typeof value === 'object') {
    const entries = isArray
      ? (value as unknown[]).map((v, i) => [i, v] as const)
      : Object.entries(value as object);
    const open = isArray ? '[' : '{';
    const close = isArray ? ']' : '}';
    if (collapsed.has(path) || entries.length === 0) {
      out.push({ path, depth, key, open, close, size: entries.length, comma });
      return out;
    }
    out.push({ path, depth, key, open, size: entries.length, comma: false });
    entries.forEach(([k, v], i) =>
      buildLines(
        v,
        collapsed,
        childPath(path, k),
        depth + 1,
        isArray ? undefined : String(k),
        i < entries.length - 1,
        out,
      ),
    );
    out.push({ path: `${path}#end`, depth, close, comma, containerPath: path });
    return out;
  }
  out.push({ path, depth, key, value, comma });
  return out;
};

const allContainers = (value: unknown, path = '$', out: string[] = []) => {
  if (value && typeof value === 'object') {
    out.push(path);
    const entries = Array.isArray(value)
      ? value.map((v, i) => [i, v] as const)
      : Object.entries(value as object);
    entries.forEach(([k, v]) => allContainers(v, childPath(path, k), out));
  }
  return out;
};

const primitiveClass = (v: unknown) => {
  if (typeof v === 'string') return 'hljs-string';
  if (typeof v === 'number') return 'hljs-number';
  return 'hljs-literal';
};

export default function JsonFoldView({ value }: { value: unknown }) {
  const theme = useTheme();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { copy, copied } = useCopy();
  const lines = useMemo(() => buildLines(value, collapsed), [value, collapsed]);

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      <Box sx={{ display: 'flex', gap: 1, mb: 0.75 }}>
        <Button
          size="small"
          startIcon={<UnfoldLessIcon fontSize="small" />}
          // Collapse everything below the root
          onClick={() => setCollapsed(new Set(allContainers(value).slice(1)))}
        >
          Collapse all
        </Button>
        <Button
          size="small"
          startIcon={<UnfoldMoreIcon fontSize="small" />}
          onClick={() => setCollapsed(new Set())}
        >
          Expand all
        </Button>
      </Box>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          borderRadius: 2,
          border: 1,
          borderColor: 'divider',
          bgcolor: alpha(theme.palette.text.primary, 0.025),
          py: 1,
          fontFamily: MONO_FONT,
          fontSize: '0.8125rem',
          lineHeight: 1.55,
          ...codeColors(theme),
        }}
      >
        {lines.map((line) => {
          const foldable = !!line.open && (line.size ?? 0) > 0;
          const isCollapsed = foldable && collapsed.has(line.path);
          return (
            <Box
              key={line.path}
              onClick={foldable ? () => toggle(line.path) : undefined}
              sx={{
                display: 'flex',
                alignItems: 'center',
                pl: `${8 + line.depth * 18}px`,
                pr: 1,
                whiteSpace: 'pre',
                cursor: foldable ? 'pointer' : 'default',
                '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.04) },
                '&:hover .copy-path': { opacity: 1 },
              }}
            >
              <Box sx={{ width: 18, flexShrink: 0, display: 'flex' }}>
                {foldable && (
                  <ChevronRightIcon
                    sx={{
                      fontSize: 16,
                      color: 'text.secondary',
                      transform: isCollapsed ? 'none' : 'rotate(90deg)',
                      transition: 'transform 0.15s',
                    }}
                  />
                )}
              </Box>
              <Box
                component="span"
                sx={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {line.key !== undefined && (
                  <>
                    <span className="hljs-attr">
                      {JSON.stringify(line.key)}
                    </span>
                    <span className="hljs-punctuation">: </span>
                  </>
                )}
                {line.open && (
                  <span className="hljs-punctuation">
                    {line.open}
                    {line.close && (line.size ?? 0) > 0 && (
                      <Box component="span" sx={{ color: 'text.secondary' }}>
                        …
                      </Box>
                    )}
                    {line.close}
                  </span>
                )}
                {line.open && line.close && (line.size ?? 0) > 0 && (
                  <Box component="span" sx={{ color: 'text.disabled', ml: 1 }}>
                    {line.size} {line.open === '{' ? 'keys' : 'items'}
                  </Box>
                )}
                {!line.open && line.close && (
                  <span className="hljs-punctuation">{line.close}</span>
                )}
                {!line.open && !line.close && (
                  <span className={primitiveClass(line.value)}>
                    {JSON.stringify(line.value)}
                  </span>
                )}
                {line.comma && <span className="hljs-punctuation">,</span>}
              </Box>
              {!line.containerPath && (
                <Tooltip
                  title={
                    copied === line.path ? 'Copied!' : `Copy path ${line.path}`
                  }
                >
                  <IconButton
                    className="copy-path"
                    size="small"
                    aria-label="Copy JSON path"
                    onClick={(e) => {
                      e.stopPropagation();
                      copy(line.path, line.path);
                    }}
                    sx={{ opacity: 0, p: 0.25 }}
                  >
                    <ContentCopyIcon sx={{ fontSize: 13 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          );
        })}
        {lines.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2 }}>
            Empty
          </Typography>
        )}
      </Box>
    </Box>
  );
}
