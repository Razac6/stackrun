import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  FormControlLabel,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CleaningServicesOutlinedIcon from '@mui/icons-material/CleaningServicesOutlined';
import StraightenIcon from '@mui/icons-material/Straighten';
import { MONO_FONT } from './highlight';
import type { DockerContainer, DockerVolume } from '../../../main/dockerTools';

// Docker volumes (list, sizes, delete, prune) and the "remove container" dialog, which can
// also delete the container's volumes - the usual way to reset a database container.

const shortName = (v: { name: string; anonymous: boolean }) =>
  v.anonymous ? `${v.name.slice(0, 12)}…` : v.name;

function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      fullWidth
      maxWidth="xs"
      PaperProps={{ sx: { p: 2.5, borderRadius: 3 } }}
    >
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
        {title}
      </Typography>
      {children}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 }}>
        <Button size="small" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          size="small"
          color="error"
          variant="contained"
          disableElevation
          disabled={busy}
          onClick={onConfirm}
          startIcon={
            busy ? (
              <CircularProgress size={14} color="inherit" />
            ) : (
              <DeleteOutlineIcon />
            )
          }
        >
          {confirmLabel}
        </Button>
      </Box>
    </Dialog>
  );
}

/** Remove a container; optionally its anonymous volumes and the named ones it mounts. */
export function RemoveContainerDialog({
  container,
  onClose,
  onDone,
}: {
  container: DockerContainer | null;
  onClose: () => void;
  onDone: (ok: boolean, message: string) => void;
}) {
  const [anonymous, setAnonymous] = useState(true);
  const [volumes, setVolumes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAnonymous(true);
    setVolumes([]);
    setBusy(false);
  }, [container]);

  if (!container) return null;
  const named = container.volumes.filter((v) => !/^[0-9a-f]{64}$/.test(v));
  const running =
    container.state === 'running' ||
    container.state === 'restarting' ||
    container.state === 'paused';

  const confirm = async () => {
    setBusy(true);
    const result = await window.electron.docker.remove(container.id, {
      force: running,
      anonymousVolumes: anonymous,
      volumes,
    });
    setBusy(false);
    onDone(
      result.ok,
      result.ok
        ? `Removed ${container.name}${volumes.length ? ` and ${volumes.length} volume(s)` : ''}`
        : result.error || "Couldn't remove it",
    );
  };

  return (
    <ConfirmDialog
      open
      title={`Remove ${container.name}?`}
      confirmLabel={volumes.length ? 'Remove with data' : 'Remove'}
      busy={busy}
      onConfirm={confirm}
      onClose={onClose}
    >
      <Typography variant="body2" color="text.secondary">
        {running ? 'It is running - it will be stopped first. ' : ''}
        The image stays; you can recreate the container (e.g. docker compose
        up).
      </Typography>
      <FormControlLabel
        sx={{ mt: 1 }}
        control={
          <Checkbox
            size="small"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
          />
        }
        label={
          <Typography variant="body2">
            Also remove its anonymous volumes
          </Typography>
        }
      />
      {named.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary" component="div">
            Named volumes (data survives unless you tick them):
          </Typography>
          {named.map((v) => (
            <FormControlLabel
              key={v}
              sx={{ display: 'flex' }}
              control={
                <Checkbox
                  size="small"
                  color="error"
                  checked={volumes.includes(v)}
                  onChange={(e) =>
                    setVolumes((list) =>
                      e.target.checked
                        ? [...list, v]
                        : list.filter((x) => x !== v),
                    )
                  }
                />
              }
              label={
                <Typography
                  variant="body2"
                  sx={{ fontFamily: MONO_FONT, fontSize: 13 }}
                >
                  {v}
                </Typography>
              }
            />
          ))}
          {volumes.length > 0 && (
            <Typography variant="caption" color="error.main">
              The data in{' '}
              {volumes.length === 1 ? 'this volume' : 'these volumes'} is
              deleted for good.
            </Typography>
          )}
        </Box>
      )}
    </ConfirmDialog>
  );
}

