// A step failed because its port is taken: ask right away whether to end whatever holds
// it (a Docker container publishing it is stopped instead) - and then run the step again.
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import type { PortInfo } from '../../main/ports';
import { MONO_FONT } from '../pages/notes/highlight';

const isDocker = (o: { name: string; command: string }) =>
  /docker|com\.docker|vpnkit|wslrelay/i.test(`${o.name} ${o.command}`);

export default function PortKillPrompt({
  port,
  stepName,
  onYes,
  onNo,
}: {
  port: number;
  stepName: string;
  onYes: () => void; // freed - run the step again
  onNo: () => void;
}) {
  const [info, setInfo] = useState<PortInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInfo(null);
    setError(null);
    window.electron.ports
      .who(port)
      .then(setInfo)
      .catch((e) => setError(String(e?.message || e)));
  }, [port]);

  // a container publishing the port shows up as Docker's own process: stop the container
  const processes = (info?.owners || []).filter(
    (o) => !(info?.containers.length && isDocker(o)),
  );
  const nothing = info && !processes.length && !info.containers.length;

  const yes = async () => {
    if (!info) return;
    setBusy(true);
    const problems: string[] = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const c of info.containers) {
      // eslint-disable-next-line no-await-in-loop
      const r = await window.electron.docker.action([c.id], 'stop');
      if (!r.ok) problems.push(r.error || `Could not stop ${c.name}`);
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const o of processes) {
      // eslint-disable-next-line no-await-in-loop
      const r = await window.electron.ports.kill(o.pid);
      if (!r.ok) problems.push(r.error || `Could not end PID ${o.pid}`);
    }
    setBusy(false);
    if (problems.length) {
      setError(problems.join('\n'));
      setInfo(await window.electron.ports.who(port));
      return;
    }
    onYes();
  };

  return (
    <Dialog open onClose={busy ? undefined : onNo} maxWidth="sm" fullWidth>
      <DialogTitle>Port {port} is in use</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          <b>{stepName}</b> could not start - something else listens on port{' '}
          {port}.
        </Typography>
        {!info && !error && <CircularProgress size={20} />}
        {info?.containers.map((c) => (
          <Typography key={c.id} variant="body2" sx={{ mb: 0.5 }}>
            Docker container <b>{c.name}</b>{' '}
            <Typography
              component="span"
              variant="caption"
              color="text.secondary"
              sx={{ fontFamily: MONO_FONT }}
            >
              ({c.image})
            </Typography>
          </Typography>
        ))}
        {processes.map((o) => (
          <Typography key={o.pid} variant="body2" sx={{ mb: 0.5 }}>
            <b>{o.name || 'Process'}</b> · PID {o.pid}
            {o.command && (
              <Typography
                component="span"
                variant="caption"
                color="text.secondary"
                sx={{
                  display: 'block',
                  fontFamily: MONO_FONT,
                  wordBreak: 'break-all',
                }}
              >
                {o.command}
              </Typography>
            )}
          </Typography>
        ))}
        {nothing && (
          <Alert severity="success">
            Nothing listens on it any more - it can just run again.
          </Alert>
        )}
        {info?.error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {info.error}
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
            {error}
          </Alert>
        )}
        {info && !nothing && (
          <Typography variant="body2" sx={{ mt: 1.5 }}>
            {info.containers.length && !processes.length
              ? 'Stop it and run the step again?'
              : 'Kill it and run the step again? Unsaved work in it is lost.'}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onNo} disabled={busy}>
          No
        </Button>
        <Button
          variant="contained"
          color={nothing ? 'primary' : 'error'}
          disabled={!info || busy}
          startIcon={busy ? <CircularProgress size={14} /> : undefined}
          onClick={nothing ? onYes : yes}
          autoFocus
        >
          {nothing ? 'Run again' : 'Yes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
