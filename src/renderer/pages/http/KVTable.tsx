// A key / value table (params, headers, form fields, variables) with an on/off box per
// row and an empty row at the end to type the next one in.
import React from 'react';
import { Box, Checkbox, IconButton, TextField, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { KV, kv } from './httpModel';
import { MONO_FONT } from '../notes/highlight';

export default function KVTable({
  rows,
  onChange,
  keyLabel = 'Name',
  valueLabel = 'Value',
  secretKeys,
}: {
  rows: KV[];
  onChange: (rows: KV[]) => void;
  keyLabel?: string;
  valueLabel?: string;
  secretKeys?: RegExp; // values of matching keys are masked until focused
}) {
  const shown = [...rows, kv('', '', true)];
  const set = (i: number, patch: Partial<KV>) => {
    const next = shown.map((r, j) => (j === i ? { ...r, ...patch } : r));
    // the trailing empty row only counts once something is typed in it
    onChange(next.filter((r, j) => j < rows.length || r.key || r.value));
  };
  const field = {
    size: 'small' as const,
    fullWidth: true,
    InputProps: { sx: { fontFamily: MONO_FONT, fontSize: 13 } },
  };
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '34px minmax(0, 1fr) minmax(0, 1.6fr) 34px',
        gap: 0.5,
        alignItems: 'center',
      }}
    >
      {shown.map((r, i) => {
        const last = i === rows.length;
        const secret = !!secretKeys && secretKeys.test(r.key);
        return (
          // eslint-disable-next-line react/no-array-index-key
          <React.Fragment key={i}>
            <Checkbox
              size="small"
              checked={r.enabled}
              disabled={last}
              onChange={(e) => set(i, { enabled: e.target.checked })}
              inputProps={{ 'aria-label': `Use ${r.key || 'row'}` }}
            />
            <TextField
              {...field}
              placeholder={keyLabel}
              value={r.key}
              onChange={(e) => set(i, { key: e.target.value })}
              inputProps={{ 'aria-label': keyLabel }}
              sx={{ opacity: r.enabled ? 1 : 0.5 }}
            />
            <TextField
              {...field}
              placeholder={valueLabel}
              value={r.value}
              type={secret ? 'password' : 'text'}
              onChange={(e) => set(i, { value: e.target.value })}
              inputProps={{
                'aria-label': `${valueLabel} of ${r.key || 'row'}`,
              }}
              sx={{ opacity: r.enabled ? 1 : 0.5 }}
            />
            {last ? (
              <span />
            ) : (
              <Tooltip title="Remove">
                <IconButton
                  size="small"
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                  aria-label={`Remove ${r.key || 'row'}`}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </React.Fragment>
        );
      })}
    </Box>
  );
}
