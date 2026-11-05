// HTTP Client, in the spirit of WebStorm's: collections of requests that run one after
// another (with a delay before a request if you want), {{variables}} from environments and
// constants, auth, values captured from a response into a variable for the next request,
// and .http / http-client.env.json import and export.
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import SendIcon from '@mui/icons-material/Send';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TuneIcon from '@mui/icons-material/Tune';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import TerminalIcon from '@mui/icons-material/Terminal';
import ScheduleIcon from '@mui/icons-material/Schedule';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import type { HttpResult } from '../../../main/httpClient';
import {
  Auth,
  AuthType,
  BodyType,
  buildRequest,
  Capture,
  collectionToHttp,
  environmentsFromJson,
  environmentsToJson,
  findRequest,
  HttpCollection,
  HttpEnvironment,
  HttpRequest,
  HttpState,
  kv,
  mergeEnvironments,
  METHODS,
  missingVariables,
  moveRequest,
  newCollection,
  newId,
  newRequest,
  parseHttpFile,
  parseState,
  removeRequest,
  duplicateRequest,
  runCaptures,
  SETTINGS_KEY,
  updateCollection,
  updateRequest,
  variablesFor,
  requestToHttp,
} from './httpModel';
import KVTable from './KVTable';
import CodeArea from '../notes/CodeArea';
import JsonFoldView from '../notes/JsonFoldView';
import BottomToast from '../notes/BottomToast';
import { MONO_FONT } from '../notes/highlight';
import { parseRequest } from '../notes/httpConvert';

const METHOD_COLORS: Record<string, string> = {
  GET: '#2e7d32',
  POST: '#ed6c02',
  PUT: '#0277bd',
  PATCH: '#6a1b9a',
  DELETE: '#c62828',
  HEAD: '#546e7a',
  OPTIONS: '#546e7a',
};
const methodColor = (m: string) => METHOD_COLORS[m] || '#546e7a';

type RunState = 'pending' | 'waiting' | 'running' | 'ok' | 'failed' | 'skipped';

interface Shown {
  result: HttpResult;
  sent: {
    method: string;
    url: string;
    headers: [string, string][];
    body?: string;
  };
  captured: Record<string, string>;
  captureFailed: string[];
  at: number;
}

const sizeText = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;

const statusColor = (r: HttpResult) => {
  if (r.error) return 'error';
  if (r.status >= 500) return 'error';
  if (r.status >= 400) return 'warning';
  return 'success';
};

const sleep = (ms: number, cancelled: () => boolean) =>
  new Promise<void>((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (cancelled() || Date.now() - start >= ms) resolve();
      else setTimeout(tick, Math.min(100, ms));
    };
    tick();
  });

function RunIcon({ state }: { state?: RunState }) {
  if (!state) return null;
  if (state === 'running') return <CircularProgress size={12} />;
  if (state === 'waiting')
    return <ScheduleIcon sx={{ fontSize: 14, color: 'text.secondary' }} />;
  if (state === 'ok')
    return <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main' }} />;
  if (state === 'failed')
    return <ErrorIcon sx={{ fontSize: 14, color: 'error.main' }} />;
  if (state === 'skipped')
    return (
      <RemoveCircleOutlineIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
    );
  return (
    <Box
      sx={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        bgcolor: 'text.disabled',
      }}
    />
  );
}

function AuthEditor({
  auth,
  onChange,
  allowInherit,
}: {
  auth: Auth;
  onChange: (auth: Auth) => void;
  allowInherit: boolean;
}) {
  const set = (patch: Partial<Auth>) => onChange({ ...auth, ...patch });
  const mono = { sx: { fontFamily: MONO_FONT, fontSize: 13 } };
  return (
    <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
      <Select
        size="small"
        value={auth.type}
        onChange={(e) => set({ type: e.target.value as AuthType })}
        inputProps={{ 'aria-label': 'Auth type' }}
        sx={{ width: 260 }}
      >
        {allowInherit && (
          <MenuItem value="inherit">From the collection</MenuItem>
        )}
        <MenuItem value="none">No auth</MenuItem>
        <MenuItem value="bearer">Bearer token</MenuItem>
        <MenuItem value="basic">Basic (user + password)</MenuItem>
        <MenuItem value="apikey">API key</MenuItem>
      </Select>
      {auth.type === 'bearer' && (
        <TextField
          size="small"
          label="Token"
          placeholder="{{token}}"
          value={auth.token || ''}
          onChange={(e) => set({ token: e.target.value })}
          InputProps={mono}
          helperText="Tip: capture it from a login response into {{token}}"
        />
      )}
      {auth.type === 'basic' && (
        <>
          <TextField
            size="small"
            label="User"
            value={auth.username || ''}
            onChange={(e) => set({ username: e.target.value })}
            InputProps={mono}
          />
          <TextField
            size="small"
            label="Password"
            type="password"
            value={auth.password || ''}
            onChange={(e) => set({ password: e.target.value })}
            InputProps={mono}
          />
        </>
      )}
      {auth.type === 'apikey' && (
        <>
          <TextField
            size="small"
            label="Name"
            placeholder="X-Api-Key"
            value={auth.key || ''}
            onChange={(e) => set({ key: e.target.value })}
            InputProps={mono}
          />
          <TextField
            size="small"
            label="Value"
            value={auth.value || ''}
            onChange={(e) => set({ value: e.target.value })}
            InputProps={mono}
          />
          <Select
            size="small"
            value={auth.in || 'header'}
            onChange={(e) => set({ in: e.target.value as 'header' | 'query' })}
            inputProps={{ 'aria-label': 'Send the key in' }}
            sx={{ width: 200 }}
          >
            <MenuItem value="header">In a header</MenuItem>
            <MenuItem value="query">In the query string</MenuItem>
          </Select>
        </>
      )}
      {auth.type === 'inherit' && (
        <Typography variant="body2" color="text.secondary">
          Uses the collection&apos;s auth (collection ⋯ → Settings).
        </Typography>
      )}
    </Stack>
  );
}

