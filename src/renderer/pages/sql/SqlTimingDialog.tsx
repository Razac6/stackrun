// DB Client → "Time it": measure a query (5 runs, the median), name the measurement
// ("before the index"), and compare it with the earlier ones of the same query.
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SpeedIcon from '@mui/icons-material/Speed';
import { MONO_FONT } from '../notes/highlight';
import {
  addTiming,
  change,
  msText,
  parseTimings,
  SavedTiming,
  timingKey,
  TIMINGS_KEY,
} from './sqlModel';

function Delta({ now, before }: { now: number; before?: number }) {
  const d = change(now, before);
  if (!d) return null;
  // a few percent is noise
  let color: 'success' | 'error' | 'default' = 'default';
  if (d.pct <= -5) color = 'success';
  else if (d.pct >= 5) color = 'error';
  return (
    <Chip
      size="small"
      variant="outlined"
      color={color}
      label={d.text}
      sx={{ height: 20, fontSize: 11 }}
    />
  );
}

export default function SqlTimingDialog({
  open,
  onClose,
  container,
  db,
  sql,
  schema,
  note,
}: {
  open: boolean;
  onClose: () => void;
  container: string;
  db: string;
  sql: string;
  schema?: string;
  note?: string; // e.g. why it is timed in a rolled back transaction
}) {
  const [list, setList] = useState<SavedTiming[]>([]);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runId = useRef('');
  const key = timingKey(container, db, sql);

  const load = async () => {
    const s = await window.electron.database.getAllSettings();
    return parseTimings(s?.[TIMINGS_KEY]);
  };

  useEffect(() => {
    if (!open) return;
    setError(null);
    load()
      .then((all) => {
        const mine = all[key] || [];
        setList(mine);
        setLabel(mine.length ? 'after' : 'before');
        return all;
      })
      .catch(() => setList([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  const save = async (mine: SavedTiming[]) => {
    const all = await load();
    const next = { ...all, [key]: mine };
    if (!mine.length) delete next[key];
    await window.electron.database.setSetting(
      TIMINGS_KEY,
      JSON.stringify(next),
    );
    setList(mine);
  };

  const measure = async () => {
    setBusy(true);
    setError(null);
    runId.current = `time-${Date.now()}`;
    const t = await window.electron.sql.time(
      runId.current,
      container,
      db,
      sql,
      schema,
    );
    setBusy(false);
    if (!t.ok) {
      setError(t.error);
      return;
    }
    const all = addTiming(await load(), key, {
      at: Date.now(),
      label: label.trim() || new Date().toLocaleTimeString(),
      ms: t.ms,
      minMs: t.minMs,
      maxMs: t.maxMs,
      method: t.method,
    });
    await window.electron.database.setSetting(TIMINGS_KEY, JSON.stringify(all));
    setList(all[key] || []);
    setLabel('after');
  };

  const first = list[0];
  const rows = [...list].reverse(); // newest on top
  const method = list[list.length - 1]?.method;

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Time this query</DialogTitle>
      <DialogContent>
        <Box
          sx={{
            fontFamily: MONO_FONT,
            fontSize: 12,
            bgcolor: 'action.hover',
            borderRadius: 1,
            p: 1,
            mb: 1.5,
            maxHeight: 90,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {sql.trim()}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Runs it once to warm up, then 5 times - the median is compared. Time
          it before a change (an index, a new version of the schema), then
          after.
          {note ? ` ${note}` : ''}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5 }}>
          <TextField
            size="small"
            label="Name of this measurement"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) measure();
            }}
            sx={{ flex: 1 }}
          />
          {busy ? (
            <Button
              color="error"
              onClick={() => window.electron.sql.cancel(runId.current)}
              startIcon={<CircularProgress size={14} />}
            >
              Stop
            </Button>
          ) : (
            <Button
              variant="contained"
              startIcon={<SpeedIcon />}
              onClick={measure}
            >
              Measure
            </Button>
          )}
        </Box>
        {error && (
          <Alert severity="error" sx={{ mb: 1.5, whiteSpace: 'pre-wrap' }}>
            {error}
          </Alert>
        )}
        {!rows.length && (
          <Typography variant="body2" color="text.secondary">
            Not measured yet.
          </Typography>
        )}
        {rows.map((t, i) => {
          const before = rows[i + 1];
          return (
            <Box
              key={t.at}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                py: 0.6,
                borderBottom: 1,
                borderColor: 'divider',
                '&:hover .timing-delete': { opacity: 1 },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                  {t.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(t.at).toLocaleString()} · {msText(t.minMs)} –{' '}
                  {msText(t.maxMs)}
                </Typography>
              </Box>
              <Typography
                sx={{ fontFamily: MONO_FONT, fontWeight: 700, minWidth: 80 }}
                align="right"
              >
                {msText(t.ms)}
              </Typography>
              <Tooltip title="Against the measurement before it">
                <span>
                  <Delta now={t.ms} before={before?.ms} />
                </span>
              </Tooltip>
              {first && t !== first && before !== first && (
                <Tooltip title={`Against the first one ("${first.label}")`}>
                  <span>
                    <Delta now={t.ms} before={first.ms} />
                  </span>
                </Tooltip>
              )}
              <IconButton
                className="timing-delete"
                size="small"
                aria-label="Delete this measurement"
                onClick={() => save(list.filter((x) => x !== t))}
                sx={{ opacity: 0, p: 0.25 }}
              >
                <DeleteOutlineIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
          );
        })}
        {method && (
          <Typography
            variant="caption"
            color="text.secondary"
            component="div"
            sx={{ mt: 1 }}
          >
            {method === 'server'
              ? "Time on the database's own clock (EXPLAIN ANALYZE: planning + execution)."
              : 'Round trip minus the time of a ping (docker exec + connecting) - small differences are noise.'}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