/** Filtering for the volume list - exported for tests. */
export const filterVolumes = (
  volumes: DockerVolume[],
  query: string,
  unusedOnly: boolean,
) => {
  const q = query.trim().toLowerCase();
  return volumes
    .filter((v) => !unusedOnly || !v.usedBy.length)
    .filter(
      (v) =>
        !q ||
        [v.name, v.project || '', ...v.usedBy]
          .join(' ')
          .toLowerCase()
          .includes(q),
    );
};

export function VolumesView({
  query,
  refreshKey,
  onMessage,
  onChanged,
}: {
  query: string;
  refreshKey: number;
  onMessage: (text: string, error?: boolean) => void;
  onChanged: () => void;
}) {
  const [volumes, setVolumes] = useState<DockerVolume[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sizesLoading, setSizesLoading] = useState(false);
  const [withSizes, setWithSizes] = useState(false);
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<
    { kind: 'delete'; names: string[] } | { kind: 'prune' } | null
  >(null);
  const [pruneNamed, setPruneNamed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (sizes = withSizes) => {
      if (sizes) setSizesLoading(true);
      const result = await window.electron.docker.volumes(sizes);
      setVolumes(result.volumes);
      setError(result.error);
      setLoading(false);
      setSizesLoading(false);
      setSelected((list) =>
        list.filter((n) =>
          result.volumes.some((v) => v.name === n && !v.usedBy.length),
        ),
      );
    },
    [withSizes],
  );

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const shown = useMemo(
    () => filterVolumes(volumes, query, unusedOnly),
    [volumes, query, unusedOnly],
  );
  const unused = volumes.filter((v) => !v.usedBy.length);

  const runDelete = async (names: string[]) => {
    setBusy(true);
    const result = await window.electron.docker.removeVolumes(names);
    setBusy(false);
    setConfirm(null);
    onMessage(
      result.ok
        ? `Deleted ${names.length} volume(s)`
        : result.error || "Couldn't delete",
      !result.ok,
    );
    setSelected([]);
    load();
    onChanged();
  };

  const runPrune = async () => {
    setBusy(true);
    const result = await window.electron.docker.pruneVolumes(pruneNamed);
    setBusy(false);
    setConfirm(null);
    onMessage(
      result.ok
        ? `Unused volumes removed${result.reclaimed ? ` - freed ${result.reclaimed}` : ''}`
        : result.error || 'Prune failed',
      !result.ok,
    );
    load();
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        flex: 1,
        minHeight: 0,
      }}
    >
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
      >
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={unusedOnly}
              onChange={(e) => setUnusedOnly(e.target.checked)}
            />
          }
          label={
            <Typography variant="body2">
              Unused only ({unused.length})
            </Typography>
          }
        />
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1, alignItems: 'center' }}>
          {!withSizes && (
            <Tooltip title="Docker has to measure every volume - can take a few seconds">
              <Button
                size="small"
                startIcon={<StraightenIcon />}
                onClick={() => {
                  setWithSizes(true);
                }}
              >
                Show sizes
              </Button>
            </Tooltip>
          )}
          {sizesLoading && <CircularProgress size={16} />}
          {selected.length > 0 && (
            <Button
              size="small"
              color="error"
              startIcon={<DeleteOutlineIcon />}
              onClick={() => setConfirm({ kind: 'delete', names: selected })}
            >
              Delete {selected.length}
            </Button>
          )}
          <Tooltip title="Delete volumes no container uses (stopped containers count as users)">
            <span>
              <Button
                size="small"
                color="inherit"
                startIcon={<CleaningServicesOutlinedIcon />}
                disabled={!unused.length}
                onClick={() => setConfirm({ kind: 'prune' })}
              >
                Clean unused
              </Button>
            </span>
          </Tooltip>
        </Box>
      </Box>

      <Paper
        variant="outlined"
        sx={{ borderRadius: 3, flex: 1, minHeight: 0, overflow: 'auto' }}
      >
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
            <CircularProgress size={22} />
          </Box>
        )}
        {error && (
          <Typography variant="body2" color="error" sx={{ p: 2 }}>
            {error}
          </Typography>
        )}
        {!loading && !error && !shown.length && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ p: 3, textAlign: 'center' }}
          >
            {volumes.length ? 'No volumes match.' : 'No volumes.'}
          </Typography>
        )}
        {shown.map((v) => {
          const inUse = v.usedBy.length > 0;
          return (
            <Box
              key={v.name}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1,
                py: 0.5,
                borderBottom: 1,
                borderColor: 'divider',
                '&:last-of-type': { borderBottom: 0 },
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Checkbox
                size="small"
                disabled={inUse}
                checked={selected.includes(v.name)}
                onChange={(e) =>
                  setSelected((list) =>
                    e.target.checked
                      ? [...list, v.name]
                      : list.filter((n) => n !== v.name),
                  )
                }
                inputProps={{ 'aria-label': `Select ${v.name}` }}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Typography
                    variant="body2"
                    noWrap
                    title={v.name}
                    sx={{
                      fontFamily: MONO_FONT,
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {shortName(v)}
                  </Typography>
                  {v.anonymous && (
                    <Chip
                      size="small"
                      label="anonymous"
                      sx={{ height: 18, fontSize: 10 }}
                    />
                  )}
                  {v.project && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={v.project}
                      sx={{ height: 18, fontSize: 10 }}
                    />
                  )}
                </Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  component="div"
                >
                  {inUse
                    ? `used by ${v.usedBy.join(', ')}`
                    : 'not used by any container'}
                </Typography>
              </Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ minWidth: 60, textAlign: 'right', fontFamily: MONO_FONT }}
              >
                {v.size || (withSizes && !sizesLoading ? '?' : '')}
              </Typography>
              <Tooltip
                title={
                  inUse
                    ? 'In use - remove the container first'
                    : 'Delete volume'
                }
              >
                <span>
                  <IconButton
                    size="small"
                    disabled={inUse}
                    onClick={() =>
                      setConfirm({ kind: 'delete', names: [v.name] })
                    }
                    aria-label={`Delete volume ${v.name}`}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          );
        })}
      </Paper>

      <ConfirmDialog
        open={confirm?.kind === 'delete'}
        title={`Delete ${confirm?.kind === 'delete' && confirm.names.length > 1 ? `${confirm.names.length} volumes` : 'volume'}?`}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={() => confirm?.kind === 'delete' && runDelete(confirm.names)}
        onClose={() => setConfirm(null)}
      >
        <Typography variant="body2" color="text.secondary">
          The data inside is deleted for good.
        </Typography>
        <Box sx={{ mt: 1, maxHeight: 160, overflow: 'auto' }}>
          {confirm?.kind === 'delete' &&
            confirm.names.map((n) => (
              <Typography
                key={n}
                variant="body2"
                sx={{ fontFamily: MONO_FONT, fontSize: 12 }}
                noWrap
              >
                {n}
              </Typography>
            ))}
        </Box>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm?.kind === 'prune'}
        title="Clean unused volumes?"
        confirmLabel="Clean"
        busy={busy}
        onConfirm={runPrune}
        onClose={() => setConfirm(null)}
      >
        <Typography variant="body2" color="text.secondary">
          Deletes the volumes no container (running or stopped) uses. Their data
          is gone for good.
        </Typography>
        <FormControlLabel
          sx={{ mt: 1 }}
          control={
            <Checkbox
              size="small"
              color="error"
              checked={pruneNamed}
              onChange={(e) => setPruneNamed(e.target.checked)}
            />
          }
          label={
            <Typography variant="body2">
              Named volumes too ({unused.filter((v) => !v.anonymous).length}) -
              otherwise only anonymous ones (
              {unused.filter((v) => v.anonymous).length})
            </Typography>
          }
        />
      </ConfirmDialog>
    </Box>
  );
}
