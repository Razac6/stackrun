import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  IconButton,
  InputAdornment,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Select,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import LinkIcon from '@mui/icons-material/Link';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import CheckIcon from '@mui/icons-material/Check';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CleaningServicesOutlinedIcon from '@mui/icons-material/CleaningServicesOutlined';
import CodeArea from './CodeArea';
import { MONO_FONT } from './highlight';
import BottomToast from './BottomToast';
import useCopy from './useCopy';
import { RemoveContainerDialog, VolumesView } from './DockerVolumes';
import DockerfileDialog from './DockerfileDialog';
import ComposeDialog from './ComposeDialog';
import ResetDbDialog from './ResetDbDialog';
import type { DockerStatus } from '../../../main/docker';
import { RESETTABLE } from '../../../main/dockerTools';
import type {
  ConnectionString,
  DockerContainer,
} from '../../../main/dockerTools';

// Docker containers (Docker Desktop, Colima, OrbStack - whatever the docker CLI talks to):
// search, filter running / stopped / databases, start / stop / restart, logs, ports and
// ready-to-paste connection strings for database containers.

type StateFilter = 'running' | 'stopped' | 'all';
const POLL_MS = 5000;
const STORE_KEY = 'docker_tool_filters';

const isUp = (c: DockerContainer) =>
  c.state === 'running' || c.state === 'restarting' || c.state === 'paused';

type View = 'containers' | 'volumes';

const loadFilters = (): {
  state: StateFilter;
  dbOnly: boolean;
  view: View;
} => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return {
      state: ['running', 'stopped', 'all'].includes(saved.state)
        ? saved.state
        : 'all',
      dbOnly: !!saved.dbOnly,
      view: saved.view === 'volumes' ? 'volumes' : 'containers',
    };
  } catch (e) {
    return { state: 'all', dbOnly: false, view: 'containers' };
  }
};

/** Filtering + sorting (running first, then by name) - exported for tests. */
export const filterContainers = (
  containers: DockerContainer[],
  {
    query,
    state,
    dbOnly,
    project,
  }: { query: string; state: StateFilter; dbOnly: boolean; project: string },
) => {
  const q = query.trim().toLowerCase();
  return containers
    .filter((c) =>
      state === 'all' ? true : state === 'running' ? isUp(c) : !isUp(c),
    )
    .filter((c) => !dbOnly || !!c.db)
    .filter((c) => !project || (c.project || '') === project)
    .filter(
      (c) =>
        !q ||
        [
          c.name,
          c.image,
          c.project || '',
          c.db || '',
          c.id,
          ...c.ports.map((p) => String(p.hostPort)),
        ]
          .join(' ')
          .toLowerCase()
          .includes(q),
    )
    .sort(
      (a, b) =>
        Number(isUp(b)) - Number(isUp(a)) || a.name.localeCompare(b.name),
    );
};

function StateDot({ state }: { state: string }) {
  const theme = useTheme();
  const color =
    state === 'running'
      ? theme.palette.success.main
      : state === 'paused' || state === 'restarting'
        ? theme.palette.warning.main
        : state === 'dead'
          ? theme.palette.error.main
          : theme.palette.text.disabled;
  return (
    <Box
      title={state}
      sx={{
        width: 9,
        height: 9,
        borderRadius: '50%',
        flexShrink: 0,
        bgcolor: color,
        boxShadow:
          state === 'running' ? `0 0 0 3px ${alpha(color, 0.2)}` : 'none',
      }}
    />
  );
}

