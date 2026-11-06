// Docker → "Compose up": pick a docker compose file and run `docker compose up -d` in its
// folder - its containers then show up in the list. Recent files stay for next time.
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import { MONO_FONT } from './highlight';

const KEY = 'docker_compose_recent';
const MAX_RECENT = 8;
const RUN_ID = 'compose';

const folderName = (file: string) => {
  const parts = file.split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : file;
};

export default function ComposeDialog({
  open,
  onClose,
  onStarted,
}: {
  open: boolean;
  onClose: () => void;
  onStarted: (what: string) => void;
}) {
  const [file, setFile] = useState('');
  const [build, setBuild] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<'up' | 'down' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    window.electron.database.getAllSettings().then((s) => {
      try {
        const list = JSON.parse(s?.[KEY] || '[]');
        if (Array.isArray(list)) {
          setRecent(list.map(String));
          setFile((cur) => cur || String(list[0] || ''));
        }
      } catch (e) {
        setRecent([]);
      }
    });
  }, [open]);

  useEffect(
    () =>
      window.electron.ipcRenderer.on('compose:log', (msg: any) => {
        if (msg?.id === RUN_ID)
          setLog((l) => [...l, String(msg.line)].slice(-2000));
      }),
    [],
  );
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const remember = (list: string[]) => {
    setRecent(list);
    window.electron.database.setSetting(KEY, JSON.stringify(list));
  };

  const go = async (what: 'up' | 'down') => {
    const path = file.trim();
    if (!path) return;
    setError(null);
    setLog([]);
    setBusy(what);
    const run = { id: RUN_ID, file: path, build };
    const r =
      what === 'up'
        ? await window.electron.compose.up(run)
        : await window.electron.compose.down(run);
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    remember([path, ...recent.filter((f) => f !== path)].slice(0, MAX_RECENT));
    onStarted(
      what === 'up'
        ? `${folderName(path)} is up`
        : `${folderName(path)} is down`,
    );
  };

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>Docker compose up</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Runs <code>docker compose -f &lt;file&gt; up -d</code> in the
          file&apos;s folder (its .env is used), like in a terminal there.
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <TextField
            size="small"
            label="Compose file"
            placeholder="/path/to/docker-compose.yml"
            value={file}
            onChange={(e) => setFile(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) go('up');
            }}
            InputProps={{ sx: { fontFamily: MONO_FONT, fontSize: 13 } }}
            fullWidth
            autoFocus
          />
          <Tooltip title="Pick the file">
            <IconButton
              onClick={async () => {
                const picked = await window.electron.compose.pick(file);
                if (picked) setFile(picked);
              }}
              aria-label="Pick compose file"
            >
              <FolderOpenOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        <FormControlLabel
          sx={{ mt: 0.5 }}
          control={
            <Checkbox
              size="small"
              checked={build}
              onChange={(e) => setBuild(e.target.checked)}
            />
          }
          label={
            <Typography variant="body2">
              Build the images again (<code>--build</code>)
            </Typography>
          }
        />
        {recent.length > 0 && (
          <>
            <Typography
              variant="overline"
              color="text.secondary"
              component="div"
            >
              Recent
            </Typography>
            <List dense disablePadding>
              {recent.map((f) => (
                <ListItemButton
                  key={f}
                  selected={f === file}
                  onClick={() => setFile(f)}
                  sx={{ borderRadius: 1, pr: 0.5 }}
                >
                  <ListItemText
                    primary={folderName(f)}
                    secondary={f}
                    secondaryTypographyProps={{
                      noWrap: true,
                      sx: { fontFamily: MONO_FONT, fontSize: 11 },
                    }}
                  />
                  <IconButton
                    size="small"
                    aria-label={`Forget ${f}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      remember(recent.filter((x) => x !== f));
                    }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </ListItemButton>
              ))}
            </List>
          </>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1.5, whiteSpace: 'pre-wrap' }}>
            {error}
          </Alert>
        )}
        {(busy || log.length > 0) && (
          <Box
            ref={logRef}
            sx={{
              mt: 1.5,
              height: 220,
              overflow: 'auto',
              bgcolor: 'action.hover',
              borderRadius: 1,
              p: 1,
              fontFamily: MONO_FONT,
              fontSize: 12,
              whiteSpace: 'pre-wrap',
            }}
          >
            {log.join('\n') || '…'}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Tooltip title="docker compose down: stops and removes its containers">
          <span>
            <Button
              color="error"
              disabled={!file.trim() || !!busy}
              onClick={() => go('down')}
              sx={{ mr: 'auto' }}
            >
              Down
            </Button>
          </span>
        </Tooltip>
        <Button onClick={onClose} disabled={!!busy}>
          Close
        </Button>
        {busy ? (
          <Button
            color="error"
            variant="outlined"
            startIcon={<StopIcon />}
            onClick={() => window.electron.compose.stop(RUN_ID)}
          >
            Stop
          </Button>
        ) : (
          <Button
            variant="contained"
            startIcon={<PlayArrowIcon />}
            disabled={!file.trim()}
            onClick={() => go('up')}
          >
            Up
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
