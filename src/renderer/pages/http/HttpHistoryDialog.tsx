// HTTP Client → History: the last 100 requests sent, with their responses, searchable
// (URL, status, headers, bodies). A saved request can be opened again from here.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { HistoryEntry } from '../../../main/httpHistory';
import { MONO_FONT } from '../notes/highlight';
import { searchHistory } from './httpHistoryModel';

const when = (at: number) => {
  const d = new Date(at);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString()
    : d.toLocaleString();
};

export default function HttpHistoryDialog({
  open,
  onClose,
  renderResponse,
  canOpen,
  onOpenRequest,
}: {
  open: boolean;
  onClose: () => void;
  renderResponse: (entry: HistoryEntry) => React.ReactNode;
  canOpen: (requestId: string) => boolean;
  onOpenRequest: (requestId: string) => void;
}) {
  const [list, setList] = useState<HistoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    window.electron.http
      .history()
      .then((l) => {
        setList(l);
        setPicked((p) =>
          p && l.some((e) => e.id === p) ? p : l[0]?.id || null,
        );
        return l;
      })
      .catch(() => setList([]));
  }, [open]);

  const shown = useMemo(() => searchHistory(list, query), [list, query]);
  const entry = shown.find((e) => e.id === picked) || shown[0] || null;

  const remove = async (id: string) => {
    await window.electron.http.deleteHistory(id);
    setList((l) => l.filter((e) => e.id !== id));
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        History
        <Typography
          component="span"
          variant="caption"
          color="text.secondary"
          sx={{ ml: 1 }}
        >
          last {list.length} of 100 kept
        </Typography>
      </DialogTitle>
      <DialogContent
        sx={{
          display: 'grid',
          gridTemplateColumns: '340px minmax(0, 1fr)',
          gap: 1.5,
          height: '70vh',
          minHeight: 0,
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <TextField
            size="small"
            autoFocus
            placeholder="Search URL, status, headers, bodies…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ mb: 1 }}
          />
          <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            {!shown.length && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                {list.length ? 'Nothing matches.' : 'Nothing sent yet.'}
              </Typography>
            )}
            {shown.map((e) => {
              const failed = !!e.result.error || e.result.status >= 400;
              return (
                <Box
                  key={e.id}
                  onClick={() => setPicked(e.id)}
                  sx={{
                    px: 1,
                    py: 0.6,
                    borderRadius: 1,
                    cursor: 'pointer',
                    bgcolor: entry?.id === e.id ? 'action.selected' : undefined,
                    '&:hover': { bgcolor: 'action.hover' },
                    '&:hover .row-delete': { opacity: 1 },
                  }}
                >
                  <Box
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
                  >
                    <Chip
                      size="small"
                      color={failed ? 'error' : 'success'}
                      variant="outlined"
                      label={e.result.error ? 'ERR' : e.result.status}
                      sx={{ height: 20, fontSize: 11 }}
                    />
                    <Typography
                      variant="body2"
                      noWrap
                      sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}
                    >
                      {e.name || e.sent.url}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {when(e.at)}
                    </Typography>
                    <IconButton
                      className="row-delete"
                      size="small"
                      aria-label="Delete from history"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        remove(e.id);
                      }}
                      sx={{ opacity: 0, p: 0.25 }}
                    >
                      <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    component="div"
                    sx={{ fontFamily: MONO_FONT, fontSize: 11 }}
                  >
                    {e.sent.method} {e.sent.url}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {entry && (
            <>
              <Box
                sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}
              >
                <Typography
                  variant="body2"
                  noWrap
                  sx={{ fontFamily: MONO_FONT, flex: 1, minWidth: 0 }}
                  title={entry.sent.url}
                >
                  {entry.sent.method} {entry.sent.url}
                </Typography>
                {entry.collection && (
                  <Typography variant="caption" color="text.secondary">
                    {entry.collection}
                  </Typography>
                )}
                {entry.requestId && canOpen(entry.requestId) && (
                  <Tooltip title="Open the saved request">
                    <Button
                      size="small"
                      startIcon={<OpenInNewIcon />}
                      onClick={() => onOpenRequest(entry.requestId!)}
                    >
                      Open request
                    </Button>
                  </Tooltip>
                )}
              </Box>
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  '& > *': { flex: 1 },
                }}
              >
                {renderResponse(entry)}
              </Box>
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button
          color="error"
          disabled={!list.length}
          sx={{ mr: 'auto' }}
          onClick={async () => {
            // eslint-disable-next-line no-alert
            if (!window.confirm('Clear the whole HTTP history?')) return;
            await window.electron.http.clearHistory();
            setList([]);
          }}
        >
          Clear history
        </Button>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