function LogsDialog({
  container,
  onClose,
}: {
  container: DockerContainer | null;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [tail, setTail] = useState(300);
  const [follow, setFollow] = useState(true);
  const [loading, setLoading] = useState(false);
  const { copy, copied } = useCopy();

  const load = useCallback(async () => {
    if (!container) return;
    setLoading(true);
    const result = await window.electron.docker.logs(container.id, tail);
    setText(result.ok ? result.text || '(no output)' : `Error: ${result.text}`);
    setLoading(false);
  }, [container, tail]);

  useEffect(() => {
    if (!container) {
      setText('');
      return undefined;
    }
    load();
    if (!follow || container.state !== 'running') return undefined;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [container, follow, load]);

  return (
    <Dialog
      open={!!container}
      onClose={onClose}
      fullWidth
      maxWidth="xl"
      PaperProps={{
        sx: {
          height: '88vh',
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
          {container?.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          logs · Ctrl/⌘+F to search
        </Typography>
        {loading && <CircularProgress size={14} />}
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Select
            size="small"
            value={tail}
            onChange={(e) => setTail(Number(e.target.value))}
            sx={{ fontSize: 13, '& .MuiSelect-select': { py: 0.5 } }}
          >
            {[100, 300, 1000, 5000].map((n) => (
              <MenuItem key={n} value={n}>
                Last {n}
              </MenuItem>
            ))}
          </Select>
          <ToggleButton
            size="small"
            value="follow"
            selected={follow}
            disabled={container?.state !== 'running'}
            onChange={() => setFollow((f) => !f)}
            sx={{ py: 0.25 }}
          >
            Follow
          </ToggleButton>
          <Tooltip title="Refresh">
            <IconButton size="small" onClick={load} aria-label="Refresh logs">
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={copied ? 'Copied!' : 'Copy logs'}>
            <IconButton
              size="small"
              onClick={() => copy(text)}
              aria-label="Copy logs"
            >
              {copied ? (
                <CheckIcon fontSize="small" />
              ) : (
                <ArticleOutlinedIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={onClose} aria-label="Close logs">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <CodeArea
          value={text}
          language="plain"
          readOnly
          minHeight="100%"
          ariaLabel="Container logs"
        />
      </Box>
    </Dialog>
  );
}

function ContainerRow({
  container,
  busy,
  onAction,
  onLogs,
  onConnect,
  onRemove,
  onReset,
  onCopy,
  copiedKey,
}: {
  container: DockerContainer;
  busy: boolean;
  onAction: (
    ids: string[],
    action: 'start' | 'stop' | 'restart' | 'unpause',
  ) => void;
  onLogs: () => void;
  onConnect: (anchor: HTMLElement) => void;
  onRemove: () => void;
  onReset: () => void;
  onCopy: (text: string, key: string) => void;
  copiedKey: string | null;
}) {
  const up = isUp(container);
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1.3fr) minmax(0, 1fr) auto auto',
        alignItems: 'center',
        gap: 1.5,
        px: 1.5,
        py: 0.75,
        borderBottom: 1,
        borderColor: 'divider',
        '&:last-of-type': { borderBottom: 0 },
        '&:hover': { bgcolor: 'action.hover' },
        opacity: up ? 1 : 0.75,
      }}
    >
      <StateDot state={container.state} />
      <Box sx={{ minWidth: 0 }}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}
        >
          <Typography
            variant="body2"
            sx={{ fontWeight: 600 }}
            noWrap
            title={container.name}
          >
            {container.name}
          </Typography>
          {container.db && (
            <Chip
              size="small"
              icon={
                <StorageOutlinedIcon sx={{ fontSize: '14px !important' }} />
              }
              label={container.db}
              sx={{ height: 20, fontSize: 11 }}
            />
          )}
        </Box>
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          component="div"
          title={container.image}
          sx={{ fontFamily: MONO_FONT, fontSize: 11 }}
        >
          {container.image}
        </Typography>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          component="div"
          title={container.status}
        >
          {container.status}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.25 }}>
          {container.ports.slice(0, 4).map((p) => {
            const key = `${container.id}:${p.hostPort}`;
            return (
              <Tooltip key={key} title={`Copy localhost:${p.hostPort}`}>
                <Chip
                  size="small"
                  variant="outlined"
                  label={
                    copiedKey === key
                      ? 'Copied'
                      : p.hostPort === p.containerPort
                        ? `:${p.hostPort}`
                        : `:${p.hostPort} → ${p.containerPort}`
                  }
                  onClick={() => onCopy(`localhost:${p.hostPort}`, key)}
                  sx={{ height: 18, fontSize: 11, fontFamily: MONO_FONT }}
                />
              </Tooltip>
            );
          })}
          {container.ports.length > 4 && (
            <Typography variant="caption" color="text.secondary">
              +{container.ports.length - 4}
            </Typography>
          )}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        {container.db && (
          <Tooltip title={up ? 'Connection strings' : 'Start it to connect'}>
            <span>
              <IconButton
                size="small"
                disabled={!container.ports.length}
                onClick={(e) => onConnect(e.currentTarget)}
                aria-label={`Connection strings for ${container.name}`}
              >
                <LinkIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {container.db && RESETTABLE.includes(container.db) && (
          <Tooltip title="Reset database (empty it, e.g. before flyway migrate)">
            <IconButton
              size="small"
              onClick={onReset}
              aria-label={`Reset database in ${container.name}`}
            >
              <CleaningServicesOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Remove container">
          <span>
            <IconButton
              size="small"
              disabled={busy}
              onClick={onRemove}
              aria-label={`Remove ${container.name}`}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Logs">
          <IconButton
            size="small"
            onClick={onLogs}
            aria-label={`Logs of ${container.name}`}
          >
            <ArticleOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {up && (
          <Tooltip title="Restart">
            <span>
              <IconButton
                size="small"
                disabled={busy}
                onClick={() => onAction([container.id], 'restart')}
                aria-label={`Restart ${container.name}`}
              >
                <RestartAltIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Box>
      <Box sx={{ width: 34, display: 'flex', justifyContent: 'center' }}>
        {busy ? (
          <CircularProgress size={18} />
        ) : (
          <Tooltip title={up ? 'Stop' : 'Start'}>
            <IconButton
              size="small"
              color={up ? 'default' : 'success'}
              onClick={() =>
                onAction(
                  [container.id],
                  container.state === 'paused'
                    ? 'unpause'
                    : up
                      ? 'stop'
                      : 'start',
                )
              }
              aria-label={`${up ? 'Stop' : 'Start'} ${container.name}`}
            >
              {up ? (
                <StopIcon fontSize="small" />
              ) : (
                <PlayArrowIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
}

export default function DockerTool() {
  const [status, setStatus] = useState<DockerStatus | null>(null);
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(loadFilters);
  const [project, setProject] = useState('');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [logsFor, setLogsFor] = useState<DockerContainer | null>(null);
  const [connect, setConnect] = useState<{
    anchor: HTMLElement;
    container: DockerContainer;
    strings: ConnectionString[] | null;
  } | null>(null);
  const [colimaStarting, setColimaStarting] = useState(false);
  const [removing, setRemoving] = useState<DockerContainer | null>(null);
  const [resetting, setResetting] = useState<DockerContainer | null>(null);
  const [volumesKey, setVolumesKey] = useState(0);
  const [fromDockerfile, setFromDockerfile] = useState(false);
  const [fromCompose, setFromCompose] = useState(false);
  const { copy, copied } = useCopy();
  const engineUp = useRef(false);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(filters));
  }, [filters]);

  const flash = (text: string, error = false) => {
    setMessage({ text, error });
    setTimeout(
      () => setMessage((m) => (m?.text === text ? null : m)),
      error ? 8000 : 3000,
    );
  };

  const refreshList = useCallback(async () => {
    const result = await window.electron.docker.list();
    setContainers(result.containers);
    setListError(result.error);
    return !result.error;
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    const s = await window.electron.docker.status();
    setStatus(s);
    engineUp.current = s.engine;
    if (s.engine) await refreshList();
    else setContainers([]);
    setLoading(false);
  }, [refreshList]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Poll while the tool is open and the window visible (states change from the CLI too)
  useEffect(() => {
    const timer = setInterval(async () => {
      if (document.hidden) return;
      if (engineUp.current) {
        const ok = await refreshList();
        if (!ok) refreshAll();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refreshList, refreshAll]);

  const runAction = async (
    ids: string[],
    action: 'start' | 'stop' | 'restart' | 'unpause',
  ) => {
    setBusy((b) => new Set([...b, ...ids]));
    const result = await window.electron.docker.action(ids, action);
    await refreshList();
    setBusy((b) => {
      const next = new Set(b);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    if (!result.ok) flash(result.error || `Couldn't ${action}`, true);
  };

  const startColima = async () => {
    setColimaStarting(true);
    const result = await window.electron.docker.startColima();
    setColimaStarting(false);
    if (!result.ok) flash(result.error || "Colima didn't start", true);
    refreshAll();
  };

  const openConnect = async (
    anchor: HTMLElement,
    container: DockerContainer,
  ) => {
    setConnect({ anchor, container, strings: null });
    const strings = await window.electron.docker.connections(container.id);
    setConnect((c) =>
      c && c.container.id === container.id ? { ...c, strings } : c,
    );
  };

  const projects = useMemo(
    () =>
      [
        ...new Set(containers.map((c) => c.project).filter(Boolean)),
      ].sort() as string[],
    [containers],
  );
  useEffect(() => {
    if (project && !projects.includes(project)) setProject('');
  }, [project, projects]);

  const counts = useMemo(() => {
    const base = filters.dbOnly ? containers.filter((c) => c.db) : containers;
    const running = base.filter(isUp).length;
    return { running, stopped: base.length - running, all: base.length };
  }, [containers, filters.dbOnly]);

  const shown = useMemo(
    () => filterContainers(containers, { query, project, ...filters }),
    [containers, query, project, filters],
  );
  const shownStopped = shown.filter((c) => !isUp(c));
  const shownRunning = shown.filter(isUp);

  // --- engine not available --------------------------------------------------------
  const renderUnavailable = () => {
    if (!status) return null;
    let title = 'Docker engine is not running';
    let hint = status.error || '';
    if (!status.cli) {
      title = 'Docker CLI not found';
      hint = 'Install Docker Desktop, or on macOS: brew install colima docker';
    } else if (status.colima && !status.colimaRunning) {
      title = 'Colima is stopped';
      hint = 'Start it to use your containers (takes ~20-60 s).';
    }
    return (
      <Paper
        variant="outlined"
        sx={{
          p: 3,
          borderRadius: 3,
          textAlign: 'center',
          maxWidth: 520,
          mx: 'auto',
          mt: 4,
        }}
      >
        <StorageOutlinedIcon sx={{ fontSize: 36, color: 'text.disabled' }} />
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mt: 1 }}>
          {title}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 0.5, wordBreak: 'break-word' }}
        >
          {hint}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', mt: 2 }}>
          {status.colima && !status.colimaRunning && (
            <Button
              variant="contained"
              size="small"
              disableElevation
              onClick={startColima}
              disabled={colimaStarting}
              startIcon={
                colimaStarting ? (
                  <CircularProgress size={14} color="inherit" />
                ) : (
                  <PlayArrowIcon />
                )
              }
            >
              {colimaStarting ? 'Starting Colima…' : 'Start Colima'}
            </Button>
          )}
          <Button
            size="small"
            onClick={refreshAll}
            disabled={loading || colimaStarting}
          >
            Retry
          </Button>
        </Box>
      </Paper>
    );
  };

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        minHeight: 0,
      }}
    >
      {/* Filters */}
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
      >
        <ToggleButtonGroup
          size="small"
          exclusive
          value={filters.view}
          onChange={(_, v) => v && setFilters((f) => ({ ...f, view: v }))}
          aria-label="docker view"
        >
          <ToggleButton value="containers">Containers</ToggleButton>
          <ToggleButton value="volumes">Volumes</ToggleButton>
        </ToggleButtonGroup>
        <TextField
          size="small"
          placeholder={
            filters.view === 'volumes'
              ? 'Search volume, project, container…'
              : 'Search name, image, port…'
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ width: 260 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: query ? (
              <IconButton
                size="small"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            ) : undefined,
          }}
        />
        {filters.view === 'containers' && (
          <>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={filters.state}
              onChange={(_, v) => v && setFilters((f) => ({ ...f, state: v }))}
              aria-label="container state"
            >
              <ToggleButton value="running">
                Running {counts.running}
              </ToggleButton>
              <ToggleButton value="stopped">
                Stopped {counts.stopped}
              </ToggleButton>
              <ToggleButton value="all">All {counts.all}</ToggleButton>
            </ToggleButtonGroup>
            <ToggleButton
              size="small"
              value="db"
              selected={filters.dbOnly}
              onChange={() => setFilters((f) => ({ ...f, dbOnly: !f.dbOnly }))}
              aria-label="Databases only"
            >
              <StorageOutlinedIcon fontSize="small" sx={{ mr: 0.75 }} />{' '}
              Databases
            </ToggleButton>
            {projects.length > 0 && (
              <Select
                size="small"
                displayEmpty
                value={project}
                onChange={(e) => setProject(String(e.target.value))}
                sx={{
                  fontSize: 13,
                  minWidth: 140,
                  '& .MuiSelect-select': { py: 0.75 },
                }}
                aria-label="Compose project"
              >
                <MenuItem value="">All projects</MenuItem>
                {projects.map((p) => (
                  <MenuItem key={p} value={p}>
                    {p}
                  </MenuItem>
                ))}
              </Select>
            )}
          </>
        )}
        <ComposeDialog
          open={fromCompose}
          onClose={() => setFromCompose(false)}
          onStarted={(text) => {
            flash(text);
            refreshAll();
          }}
        />
        <DockerfileDialog
          open={fromDockerfile}
          onClose={() => setFromDockerfile(false)}
          onStarted={(name) => {
            flash(`${name} is running`);
            refreshAll();
          }}
        />
        <BottomToast
          text={message?.text || null}
          error={message?.error}
          onClose={() => setMessage(null)}
        />
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
          {status?.engine && (
            <Typography variant="caption" color="text.secondary" noWrap>
              {status.context || 'docker'} · {status.version}
            </Typography>
          )}
          {status?.engine &&
            filters.view === 'containers' &&
            shown.length > 1 && (
              <>
                {shownStopped.length > 0 && (
                  <Tooltip
                    title={`Start the ${shownStopped.length} shown stopped container(s)`}
                  >
                    <Button
                      size="small"
                      startIcon={<PlayArrowIcon />}
                      onClick={() =>
                        runAction(
                          shownStopped.map((c) => c.id),
                          'start',
                        )
                      }
                    >
                      Start {shownStopped.length}
                    </Button>
                  </Tooltip>
                )}
                {shownRunning.length > 0 && (
                  <Tooltip
                    title={`Stop the ${shownRunning.length} shown running container(s)`}
                  >
                    <Button
                      size="small"
                      color="inherit"
                      startIcon={<StopIcon />}
                      onClick={() =>
                        runAction(
                          shownRunning.map((c) => c.id),
                          'stop',
                        )
                      }
                    >
                      Stop {shownRunning.length}
                    </Button>
                  </Tooltip>
                )}
              </>
            )}
          <Tooltip title="Pick a docker compose file: docker compose up -d in its folder">
            <Button
              size="small"
              variant="contained"
              onClick={() => setFromCompose(true)}
            >
              Compose up
            </Button>
          </Tooltip>
          <Tooltip title="Build an image from a Dockerfile and start a container of it">
            <Button
              size="small"
              variant="outlined"
              onClick={() => setFromDockerfile(true)}
            >
              From Dockerfile
            </Button>
          </Tooltip>
          <Tooltip title="Refresh">
            <span>
              <IconButton
                size="small"
                onClick={() => {
                  refreshAll();
                  setVolumesKey((k) => k + 1);
                }}
                disabled={loading}
                aria-label="Refresh containers"
              >
                {loading ? (
                  <CircularProgress size={16} />
                ) : (
                  <RefreshIcon fontSize="small" />
                )}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {status && !status.engine && renderUnavailable()}
      {!status && loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {status?.engine && filters.view === 'volumes' && (
        <VolumesView
          query={query}
          refreshKey={volumesKey}
          onMessage={flash}
          onChanged={refreshList}
        />
      )}

      {status?.engine && filters.view === 'containers' && (
        <Paper
          variant="outlined"
          sx={{ borderRadius: 3, flex: 1, minHeight: 0, overflow: 'auto' }}
        >
          {listError && (
            <Typography variant="body2" color="error" sx={{ p: 2 }}>
              {listError}
            </Typography>
          )}
          {!listError && shown.length === 0 && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ p: 3, textAlign: 'center' }}
            >
              {containers.length
                ? 'No containers match the filters.'
                : 'No containers yet.'}
            </Typography>
          )}
          {shown.map((c) => (
            <ContainerRow
              key={c.id}
              container={c}
              busy={busy.has(c.id)}
              onAction={runAction}
              onLogs={() => setLogsFor(c)}
              onConnect={(anchor) => openConnect(anchor, c)}
              onRemove={() => setRemoving(c)}
              onReset={() => setResetting(c)}
              onCopy={copy}
              copiedKey={copied}
            />
          ))}
        </Paper>
      )}

      <Menu
        anchorEl={connect?.anchor}
        open={!!connect}
        onClose={() => setConnect(null)}
        PaperProps={{ sx: { maxWidth: 560 } }}
      >
        {connect && !connect.strings && (
          <MenuItem disabled>
            <CircularProgress size={14} sx={{ mr: 1 }} /> Reading container env…
          </MenuItem>
        )}
        {connect?.strings?.length === 0 && (
          <MenuItem disabled>No published port to connect to</MenuItem>
        )}
        {connect?.strings?.map((s) => (
          <MenuItem
            key={s.label}
            onClick={() => {
              copy(s.value, `conn:${s.label}`);
              flash(`${s.label} copied`);
              setConnect(null);
            }}
          >
            <ListItemText
              primary={s.label}
              secondary={s.value}
              secondaryTypographyProps={{
                sx: {
                  fontFamily: MONO_FONT,
                  fontSize: 12,
                  wordBreak: 'break-all',
                  whiteSpace: 'normal',
                },
              }}
            />
          </MenuItem>
        ))}
      </Menu>

      <LogsDialog container={logsFor} onClose={() => setLogsFor(null)} />
      <ResetDbDialog
        container={resetting}
        onClose={() => setResetting(null)}
        onDone={(ok, text) => {
          if (ok) setResetting(null);
          flash(text, !ok);
        }}
      />
      <RemoveContainerDialog
        container={removing}
        onClose={() => setRemoving(null)}
        onDone={(ok, text) => {
          setRemoving(null);
          flash(text, !ok);
          refreshList();
          setVolumesKey((k) => k + 1);
        }}
      />
    </Box>
  );
}
