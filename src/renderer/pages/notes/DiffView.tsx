import React, { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { DiffRow, lineDiff } from './jsonTools';
import { MONO_FONT } from './highlight';

// Side-by-side line diff: removed lines red on the left, added green on the right, changed
// lines on both. With `onlyChanges` long unchanged stretches collapse to a "… N lines" row.

const CONTEXT = 3;

type Item = DiffRow | { kind: 'skip'; count: number };

export default function DiffView({
  left,
  right,
  leftLabel = 'Left',
  rightLabel = 'Right',
  onlyChanges = false,
  maxHeight,
}: {
  left: string;
  right: string;
  leftLabel?: string;
  rightLabel?: string;
  onlyChanges?: boolean;
  maxHeight?: number | string;
}) {
  const theme = useTheme();
  const rows = useMemo(() => lineDiff(left, right), [left, right]);
  const changed = rows.filter((r) => r.kind !== 'same').length;

  const items: Item[] = useMemo(() => {
    if (!onlyChanges) return rows;
    const keep = rows.map((r) => r.kind !== 'same');
    const near = rows.map((_, i) =>
      keep.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some(Boolean),
    );
    const out: Item[] = [];
    let skipped = 0;
    rows.forEach((row, i) => {
      if (near[i]) {
        if (skipped) out.push({ kind: 'skip', count: skipped });
        skipped = 0;
        out.push(row);
      } else skipped += 1;
    });
    if (skipped) out.push({ kind: 'skip', count: skipped });
    return out;
  }, [rows, onlyChanges]);

  const red = alpha(theme.palette.error.main, 0.12);
  const green = alpha(theme.palette.success.main, 0.14);
  const cell = (
    text: string | undefined,
    no: number | undefined,
    tint: string | undefined,
  ) => (
    <>
      <Box
        sx={{
          px: 1,
          textAlign: 'right',
          color: 'text.disabled',
          userSelect: 'none',
          bgcolor: tint,
        }}
      >
        {no ?? ''}
      </Box>
      <Box
        sx={{
          px: 1,
          whiteSpace: 'pre',
          bgcolor: tint,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {text ?? ''}
      </Box>
    </>
  );

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        maxHeight,
        // In a full-height parent (the dialog) it fills the space and scrolls inside
        flex: maxHeight === '100%' ? 1 : undefined,
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: alpha(theme.palette.text.primary, 0.03),
        }}
      >
        <Typography
          variant="caption"
          sx={{ px: 1.5, py: 0.75, fontWeight: 600 }}
        >
          {leftLabel}
        </Typography>
        <Typography
          variant="caption"
          sx={{ px: 1.5, py: 0.75, fontWeight: 600 }}
        >
          {rightLabel}
          <Box
            component="span"
            sx={{ float: 'right', color: 'text.secondary', fontWeight: 400 }}
          >
            {changed
              ? `${changed} changed line${changed === 1 ? '' : 's'}`
              : 'Identical'}
          </Box>
        </Typography>
      </Box>
      <Box
        sx={{
          overflow: 'auto',
          fontFamily: MONO_FONT,
          fontSize: '0.78rem',
          lineHeight: 1.6,
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr) auto minmax(0, 1fr)',
          }}
        >
          {items.map((item, i) => {
            if (item.kind === 'skip') {
              return (
                <Box
                  // eslint-disable-next-line react/no-array-index-key
                  key={`skip-${i}`}
                  sx={{
                    gridColumn: '1 / -1',
                    textAlign: 'center',
                    color: 'text.disabled',
                    bgcolor: alpha(theme.palette.text.primary, 0.03),
                    py: 0.25,
                  }}
                >
                  ⋯ {item.count} unchanged line{item.count === 1 ? '' : 's'}
                </Box>
              );
            }
            const row = item as DiffRow;
            const leftTint =
              row.kind === 'removed' || row.kind === 'changed'
                ? red
                : undefined;
            const rightTint =
              row.kind === 'added' || row.kind === 'changed'
                ? green
                : undefined;
            return (
              // eslint-disable-next-line react/no-array-index-key
              <React.Fragment key={i}>
                {cell(row.left, row.leftNo, leftTint)}
                <Box
                  sx={{
                    display: 'contents',
                    '& > div:first-of-type': {
                      borderLeft: 1,
                      borderColor: 'divider',
                    },
                  }}
                >
                  {cell(row.right, row.rightNo, rightTint)}
                </Box>
              </React.Fragment>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

DiffView.defaultProps = {
  leftLabel: 'Left',
  rightLabel: 'Right',
  onlyChanges: false,
  maxHeight: undefined,
};
