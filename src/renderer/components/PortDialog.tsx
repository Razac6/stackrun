// "Port in use": see who listens on a port and end it - after a confirmation. A Docker
// container that publishes the port is offered to be stopped instead.
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { PortInfo } from '../../main/ports';
import { MONO_FONT } from '../pages/notes/highlight';

export default function PortDialog({
  open,
  port: initialPort,
  onClose,
  onFreed,
}: {
  open: boolean;
  port: number | null;
  onClose: () => void;
  onFreed?: (port: number) => void;
}) {
  const [port, setPort] = useState('');
  const [info, setInfo] = useState<PortInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<number | string | null>(null); // pid / container id
  const [message, setMessage] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);

  const look = useCallback(async (p: number) => {
    setLoading(true);
    setConfirm(null);
    const r = await window.electron.ports.who(p);
    setInfo(r);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    setMessage(null);
    setInfo(null);
    setPort(initialPort ? String(initialPort) : '');
    if (initialPort) look(initialPort);
  }, [open, initialPort, look]);

  const kill = async (pid: number) => {
    const r = await window.electron.ports.kill(pid);
    setConfirm(null);
    if (!r.ok) {
      setMessage({ text: r.error || 'Could not end it', error: true });
      return;
    }
    setMessage({ text: `Ended process ${pid}` });
    const p = Number(port);
    await look(p);
    onFreed?.(p);
  };

  const stopContainer = async (id: string, name: string) => {
    const r = await window.electron.docker.action([id], 'stop');
    setConfirm(null);
    if (!r.ok) {
      setMessage({ text: r.error || 'Could not stop it', error: true });
      return;
    }
    setMessage({ text: `Stopped ${name}` });
    const p = Number(port);
    await look(p);
    onFreed?.(p);
  };

  const free = info && !info.owners.length && !info.containers.length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Port in use</DialogTitle>
      <DialogContent>
        <Stack direction="row" spacing={1} sx={{ mb: 2, mt: 0.5 }}>
          <TextField
            size="small"
            label="Port"
            value={port}
            onChange={(e) =>
              setPort(e.target.value.replace(/\D/g, '').slice(0, 5))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' && Number(port)) look(Number(port));
            }}
            sx={{ width: 140 }}
            autoFocus
          />
          <Button
            variant="outlined"
            disabled={!Number(port) || loading}
            onClick={() => look(Number(port))}
          >
            Who uses it?
          </Button>
          {loading && (
            <CircularProgress size={20} sx={{ alignSelf: 'center' }} />
          )}
        </Stack>
        {message && (
          <Alert
            severity={message.error ? 'error' : 'success'}
            sx={{ mb: 1.5 }}
          >
            {message.text}
          </Alert>
        )}
        {free && (
          <Alert severity="success">
            Nothing listens on {info!.port} - it is free.
          </Alert>
        )}
        {info?.containers.map((c) => (
          <Paper key={c.id} variant="outlined" sx={{ p: 1.5, mb: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Docker container {c.name}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontFamily: MONO_FONT }}
            >
              {c.image} publishes {info.port}
            </Typography>
            <Box sx={{ mt: 1 }}>
              {confirm === c.id ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2">Stop {c.name}?</Typography>
                  <Button
                    size="small"
                    color="warning"
                    variant="contained"
                    onClick={() => stopContainer(c.id, c.name)}
                  >
                    Stop it
                  </Button>
                  <Button size="small" onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                </Stack>
              ) : (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setConfirm(c.id)}
                >
                  Stop container
                </Button>
              )}
            </Box>
          </Paper>
        ))}
        {info?.owners.map((o) => (
          <Paper key={o.pid} variant="outlined" sx={{ p: 1.5, mb: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {o.name || 'Process'} · PID {o.pid}
              <Typography
                component="span"
                variant="caption"
                color="text.secondary"
                sx={{ ml: 1 }}
              >
                {o.address}
              </Typography>
            </Typography>
            {o.command && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  display: 'block',
                  fontFamily: MONO_FONT,
                  wordBreak: 'break-all',
                  mt: 0.5,
                }}
              >
                {o.command}
              </Typography>
            )}
            {/docker|com\.docker|vpnkit|wslrelay/i.test(
              `${o.name} ${o.command}`,
            ) && (
              <Typography
                variant="caption"
                color="warning.main"
                sx={{ display: 'block', mt: 0.5 }}
              >
                This is Docker itself - stop the container instead of ending it.
              </Typography>
            )}
            <Box sx={{ mt: 1 }}>
              {confirm === o.pid ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2">
                    End {o.name || 'it'} (PID {o.pid})? Unsaved work in it is
                    lost.
                  </Typography>
                  <Button
                    size="small"
                    color="error"
                    variant="contained"
                    onClick={() => kill(o.pid)}
                  >
                    End it
                  </Button>
                  <Button size="small" onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                </Stack>
              ) : (
                <Button
                  size="small"
                  color="error"
                  variant="outlined"
                  onClick={() => setConfirm(o.pid)}
                >
                  Kill process
                </Button>
              )}
            </Box>
          </Paper>
        ))}
        {info?.error && <Alert severity="error">{info.error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