function CapturesEditor({
  captures,
  onChange,
}: {
  captures: Capture[];
  onChange: (c: Capture[]) => void;
}) {
  const rows = [
    ...captures,
    { variable: '', from: 'json', path: '' } as Capture,
  ];
  const set = (i: number, patch: Partial<Capture>) =>
    onChange(
      rows
        .map((c, j) => (j === i ? { ...c, ...patch } : c))
        .filter((c, j) => j < captures.length || c.variable || c.path),
    );
  const mono = { sx: { fontFamily: MONO_FONT, fontSize: 13 } };
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 130px minmax(0, 1.5fr) 34px',
        gap: 0.5,
        alignItems: 'center',
      }}
    >
      {rows.map((c, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <React.Fragment key={i}>
          <TextField
            size="small"
            placeholder="variable, e.g. token"
            value={c.variable}
            onChange={(e) => set(i, { variable: e.target.value })}
            InputProps={{ ...mono, inputProps: { 'aria-label': 'Variable' } }}
          />
          <Select
            size="small"
            value={c.from}
            onChange={(e) =>
              set(i, { from: e.target.value as Capture['from'] })
            }
            inputProps={{ 'aria-label': 'Take it from' }}
          >
            <MenuItem value="json">JSON body</MenuItem>
            <MenuItem value="header">Header</MenuItem>
            <MenuItem value="status">Status</MenuItem>
          </Select>
          <TextField
            size="small"
            disabled={c.from === 'status'}
            placeholder={
              c.from === 'header' ? 'Location' : 'data.token · items[0].id'
            }
            value={c.from === 'status' ? '' : c.path}
            onChange={(e) => set(i, { path: e.target.value })}
            InputProps={{ ...mono, inputProps: { 'aria-label': 'Path' } }}
          />
          {i < captures.length ? (
            <IconButton
              size="small"
              onClick={() => onChange(captures.filter((_, j) => j !== i))}
              aria-label={`Remove capture ${c.variable}`}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          ) : (
            <span />
          )}
        </React.Fragment>
      ))}
    </Box>
  );
}

