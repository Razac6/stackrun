import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import CleaningServicesOutlinedIcon from '@mui/icons-material/CleaningServicesOutlined';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import { MONO_FONT } from './highlight';
import {
  CommandsState,
  SETTINGS_KEY,
  emptyGroup,
  newId,
  parseState,
  saveCommand,
} from './commandsModel';
import type { DockerContainer } from '../../../main/dockerTools';

// "Reset database": an empty database in a running container (drop + recreate), ready for
// `flyway migrate` & co. The same reset can be saved as a step in Dev Notes > Commands, so
// a package like "Fresh DB" = reset + flyway migrate runs with one click.

const NEW_PACKAGE = '__new__';

export default function ResetDbDialog({
  container,
  onClose,
  onDone,
}: {
  container: DockerContainer | null;
  onClose: () => void;
  onDone: (ok: boolean, message: string) => void;
}) {
  const theme = useTheme();
  const [dbName, setDbName] = useState('');
  const [command, setCommand] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [commands, setCommands] = useState<CommandsState | null>(null);
  const [target, setTarget] = useState(NEW_PACKAGE);
  const [saved, setSaved] = useState(false);
  const isRedis = container?.db === 'redis';

  // first load: default db name + saved command packages
  useEffect(() => {
    if (!container) return;
    setSaved(false);
    setLoading(true);
    window.electron.docker.resetInfo(container.id).then((info) => {
      setDbName(info.dbName || '');
      setCommand(info.command || '');
      setError(info.error);
      setLoading(false);
      return info;
    });
    window.electron.database.getAllSettings().then((settings: any) => {
      setCommands(parseState(settings?.[SETTINGS_KEY]));
      return settings;
    });
  }, [container]);

  // the preview follows the name
  useEffect(() => {
    if (!container || loading) return undefined;
    const timer = setTimeout(() => {
      window.electron.docker.resetInfo(container.id, dbName).then((info) => {
        setCommand(info.command || '');
        setError(info.error);
        return info;
      });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbName]);

  if (!container) return null;
  const running = container.state === 'running';
  const what = isRedis ? 'all keys' : `database "${dbName}"`;

  const reset = async () => {
    setBusy(true);
    const result = await window.electron.docker.resetDb(container.id, dbName);
    setBusy(false);
    onDone(
      result.ok,
      result.ok
        ? `${container.name}: ${isRedis ? 'flushed' : `${dbName} is empty now`}`
        : result.error || 'Reset failed',
    );
  };

  const saveAsCommand = () => {
    if (!commands || !command) return;
    let state = commands;
    let groupId = target;
    if (target === NEW_PACKAGE) {
      const group = emptyGroup(`Fresh ${isRedis ? container.name : dbName}`);
      state = { groups: [...state.groups, group] };
      groupId = group.id;
    }
    // docker start is a no-op for a running container; the step then waits until the
    // database really accepts connections, so the reset (and flyway after it) don't race it
    const withStart = saveCommand(state, groupId, {
      id: newId('c'),
      name: `Start ${container.name}`,
      command: `docker start ${container.name}`,
      cwd: '',
      wait: true,
      ready: { type: 'container', target: container.name, timeout: 120 },
    });
    const next = saveCommand(withStart, groupId, {
      id: newId('c'),
      name: `Reset ${isRedis ? container.name : dbName}`,
      command,
      cwd: '',
      wait: true,
    });
    window.electron.database.setSetting(SETTINGS_KEY, JSON.stringify(next));
    setCommands(next);
    setTarget(groupId);
    setSaved(true);
  };

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{ sx: { p: 2.5, borderRadius: 3 } }}
    >
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        Reset database - {container.name}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {isRedis
          ? 'Deletes every key (FLUSHALL).'
          : 'Drops the database and creates it again, empty, with the same owner - then run your migrations (e.g. flyway migrate).'}{' '}
        The container and its other databases stay.
      </Typography>

      {!isRedis && (
        <TextField
          size="small"
          label="Database"
          value={dbName}
          onChange={(e) => setDbName(e.target.value.trim())}
          sx={{ mt: 2 }}
          fullWidth
          InputProps={{ sx: { fontFamily: MONO_FONT } }}
        />
      )}

      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        sx={{ mt: 2, mb: 0.5 }}
      >
        What runs:
      </Typography>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1,
          fontFamily: MONO_FONT,
          fontSize: 11.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          bgcolor: alpha(theme.palette.text.primary, 0.05),
          borderRadius: 1.5,
          minHeight: 36,
        }}
      >
        {loading ? '…' : command || error}
      </Box>
      {!running && (
        <Typography
          variant="caption"
          color="warning.main"
          component="div"
          sx={{ mt: 1 }}
        >
          The container is stopped - start it to reset now. You can still save
          the step.
        </Typography>
      )}

      {/* Save as a Commands step */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mt: 2,
          flexWrap: 'wrap',
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Save as a command in
        </Typography>
        <Select
          size="small"
          value={target}
          onChange={(e) => {
            setTarget(String(e.target.value));
            setSaved(false);
          }}
          sx={{
            fontSize: 13,
            minWidth: 160,
            '& .MuiSelect-select': { py: 0.5 },
          }}
          aria-label="Package for the reset step"
        >
          <MenuItem value={NEW_PACKAGE}>
            New package &quot;Fresh {isRedis ? container.name : dbName}&quot;
          </MenuItem>
          {commands?.groups.map((g) => (
            <MenuItem key={g.id} value={g.id}>
              {g.name}
            </MenuItem>
          ))}
        </Select>
        <Button
          size="small"
          startIcon={<PlaylistAddIcon />}
          disabled={!command || !!error || saved}
          onClick={saveAsCommand}
        >
          {saved ? 'Saved' : 'Save'}
        </Button>
      </Box>
      {saved && (
        <Typography variant="caption" color="success.main" component="div">
          Added to Commands (start + wait until the DB accepts connections, then
          reset) - add your migration after it (e.g. flyway migrate in your
          project folder) and run the package.
        </Typography>
      )}

      <Box
        sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2.5 }}
      >
        <Button size="small" onClick={onClose} disabled={busy}>
          Close
        </Button>
        <Button
          size="small"
          color="error"
          variant="contained"
          disableElevation
          disabled={busy || !running || !!error || loading}
          onClick={reset}
          startIcon={
            busy ? (
              <CircularProgress size={14} color="inherit" />
            ) : (
              <CleaningServicesOutlinedIcon />
            )
          }
        >
          Empty {what}
        </Button>
      </Box>
    </Dialog>
  );
}