function EnvironmentsDialog({
  open,
  state,
  onChange,
  onClose,
}: {
  open: boolean;
  state: HttpState;
  onChange: (s: HttpState) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<string>('constants');
  const env = state.environments.find((e) => e.id === tab);
  const setEnv = (id: string, patch: Partial<HttpEnvironment>) =>
    onChange({
      ...state,
      environments: state.environments.map((e) =>
        e.id === id ? { ...e, ...patch } : e,
      ),
    });
  const addEnv = () => {
    const e: HttpEnvironment = {
      id: newId('e'),
      name: `env ${state.environments.length + 1}`,
      variables: [],
    };
    onChange({
      ...state,
      environments: [...state.environments, e],
      activeEnv: state.activeEnv || e.id,
    });
    setTab(e.id);
  };
  const captured = Object.entries(state.captured);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Environments & variables</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            variant="scrollable"
            sx={{ flex: 1 }}
          >
            <Tab value="constants" label="Constants" />
            {state.environments.map((e) => (
              <Tab key={e.id} value={e.id} label={e.name} />
            ))}
            <Tab value="captured" label={`Captured (${captured.length})`} />
            <Tab value="options" label="Options" />
          </Tabs>
          <Button size="small" startIcon={<AddIcon />} onClick={addEnv}>
            Environment
          </Button>
        </Box>
        <Divider sx={{ mb: 2 }} />
        {tab === 'constants' && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              The same in every environment. Use as {'{{name}}'} in the URL,
              headers, body or auth.
            </Typography>
            <KVTable
              rows={state.constants}
              onChange={(rows) => onChange({ ...state, constants: rows })}
              secretKeys={/pass|secret|token|key/i}
            />
          </>
        )}
        {env && (
          <>
            <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
              <TextField
                size="small"
                label="Name"
                value={env.name}
                onChange={(e) => setEnv(env.id, { name: e.target.value })}
              />
              <Button
                size="small"
                disabled={state.activeEnv === env.id}
                onClick={() => onChange({ ...state, activeEnv: env.id })}
              >
                {state.activeEnv === env.id ? 'In use' : 'Use it'}
              </Button>
              <Box sx={{ flex: 1 }} />
              <Button
                size="small"
                color="error"
                startIcon={<DeleteOutlineIcon />}
                onClick={() => {
                  const rest = state.environments.filter(
                    (e) => e.id !== env.id,
                  );
                  onChange({
                    ...state,
                    environments: rest,
                    activeEnv:
                      state.activeEnv === env.id
                        ? rest[0]?.id ?? null
                        : state.activeEnv,
                  });
                  setTab('constants');
                }}
              >
                Delete
              </Button>
            </Stack>
            <KVTable
              rows={env.variables}
              onChange={(rows) => setEnv(env.id, { variables: rows })}
              secretKeys={/pass|secret|token|key/i}
            />
          </>
        )}
        {tab === 'captured' && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Set by &quot;Capture&quot; after a response; they win over the
              environment and stay until you clear them.
            </Typography>
            {captured.length === 0 && (
              <Typography variant="body2">Nothing captured yet.</Typography>
            )}
            {captured.map(([k, v]) => (
              <Box
                key={k}
                sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 0.5 }}
              >
                <Typography
                  sx={{ fontFamily: MONO_FONT, fontSize: 13, minWidth: 140 }}
                >
                  {k}
                </Typography>
                <Typography
                  noWrap
                  sx={{
                    fontFamily: MONO_FONT,
                    fontSize: 13,
                    flex: 1,
                    color: 'text.secondary',
                  }}
                  title={v}
                >
                  {v}
                </Typography>
                <IconButton
                  size="small"
                  aria-label={`Forget ${k}`}
                  onClick={() => {
                    const next = { ...state.captured };
                    delete next[k];
                    onChange({ ...state, captured: next });
                  }}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
            {captured.length > 0 && (
              <Button
                size="small"
                color="error"
                onClick={() => onChange({ ...state, captured: {} })}
              >
                Clear all
              </Button>
            )}
          </>
        )}
        {tab === 'options' && (
          <Stack spacing={1.5}>
            <TextField
              size="small"
              type="number"
              label="Time limit (s)"
              value={Math.round(state.options.timeoutMs / 1000)}
              onChange={(e) =>
                onChange({
                  ...state,
                  options: {
                    ...state.options,
                    timeoutMs: Math.max(1, Number(e.target.value) || 60) * 1000,
                  },
                })
              }
              sx={{ width: 160 }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={state.options.followRedirects}
                  onChange={(e) =>
                    onChange({
                      ...state,
                      options: {
                        ...state.options,
                        followRedirects: e.target.checked,
                      },
                    })
                  }
                />
              }
              label="Follow redirects"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={state.options.insecure}
                  onChange={(e) =>
                    onChange({
                      ...state,
                      options: { ...state.options, insecure: e.target.checked },
                    })
                  }
                />
              }
              label="Allow self-signed certificates (local HTTPS)"
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function HttpClientTool({
  openRequest = null,
}: {
  openRequest?: { id: string; at: number } | null; // picked in search
}) {
  const [state, setState] = useState<HttpState>(() => parseState(null));
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [settingsFor, setSettingsFor] = useState<string | null>(null); // collection settings
  const [tab, setTab] = useState('params');
  const [resTab, setResTab] = useState('body');
  const [responses, setResponses] = useState<Record<string, Shown>>({});
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [runStates, setRunStates] = useState<Record<string, RunState>>({});
  const [runningCollection, setRunningCollection] = useState<string | null>(
    null,
  );
  const [envOpen, setEnvOpen] = useState(false);
  const [curlOpen, setCurlOpen] = useState(false);
  const [curlText, setCurlText] = useState('');
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null,
  );
  const [menu, setMenu] = useState<{
    anchor: HTMLElement;
    kind: 'tool' | 'collection' | 'request';
    id?: string;
  } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const stopRun = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const say = (text: string, error = false) => {
    setToast({ text, error });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 3500);
  };

  useEffect(() => {
    window.electron.database
      .getAllSettings()
      .then((s) => {
        const parsed = parseState(s?.[SETTINGS_KEY]);
        setState(parsed);
        setSelected(parsed.collections[0]?.requests[0]?.id ?? null);
      })
      .finally(() => setLoaded(true));
  }, []);

  const change = useCallback((next: HttpState) => {
    setState(next);
    stateRef.current = next;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      window.electron.database.setSetting(SETTINGS_KEY, JSON.stringify(next));
    }, 400);
  }, []);

  useEffect(() => {
    if (!openRequest) return;
    setSelected(openRequest.id);
    setSettingsFor(null);
  }, [openRequest]);

  const found = findRequest(state, selected);
  const request = found?.request || null;
  const collection = found?.collection || null;
  const vars = useMemo(() => variablesFor(state), [state]);
  const missing = request ? missingVariables(request, collection, vars) : [];
  const shown = request ? responses[request.id] : undefined;
  const editReq = (patch: Partial<HttpRequest>) =>
    request && change(updateRequest(state, request.id, patch));

  // ---------------- sending ----------------
  /** Sends one request with the variables as they are now; true when it went fine. */
  const send = async (req: HttpRequest, col: HttpCollection | null) => {
    const current = stateRef.current;
    const built = buildRequest(req, col, variablesFor(current));
    setSending((m) => ({ ...m, [req.id]: true }));
    const result = await window.electron.http.send({
      id: req.id,
      method: built.method,
      url: built.url,
      headers: built.headers,
      body: built.body,
      timeoutMs: current.options.timeoutMs,
      insecure: current.options.insecure,
      followRedirects: current.options.followRedirects,
    });
    setSending((m) => ({ ...m, [req.id]: false }));
    let captured: Record<string, string> = {};
    let captureFailed: string[] = [];
    if (!result.error && req.captures.length) {
      const got = runCaptures(req.captures, result);
      captured = got.values;
      captureFailed = got.failed;
      if (Object.keys(captured).length) {
        const latest = stateRef.current;
        change({ ...latest, captured: { ...latest.captured, ...captured } });
      }
    }
    setResponses((m) => ({
      ...m,
      [req.id]: {
        result,
        sent: built,
        captured,
        captureFailed,
        at: Date.now(),
      },
    }));
    return !result.error && result.status < 400;
  };

  const sendSelected = async () => {
    if (!request) return;
    if (sending[request.id]) {
      window.electron.http.cancel(request.id);
      return;
    }
    await send(request, collection);
  };

  /** The whole collection, top to bottom, like a package of requests. */
  const runCollection = async (col: HttpCollection) => {
    if (runningCollection) return;
    stopRun.current = false;
    setRunningCollection(col.id);
    const list = col.requests;
    setRunStates((m) => ({
      ...m,
      ...Object.fromEntries(
        list.map((r) => [r.id, r.skip ? 'skipped' : 'pending']),
      ),
    }));
    let failedAt: string | null = null;
    // eslint-disable-next-line no-restricted-syntax
    for (const r of list) {
      if (stopRun.current) break;
      // eslint-disable-next-line no-continue
      if (r.skip) continue;
      // always the newest version of the request (it may have been edited meanwhile)
      const now = findRequest(stateRef.current, r.id);
      const latest = now?.request || r;
      if (latest.delayMs > 0) {
        setRunStates((m) => ({ ...m, [r.id]: 'waiting' }));
        // eslint-disable-next-line no-await-in-loop
        await sleep(latest.delayMs, () => stopRun.current);
        if (stopRun.current) break;
      }
      setRunStates((m) => ({ ...m, [r.id]: 'running' }));
      setSelected(r.id);
      // eslint-disable-next-line no-await-in-loop
      const ok = await send(latest, now?.collection || col);
      setRunStates((m) => ({ ...m, [r.id]: ok ? 'ok' : 'failed' }));
      if (!ok) {
        failedAt = failedAt || latest.name;
        if (col.stopOnError) break;
      }
    }
    setRunStates((m) =>
      Object.fromEntries(
        Object.entries(m).map(([k, v]) => [
          k,
          v === 'pending' || v === 'waiting' ? 'skipped' : v,
        ]),
      ),
    );
    setRunningCollection(null);
    if (stopRun.current) say(`${col.name}: stopped`);
    else if (failedAt) say(`${col.name}: failed at "${failedAt}"`, true);
    else say(`${col.name}: all requests passed`);
  };

  const stopCollection = () => {
    stopRun.current = true;
    Object.entries(sending).forEach(([id, on]) => {
      if (on) window.electron.http.cancel(id);
    });
  };

  // ---------------- adding / import / export ----------------
  const addCollection = () => {
    const c = newCollection({
      name: `Collection ${state.collections.length + 1}`,
    });
    change({ ...state, collections: [...state.collections, c] });
    setRenaming(c.id);
  };

  const addRequest = (colId: string, partial: Partial<HttpRequest> = {}) => {
    const current = stateRef.current;
    let target = current;
    let id = colId;
    if (!current.collections.some((c) => c.id === colId)) {
      const c = newCollection({ name: 'Requests' });
      target = { ...current, collections: [...current.collections, c] };
      id = c.id;
    }
    const r = newRequest({ url: '{{host}}/', ...partial });
    const col = target.collections.find((c) => c.id === id)!;
    change(
      updateCollection(target, id, {
        requests: [...col.requests, r],
        collapsed: false,
      }),
    );
    setSelected(r.id);
    setSettingsFor(null);
    return r;
  };

  const importHttp = async () => {
    const files = await window.electron.files.openText('Import .http files', [
      'http',
      'rest',
    ]);
    if (!files.length) return;
    let next = stateRef.current;
    let count = 0;
    files.forEach((f) => {
      const requests = parseHttpFile(f.text);
      count += requests.length;
      next = {
        ...next,
        collections: [
          ...next.collections,
          newCollection({
            name: f.fileName.replace(/\.(http|rest)$/i, ''),
            requests,
          }),
        ],
      };
    });
    change(next);
    say(`Imported ${count} request${count === 1 ? '' : 's'}`);
  };

  const importEnvironments = async () => {
    const files = await window.electron.files.openText(
      'Import http-client.env.json',
      ['json'],
    );
    if (!files.length) return;
    try {
      let envs = stateRef.current.environments;
      files.forEach((f) => {
        envs = mergeEnvironments(envs, environmentsFromJson(f.text));
      });
      change({
        ...stateRef.current,
        environments: envs,
        activeEnv: stateRef.current.activeEnv || envs[0]?.id || null,
      });
      say(`${envs.length} environment${envs.length === 1 ? '' : 's'}`);
    } catch (e: any) {
      say(`Not an environment file: ${e?.message || e}`, true);
    }
  };

  const importBackup = async () => {
    const files = await window.electron.files.openText(
      'Import a Stackrun HTTP backup',
      ['json'],
    );
    if (!files.length) return;
    try {
      const raw = JSON.parse(files[0].text);
      if (!raw || !Array.isArray(raw.collections))
        throw new Error('no collections');
      const incoming = parseState(raw);
      const current = stateRef.current;
      change({
        ...current,
        collections: [...current.collections, ...incoming.collections],
        environments: mergeEnvironments(
          current.environments,
          incoming.environments,
        ),
        constants: [
          ...current.constants,
          ...incoming.constants.filter(
            (c) => !current.constants.some((x) => x.key === c.key),
          ),
        ],
      });
      say(`Imported ${incoming.collections.length} collection(s)`);
    } catch (e: any) {
      say(`Not a Stackrun backup: ${e?.message || e}`, true);
    }
  };

  const importCurl = () => {
    try {
      const parsed = parseRequest(curlText);
      const body = parsed.body || '';
      const ctype =
        parsed.headers.find(([k]) => /^content-type$/i.test(k))?.[1] || '';
      let bodyType: BodyType = 'none';
      if (body)
        bodyType =
          /json/i.test(ctype) || /^\s*[{[]/.test(body) ? 'json' : 'text';
      const url = new URL(parsed.url);
      addRequest(collection?.id || state.collections[0]?.id || '', {
        name: `${parsed.method} ${url.pathname}`.slice(0, 60),
        method: parsed.method,
        url: `${url.origin}${url.pathname}`,
        params: [...url.searchParams.entries()].map(([k, v]) => kv(k, v)),
        headers: parsed.headers.map(([k, v]) => kv(k, v)),
        body: { type: bodyType, text: body, form: [] },
      });
      setCurlOpen(false);
      setCurlText('');
    } catch (e: any) {
      say(`Could not read it: ${e?.message || e}`, true);
    }
  };

  const exportCollection = async (col: HttpCollection) => {
    const saved = await window.electron.files.saveText(
      `${col.name}.http`,
      collectionToHttp(col),
    );
    if (saved) say(`Saved ${saved}`);
  };

  // ---------------- menus ----------------
  const menuCollection =
    menu?.kind === 'collection'
      ? state.collections.find((c) => c.id === menu.id)
      : undefined;
  const menuRequest =
    menu?.kind === 'request' ? findRequest(state, menu.id || null) : null;
  const closeMenu = () => setMenu(null);

  if (!loaded) return null;

  // ---------------- left: collections ----------------
  const env = state.environments.find((e) => e.id === state.activeEnv);
  const list = (
    <Paper
      sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, p: 1 }}
    >
      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mb: 1 }}>
        <Select
          size="small"
          value={state.activeEnv || ''}
          displayEmpty
          onChange={(e) =>
            change({ ...state, activeEnv: e.target.value || null })
          }
          inputProps={{ 'aria-label': 'Environment' }}
          sx={{ flex: 1, fontSize: 13 }}
        >
          <MenuItem value="">
            <em>No environment</em>
          </MenuItem>
          {state.environments.map((e) => (
            <MenuItem key={e.id} value={e.id}>
              {e.name}
            </MenuItem>
          ))}
        </Select>
        <Tooltip title="Environments, constants, captured values, options">
          <IconButton
            size="small"
            onClick={() => setEnvOpen(true)}
            aria-label="Environments"
          >
            <TuneIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Import / export">
          <IconButton
            size="small"
            onClick={(e) => setMenu({ anchor: e.currentTarget, kind: 'tool' })}
            aria-label="Import or export"
          >
            <MoreHorizIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {state.collections.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
            No requests yet. Add a collection, paste a cURL, or import a .http
            file.
          </Typography>
        )}
        {state.collections.map((col) => {
          const running = runningCollection === col.id;
          return (
            <Box
              key={col.id}
              sx={{ mb: 0.5 }}
              onDragOver={(e) => {
                if (dragId) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) change(moveRequest(state, dragId, col.id, null));
                setDragId(null);
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.25,
                  borderRadius: 1,
                  bgcolor:
                    settingsFor === col.id ? 'action.selected' : undefined,
                  '&:hover .col-actions': { opacity: 1 },
                }}
              >
                <IconButton
                  size="small"
                  onClick={() =>
                    change(
                      updateCollection(state, col.id, {
                        collapsed: !col.collapsed,
                      }),
                    )
                  }
                  aria-label={
                    col.collapsed
                      ? `Expand ${col.name}`
                      : `Collapse ${col.name}`
                  }
                  sx={{ p: 0.25 }}
                >
                  {col.collapsed ? (
                    <ChevronRightIcon fontSize="small" />
                  ) : (
                    <ExpandMoreIcon fontSize="small" />
                  )}
                </IconButton>
                {renaming === col.id ? (
                  <TextField
                    size="small"
                    autoFocus
                    defaultValue={col.name}
                    onBlur={(e) => {
                      change(
                        updateCollection(state, col.id, {
                          name: e.target.value.trim() || col.name,
                        }),
                      );
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter')
                        (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    inputProps={{
                      'aria-label': 'Collection name',
                      style: { padding: '2px 6px' },
                    }}
                    sx={{ flex: 1 }}
                  />
                ) : (
                  <Typography
                    variant="subtitle2"
                    noWrap
                    sx={{ flex: 1, cursor: 'pointer', fontWeight: 600 }}
                    onDoubleClick={() => setRenaming(col.id)}
                    onClick={() =>
                      change(
                        updateCollection(state, col.id, {
                          collapsed: !col.collapsed,
                        }),
                      )
                    }
                  >
                    {col.name}
                    <Typography
                      component="span"
                      variant="caption"
                      color="text.secondary"
                      sx={{ ml: 0.75 }}
                    >
                      {col.requests.length}
                    </Typography>
                  </Typography>
                )}
                <Box
                  className="col-actions"
                  sx={{ display: 'flex', opacity: running ? 1 : 0.55 }}
                >
                  <Tooltip
                    title={running ? 'Stop the run' : 'Run all, top to bottom'}
                  >
                    <span>
                      <IconButton
                        size="small"
                        disabled={
                          !running &&
                          (!!runningCollection || !col.requests.length)
                        }
                        onClick={() =>
                          running ? stopCollection() : runCollection(col)
                        }
                        aria-label={
                          running ? `Stop ${col.name}` : `Run ${col.name}`
                        }
                        sx={{ p: 0.4 }}
                      >
                        {running ? (
                          <StopIcon fontSize="small" color="error" />
                        ) : (
                          <PlayArrowIcon fontSize="small" color="success" />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Add request">
                    <IconButton
                      size="small"
                      onClick={() => addRequest(col.id)}
                      aria-label={`Add a request to ${col.name}`}
                      sx={{ p: 0.4 }}
                    >
                      <AddIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <IconButton
                    size="small"
                    onClick={(e) =>
                      setMenu({
                        anchor: e.currentTarget,
                        kind: 'collection',
                        id: col.id,
                      })
                    }
                    aria-label={`More for ${col.name}`}
                    sx={{ p: 0.4 }}
                  >
                    <MoreHorizIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Box>
              {!col.collapsed &&
                col.requests.map((r) => (
                  <Box
                    key={r.id}
                    draggable
                    onDragStart={(e) => {
                      setDragId(r.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => setDragId(null)}
                    onDragOver={(e) => {
                      if (dragId && dragId !== r.id) {
                        e.preventDefault();
                        e.stopPropagation();
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (dragId)
                        change(moveRequest(state, dragId, col.id, r.id));
                      setDragId(null);
                    }}
                    onClick={() => {
                      setSelected(r.id);
                      setSettingsFor(null);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({
                        anchor: e.currentTarget,
                        kind: 'request',
                        id: r.id,
                      });
                    }}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.75,
                      pl: 3.5,
                      pr: 1,
                      py: 0.4,
                      borderRadius: 1,
                      cursor: 'pointer',
                      opacity: r.skip ? 0.5 : 1,
                      bgcolor:
                        selected === r.id && !settingsFor
                          ? 'action.selected'
                          : undefined,
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <Typography
                      sx={{
                        fontFamily: MONO_FONT,
                        fontSize: 11,
                        fontWeight: 700,
                        color: methodColor(r.method),
                        minWidth: 44,
                      }}
                    >
                      {r.method}
                    </Typography>
                    <Typography
                      variant="body2"
                      noWrap
                      sx={{ flex: 1 }}
                      title={r.url}
                    >
                      {r.name}
                    </Typography>
                    {r.delayMs > 0 && (
                      <Tooltip
                        title={`Waits ${r.delayMs} ms before it in a run`}
                      >
                        <Typography variant="caption" color="text.secondary">
                          ⏱
                          {r.delayMs >= 1000
                            ? `${r.delayMs / 1000}s`
                            : `${r.delayMs}ms`}
                        </Typography>
                      </Tooltip>
                    )}
                    {sending[r.id] ? (
                      <CircularProgress size={12} />
                    ) : (
                      <RunIcon state={runStates[r.id]} />
                    )}
                  </Box>
                ))}
            </Box>
          );
        })}
      </Box>
      <Box sx={{ display: 'flex', gap: 0.5, pt: 1 }}>
        <Button size="small" startIcon={<AddIcon />} onClick={addCollection}>
          Collection
        </Button>
        <Button
          size="small"
          startIcon={<TerminalIcon />}
          onClick={() => setCurlOpen(true)}
        >
          Paste cURL
        </Button>
      </Box>
    </Paper>
  );

  // ---------------- right: collection settings ----------------
  const colSettings = state.collections.find((c) => c.id === settingsFor);
  const settingsView = colSettings && (
    <Paper sx={{ p: 2, overflow: 'auto' }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        {colSettings.name} · settings
      </Typography>
      <FormControlLabel
        control={
          <Switch
            checked={colSettings.stopOnError}
            onChange={(e) =>
              change(
                updateCollection(state, colSettings.id, {
                  stopOnError: e.target.checked,
                }),
              )
            }
          />
        }
        label="Stop the run at a failed request (an error or status 400+)"
      />
      <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
        Auth for its requests (those set to &quot;From the collection&quot;)
      </Typography>
      <AuthEditor
        auth={colSettings.auth}
        allowInherit={false}
        onChange={(auth) =>
          change(updateCollection(state, colSettings.id, { auth }))
        }
      />
      <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
        Headers added to each of its requests
      </Typography>
      <KVTable
        rows={colSettings.headers}
        onChange={(headers) =>
          change(updateCollection(state, colSettings.id, { headers }))
        }
      />
    </Paper>
  );

  // ---------------- right: request + response ----------------
  const result = shown?.result;
  let parsedJson: unknown;
  let isJson = false;
  if (result && !result.error && !result.binary) {
    try {
      parsedJson = JSON.parse(result.body);
      isJson = typeof parsedJson === 'object' && parsedJson !== null;
    } catch (e) {
      isJson = false;
    }
  }
  const tabCount = (n: number) => (n ? ` (${n})` : '');
  const editor = request && (
    <Box
      sx={{
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr)',
        gap: 1.5,
        minHeight: 0,
      }}
    >
      <Paper sx={{ p: 1.5 }}>
        <TextField
          variant="standard"
          value={request.name}
          onChange={(e) => editReq({ name: e.target.value })}
          InputProps={{
            inputProps: { 'aria-label': 'Request name' },
            disableUnderline: true,
            sx: { fontWeight: 600, fontSize: 16 },
          }}
          sx={{ mb: 1 }}
          fullWidth
        />
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Select
            size="small"
            value={request.method}
            onChange={(e) => editReq({ method: e.target.value })}
            inputProps={{ 'aria-label': 'Method' }}
            sx={{
              width: 120,
              fontFamily: MONO_FONT,
              fontWeight: 700,
              color: methodColor(request.method),
            }}
          >
            {METHODS.map((m) => (
              <MenuItem
                key={m}
                value={m}
                sx={{ fontFamily: MONO_FONT, color: methodColor(m) }}
              >
                {m}
              </MenuItem>
            ))}
          </Select>
          <TextField
            size="small"
            fullWidth
            placeholder="{{host}}/api/items"
            value={request.url}
            onChange={(e) => editReq({ url: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendSelected();
            }}
            InputProps={{
              inputProps: { 'aria-label': 'URL' },
              sx: { fontFamily: MONO_FONT, fontSize: 13 },
              endAdornment: missing.length ? (
                <InputAdornment position="end">
                  <Tooltip title={`No value for: ${missing.join(', ')}`}>
                    <Chip
                      size="small"
                      color="warning"
                      label={`${missing.length} missing`}
                    />
                  </Tooltip>
                </InputAdornment>
              ) : undefined,
            }}
          />
          <Tooltip
            title={sending[request.id] ? 'Cancel' : 'Send (Ctrl/⌘ + Enter)'}
          >
            <Button
              variant="contained"
              color={sending[request.id] ? 'error' : 'primary'}
              onClick={sendSelected}
              startIcon={sending[request.id] ? <StopIcon /> : <SendIcon />}
              sx={{ minWidth: 104 }}
            >
              {sending[request.id] ? 'Cancel' : 'Send'}
            </Button>
          </Tooltip>
        </Box>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ minHeight: 36, mt: 0.5 }}
        >
          <Tab
            value="params"
            label={`Params${tabCount(request.params.length)}`}
            sx={{ minHeight: 36 }}
          />
          <Tab
            value="headers"
            label={`Headers${tabCount(request.headers.length)}`}
            sx={{ minHeight: 36 }}
          />
          <Tab
            value="body"
            label={
              request.body.type === 'none'
                ? 'Body'
                : `Body (${request.body.type})`
            }
            sx={{ minHeight: 36 }}
          />
          <Tab
            value="auth"
            label={`Auth${request.auth.type === 'inherit' ? '' : ` (${request.auth.type})`}`}
            sx={{ minHeight: 36 }}
          />
          <Tab
            value="capture"
            label={`Capture & run${tabCount(request.captures.length)}`}
            sx={{ minHeight: 36 }}
          />
        </Tabs>
        <Box sx={{ pt: 1.5, maxHeight: '32vh', overflow: 'auto' }}>
          {tab === 'params' && (
            <KVTable
              rows={request.params}
              onChange={(params) => editReq({ params })}
            />
          )}
          {tab === 'headers' && (
            <>
              <KVTable
                rows={request.headers}
                onChange={(headers) => editReq({ headers })}
              />
              {!!collection?.headers.length && (
                <Typography variant="caption" color="text.secondary">
                  + {collection.headers.length} from the collection
                </Typography>
              )}
            </>
          )}
          {tab === 'body' && (
            <>
              <Select
                size="small"
                value={request.body.type}
                onChange={(e) =>
                  editReq({
                    body: { ...request.body, type: e.target.value as BodyType },
                  })
                }
                inputProps={{ 'aria-label': 'Body type' }}
                sx={{ mb: 1, width: 220 }}
              >
                <MenuItem value="none">No body</MenuItem>
                <MenuItem value="json">JSON</MenuItem>
                <MenuItem value="form">Form (urlencoded)</MenuItem>
                <MenuItem value="text">Text</MenuItem>
                <MenuItem value="xml">XML</MenuItem>
              </Select>
              {request.body.type === 'form' && (
                <KVTable
                  rows={request.body.form}
                  onChange={(form) =>
                    editReq({ body: { ...request.body, form } })
                  }
                />
              )}
              {['json', 'text', 'xml'].includes(request.body.type) && (
                <CodeArea
                  value={request.body.text}
                  onChange={(text) =>
                    editReq({ body: { ...request.body, text } })
                  }
                  language={request.body.type === 'json' ? 'json' : 'plain'}
                  minHeight={140}
                  ariaLabel="Body"
                  placeholder={
                    request.body.type === 'json'
                      ? '{\n  "name": "{{user}}"\n}'
                      : ''
                  }
                />
              )}
            </>
          )}
          {tab === 'auth' && (
            <AuthEditor
              auth={request.auth}
              allowInherit
              onChange={(auth) => editReq({ auth })}
            />
          )}
          {tab === 'capture' && (
            <Stack spacing={2}>
              <Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1 }}
                >
                  After a response, save a value into a variable - the next
                  requests use it as <b>{'{{variable}}'}</b> (e.g. a token from
                  login).
                </Typography>
                <CapturesEditor
                  captures={request.captures}
                  onChange={(captures) => editReq({ captures })}
                />
              </Box>
              <Divider />
              <Typography variant="subtitle2">In a collection run</Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <TextField
                  size="small"
                  type="number"
                  label="Wait before it (ms)"
                  value={request.delayMs}
                  onChange={(e) =>
                    editReq({
                      delayMs: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  sx={{ width: 180 }}
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={request.skip}
                      onChange={(e) => editReq({ skip: e.target.checked })}
                    />
                  }
                  label="Skip it"
                />
              </Stack>
            </Stack>
          )}
        </Box>
      </Paper>

      <Paper
        sx={{ p: 1.5, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        {!result && (
          <Typography variant="body2" color="text.secondary" sx={{ m: 'auto' }}>
            {sending[request.id]
              ? 'Sending…'
              : 'Send it to see the response here.'}
          </Typography>
        )}
        {result && (
          <>
            <Box
              sx={{
                display: 'flex',
                gap: 1,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <Chip
                size="small"
                color={statusColor(result)}
                label={
                  result.error
                    ? 'Error'
                    : `${result.status} ${result.statusText}`
                }
              />
              <Typography variant="caption" color="text.secondary">
                {result.timeMs} ms · {sizeText(result.size)}
                {result.redirects.length
                  ? ` · ${result.redirects.length} redirect(s)`
                  : ''}
                {result.truncated ? ' · cut at 10 MB' : ''}
              </Typography>
              {Object.entries(shown!.captured).map(([k, v]) => (
                <Tooltip key={k} title={v}>
                  <Chip
                    size="small"
                    variant="outlined"
                    color="success"
                    label={`{{${k}}} saved`}
                  />
                </Tooltip>
              ))}
              {shown!.captureFailed.map((k) => (
                <Chip
                  key={k}
                  size="small"
                  variant="outlined"
                  color="warning"
                  label={`{{${k}}} not found`}
                />
              ))}
              <Box sx={{ flex: 1 }} />
              <Tooltip title="Copy the body">
                <IconButton
                  size="small"
                  onClick={() =>
                    navigator.clipboard.writeText(
                      isJson
                        ? JSON.stringify(parsedJson, null, 2)
                        : result.body,
                    )
                  }
                  aria-label="Copy the body"
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            {result.error ? (
              <Alert severity="error" sx={{ mt: 1 }}>
                {result.error}
              </Alert>
            ) : (
              <>
                <Tabs
                  value={resTab}
                  onChange={(_, v) => setResTab(v)}
                  sx={{ minHeight: 34 }}
                >
                  <Tab value="body" label="Body" sx={{ minHeight: 34 }} />
                  <Tab
                    value="headers"
                    label={`Headers (${result.headers.length})`}
                    sx={{ minHeight: 34 }}
                  />
                  <Tab value="sent" label="Sent" sx={{ minHeight: 34 }} />
                </Tabs>
                <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', pt: 1 }}>
                  {resTab === 'body' &&
                    (isJson ? (
                      <JsonFoldView value={parsedJson} />
                    ) : (
                      <CodeArea
                        value={result.body}
                        language="plain"
                        readOnly
                        minHeight={120}
                        ariaLabel="Response body"
                      />
                    ))}
                  {resTab === 'headers' &&
                    result.headers.map(([k, v], i) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <Box
                        key={i}
                        sx={{
                          display: 'flex',
                          gap: 1,
                          fontFamily: MONO_FONT,
                          fontSize: 13,
                        }}
                      >
                        <Box sx={{ fontWeight: 600, minWidth: 200 }}>{k}</Box>
                        <Box
                          sx={{
                            wordBreak: 'break-all',
                            color: 'text.secondary',
                          }}
                        >
                          {v}
                        </Box>
                      </Box>
                    ))}
                  {resTab === 'sent' && (
                    <CodeArea
                      value={[
                        `${shown!.sent.method} ${shown!.sent.url}`,
                        ...shown!.sent.headers.map(
                          ([k, v]) =>
                            `${k}: ${/^authorization$/i.test(k) ? `${v.slice(0, 12)}…` : v}`,
                        ),
                        ...(shown!.sent.body ? ['', shown!.sent.body] : []),
                      ].join('\n')}
                      language="http"
                      readOnly
                      minHeight={120}
                      ariaLabel="What was sent"
                    />
                  )}
                </Box>
              </>
            )}
          </>
        )}
      </Paper>
    </Box>
  );

  return (
    <Box
      sx={{
        height: '100%',
        display: 'grid',
        gridTemplateColumns: '300px minmax(0, 1fr)',
        gap: 1.5,
        minHeight: 0,
      }}
    >
      {list}
      {settingsView || editor || (
        <Paper
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: 3,
          }}
        >
          <Stack spacing={1} alignItems="center">
            <Typography color="text.secondary">
              Pick a request, or start one.
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => addRequest(state.collections[0]?.id || '')}
            >
              Request
            </Button>
            {env && (
              <Typography variant="caption" color="text.secondary">
                Environment: {env.name}
              </Typography>
            )}
          </Stack>
        </Paper>
      )}

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={closeMenu}>
        {menu?.kind === 'tool' && [
          <MenuItem
            key="ih"
            onClick={() => {
              closeMenu();
              importHttp();
            }}
          >
            <ListItemIcon>
              <FileUploadOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="Import .http files"
              secondary="Each file becomes a collection"
            />
          </MenuItem>,
          <MenuItem
            key="ie"
            onClick={() => {
              closeMenu();
              importEnvironments();
            }}
          >
            <ListItemIcon>
              <FileUploadOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="Import environments"
              secondary="http-client.env.json"
            />
          </MenuItem>,
          <MenuItem
            key="ib"
            onClick={() => {
              closeMenu();
              importBackup();
            }}
          >
            <ListItemIcon>
              <FileUploadOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="Import a backup"
              secondary="Stackrun HTTP .json"
            />
          </MenuItem>,
          <Divider key="d" />,
          <MenuItem
            key="ee"
            onClick={async () => {
              closeMenu();
              const saved = await window.electron.files.saveText(
                'http-client.env.json',
                environmentsToJson(state.environments),
              );
              if (saved) say(`Saved ${saved}`);
            }}
          >
            <ListItemIcon>
              <FileDownloadOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="Export environments"
              secondary="http-client.env.json for WebStorm"
            />
          </MenuItem>,
          <MenuItem
            key="eb"
            onClick={async () => {
              closeMenu();
              const rest: Partial<HttpState> = { ...state };
              delete rest.captured; // values from responses stay here
              const saved = await window.electron.files.saveText(
                'stackrun-http.json',
                JSON.stringify(rest, null, 2),
              );
              if (saved) say(`Saved ${saved}`);
            }}
          >
            <ListItemIcon>
              <FileDownloadOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="Export everything"
              secondary="Collections, environments, constants"
            />
          </MenuItem>,
        ]}
        {menuCollection && [
          <MenuItem
            key="s"
            onClick={() => {
              setSettingsFor(menuCollection.id);
              closeMenu();
            }}
          >
            <ListItemIcon>
              <TuneIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="Settings"
              secondary="Auth, headers, stop on error"
            />
          </MenuItem>,
          <MenuItem
            key="r"
            onClick={() => {
              setRenaming(menuCollection.id);
              closeMenu();
            }}
          >
            <ListItemIcon>
              <EditOutlinedIcon fontSize="small" />
            </ListItemIcon>
            Rename
          </MenuItem>,
          <MenuItem
            key="e"
            onClick={() => {
              closeMenu();
              exportCollection(menuCollection);
            }}
          >
            <ListItemIcon>
              <FileDownloadOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="Export .http"
              secondary="Opens in WebStorm"
            />
          </MenuItem>,
          <MenuItem
            key="x"
            onClick={() => {
              closeMenu();
              // eslint-disable-next-line no-alert
              if (
                !window.confirm(
                  `Delete "${menuCollection.name}" and its ${menuCollection.requests.length} request(s)?`,
                )
              )
                return;
              change({
                ...state,
                collections: state.collections.filter(
                  (c) => c.id !== menuCollection.id,
                ),
              });
              if (settingsFor === menuCollection.id) setSettingsFor(null);
            }}
            sx={{ color: 'error.main' }}
          >
            <ListItemIcon>
              <DeleteOutlineIcon fontSize="small" color="error" />
            </ListItemIcon>
            Delete
          </MenuItem>,
        ]}
        {menuRequest && [
          <MenuItem
            key="d"
            onClick={() => {
              const res = duplicateRequest(state, menuRequest.request.id);
              change(res.state);
              setSelected(res.id);
              closeMenu();
            }}
          >
            <ListItemIcon>
              <ContentCopyIcon fontSize="small" />
            </ListItemIcon>
            Duplicate
          </MenuItem>,
          <MenuItem
            key="c"
            onClick={() => {
              navigator.clipboard.writeText(
                requestToHttp(menuRequest.request, menuRequest.collection),
              );
              say('Copied as .http');
              closeMenu();
            }}
          >
            <ListItemIcon>
              <ContentCopyIcon fontSize="small" />
            </ListItemIcon>
            Copy as .http
          </MenuItem>,
          <MenuItem
            key="x"
            onClick={() => {
              change(removeRequest(state, menuRequest.request.id));
              if (selected === menuRequest.request.id) setSelected(null);
              closeMenu();
            }}
            sx={{ color: 'error.main' }}
          >
            <ListItemIcon>
              <DeleteOutlineIcon fontSize="small" color="error" />
            </ListItemIcon>
            Delete
          </MenuItem>,
        ]}
      </Menu>

      <EnvironmentsDialog
        open={envOpen}
        state={state}
        onChange={change}
        onClose={() => setEnvOpen(false)}
      />

      <Dialog
        open={curlOpen}
        onClose={() => setCurlOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Paste a cURL or fetch</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            DevTools → Network → right-click a request → Copy as cURL (bash or
            cmd) or Copy as fetch.
          </Typography>
          <CodeArea
            value={curlText}
            onChange={setCurlText}
            language="plain"
            minHeight={200}
            ariaLabel="cURL"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCurlOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!curlText.trim()}
            onClick={importCurl}
          >
            Add request
          </Button>
        </DialogActions>
      </Dialog>

      <BottomToast
        text={toast?.text || null}
        error={toast?.error}
        onClose={() => setToast(null)}
      />
    </Box>
  );
}
