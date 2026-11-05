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
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Paper,
  Select,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import ReplayIcon from '@mui/icons-material/Replay';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import AddIcon from '@mui/icons-material/Add';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import DeleteSweepOutlinedIcon from '@mui/icons-material/DeleteSweepOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import NotificationsOffOutlinedIcon from '@mui/icons-material/NotificationsOffOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import { MONO_FONT } from './highlight';
import BottomToast from './BottomToast';
import { PackageIconView, packageIconLabel } from './packageIcons';
import useCopy from './useCopy';
import {
  COMMAND_PRESETS,
  CliCommand,
  CommandGroup,
  CommandsState,
  PACKAGE_COLORS,
  PACKAGE_COLOR_HEX,
  PACKAGE_ICONS,
  SETTINGS_KEY,
  addPackageLink,
  canNest,
  commandLabel,
  duplicateGroup,
  emptyCommand,
  emptyGroup,
  expandSteps,
  moveCommand,
  moveGroup,
  packageSteps,
  packageUsers,
  parseState,
  removeCommand,
  removeGroup,
  saveCommand,
  searchCommands,
  updateGroup,
} from './commandsModel';
import type {
  RunSnapshot,
  RunStep,
  RunStepInput,
  StepStatus,
} from '../../../main/commandRunner';
import {
  DEFAULT_READY_TIMEOUT,
  ReadyType,
  describeReady,
} from '../../../main/readyCheck';
import {
  CONDITION_TYPES,
  ConditionType,
  describeCondition,
} from '../../../main/stepOptions';

// Your own CLI commands: run one, or a whole package top to bottom (drag & drop to
// reorder / move between packages). Runs keep going in the background; every step has
// its own log, failed steps show why right away and can be re-run (all, from the failed
// step, or just that one).

type DragItem = { type: 'command' | 'group'; id: string } | null;
type DropTarget =
  | { type: 'command'; groupId: string; index: number }
  | { type: 'group'; index: number }
  | null;

const ERROR_LINE = /error|fail|exception|fatal|denied|not found|✖/i;

const duration = (from: number | null, to: number | null) => {
  if (!from) return '';
  const ms = (to || Date.now()) - from;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
};

type ShownStatus = StepStatus | RunSnapshot['status'] | 'live' | null;

const SECTION_SEP = ' › ';
/** "A › B" -> ["A", "A › B"]: every nested package a step sits in, outermost first. */
const sectionLevels = (section: string | null) =>
  section
    ? section
        .split(SECTION_SEP)
        .map((_, i, all) => all.slice(0, i + 1).join(SECTION_SEP))
    : [];
const stepInSection = (step: RunStep, section: string) =>
  step.section === section ||
  !!step.section?.startsWith(`${section}${SECTION_SEP}`);

/** A background process that is up (its "ready when" passed) - no spinner. */
const stepShown = (step: RunStep): ShownStatus =>
  step.status === 'running' &&
  step.background &&
  (!step.ready || step.readyState === 'ready')
    ? 'live'
    : step.status;
/** One status for a nested package in a run, from its steps. */
const combineShown = (all: ShownStatus[]): ShownStatus => {
  const shown = all.filter((st) => st !== null); // never run: no say
  if (!shown.length) return null;
  if (shown.some((st) => st === 'running' || st === 'waiting')) {
    return 'running';
  }
  if (shown.includes('failed')) return 'failed';
  if (shown.includes('stopped')) return 'stopped';
  if (shown.every((st) => st === 'pending')) return 'pending';
  if (shown.every((st) => st === 'skipped')) return 'skipped';
  if (shown.includes('pending')) return 'running';
  if (shown.includes('live')) return 'live';
  return 'ok';
};
const sectionShown = (steps: RunStep[]): ShownStatus =>
  combineShown(steps.map(stepShown));

const STATUS_WORDS: Record<string, string> = {
  running: 'running',
  waiting: 'waiting until ready',
  live: 'up, running in the background',
  ok: 'all passed',
  failed: 'a step failed',
  stopped: 'stopped',
  skipped: 'skipped',
  pending: 'not started',
};

/** A package whose background steps are all up counts as ready. */
const runShown = (run: RunSnapshot): ShownStatus =>
  run.status === 'running' && run.readyAt ? 'live' : run.status;

function StatusIcon({
  status,
  size = 16,
}: {
  status: ShownStatus;
  size?: number;
}) {
  const sx = { fontSize: size };
  if (status === 'live') {
    return (
      <Box
        title="Ready - still running in the background"
        sx={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Box
          sx={{
            width: size * 0.55,
            height: size * 0.55,
            borderRadius: '50%',
            bgcolor: 'success.main',
            animation: 'thingyLive 2s ease-in-out infinite',
            '@keyframes thingyLive': {
              '0%, 100%': { boxShadow: '0 0 0 0 rgba(34,197,94,.55)' },
              '50%': { boxShadow: '0 0 0 4px rgba(34,197,94,0)' },
            },
          }}
        />
      </Box>
    );
  }
  if (status === 'running')
    return <CircularProgress size={size - 2} thickness={5} />;
  if (status === 'waiting') {
    return <HourglassTopIcon color="info" sx={sx} />;
  }
  if (status === 'ok') return <CheckCircleIcon color="success" sx={sx} />;
  if (status === 'failed') return <ErrorIcon color="error" sx={sx} />;
  if (status === 'stopped') return <StopIcon color="warning" sx={sx} />;
  if (status === 'skipped')
    return <RemoveCircleOutlineIcon sx={{ ...sx, color: 'text.disabled' }} />;
  return <RadioButtonUncheckedIcon sx={{ ...sx, color: 'text.disabled' }} />;
}

const READY_LABELS: Record<string, string> = {
  container: 'Container is ready',
  port: 'Port is open',
  url: 'URL responds',
  output: 'Output contains',
  quiet: 'Output goes quiet',
};
const READY_PLACEHOLDERS: Record<string, string> = {
  container: 'shop-db-1',
  port: '5432  or  localhost:8080',
  url: 'http://localhost:8080/actuator/health',
  output: 'Started Application  or  /ready in \\d+/',
  quiet: '3',
};
const READY_HELP: Record<string, string> = {
  container:
    'Healthcheck if it has one, otherwise a real DB probe (pg_isready, mysqladmin ping...). Waits while the image pulls / starts.',
  port: 'A TCP connect works. With Docker the port may open before the DB is ready - prefer "Container is ready".',
  url: 'Any HTTP answer below 500.',
  output:
    "Text (any case) or /regex/ in this step's output - good for dev servers and watchers.",
  quiet:
    'Seconds without new output, after it printed something - for watchers with no clear "ready" line.',
};

const WHEN_LABELS: Record<ConditionType, string> = {
  changed: 'Only if files changed',
  missing: 'Only if missing',
  succeeds: 'Only if a check passes',
};
const WHEN_PLACEHOLDERS: Record<ConditionType, string> = {
  changed: 'package.json, package-lock.json, node_modules',
  missing: '.env',
  succeeds: 'git fetch -q && [ -n "$(git log HEAD..@{u} --oneline)" ]',
};
const WHEN_HELP: Record<ConditionType, string> = {
  changed:
    'Comma-separated, relative to the working directory. Runs when a file differs from its last successful run or a path is missing (folders only count as there / missing). Otherwise it is skipped.',
  missing: 'Runs when any of these paths does not exist, otherwise skipped.',
  succeeds:
    'A check command (same shell and folder): exit 0 = run the step, anything else = skip it.',
};

// --- edit dialog ----------------------------------------------------------------
function CommandDialog({
  open,
  initial,
  groupId,
  groups,
  onSave,
  onDelete,
  onClose,
}: {
  open: boolean;
  initial: CliCommand | null;
  groupId: string;
  groups: CommandGroup[];
  onSave: (command: CliCommand, groupId: string, runNow: boolean) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<CliCommand>(emptyCommand);
  const [group, setGroup] = useState(groupId);
  const isNew = !groups.some((g) =>
    g.commands.some((c) => c.id === initial?.id),
  );

  useEffect(() => {
    if (open) {
      setDraft(initial || emptyCommand());
      setGroup(groupId);
    }
  }, [open, initial, groupId]);

  const pickFolder = async () => {
    const folder = await window.electron.commands.pickFolder(draft.cwd);
    if (folder) setDraft((d) => ({ ...d, cwd: folder }));
  };
  const valid = !!draft.command.trim();
  const save = (runNow: boolean) =>
    valid && onSave({ ...draft, name: draft.name.trim() }, group, runNow);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{ sx: { p: 2.5, borderRadius: 3 } }}
    >
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
        {isNew ? 'New command' : 'Edit command'}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {isNew && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ width: '100%' }}
            >
              Start from
            </Typography>
            {COMMAND_PRESETS.map((preset) => (
              <Tooltip key={preset.label} title={preset.hint}>
                <Chip
                  size="small"
                  variant="outlined"
                  label={preset.label}
                  onClick={() =>
                    setDraft((d) => ({
                      ...emptyCommand(),
                      id: d.id,
                      cwd: d.cwd,
                      ...preset.command,
                    }))
                  }
                  sx={{ fontSize: 12 }}
                />
              </Tooltip>
            ))}
          </Box>
        )}
        <TextField
          size="small"
          label="Name"
          placeholder="e.g. Start Postgres"
          value={draft.name}
          autoFocus
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
        <TextField
          size="small"
          label="Command"
          placeholder={'docker compose up -d db\nnpm run migrate'}
          value={draft.command}
          multiline
          minRows={3}
          maxRows={12}
          helperText="Any CLI (git, npm, docker, java, flyway…) - runs in your shell with its PATH; several lines run as one script. Ctrl/⌘+Enter saves."
          onChange={(e) => setDraft((d) => ({ ...d, command: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(false);
          }}
          InputProps={{ sx: { fontFamily: MONO_FONT, fontSize: 13 } }}
        />
        <TextField
          size="small"
          label="Working directory"
          placeholder="~ (home)"
          value={draft.cwd}
          onChange={(e) => setDraft((d) => ({ ...d, cwd: e.target.value }))}
          InputProps={{
            sx: { fontFamily: MONO_FONT, fontSize: 13 },
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={pickFolder}
                  aria-label="Pick folder"
                >
                  <FolderOpenOutlinedIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexWrap: 'wrap',
          }}
        >
          <Select
            size="small"
            value={group}
            onChange={(e) => setGroup(String(e.target.value))}
            sx={{ minWidth: 180, fontSize: 14 }}
            aria-label="Package"
          >
            {groups.map((g) => (
              <MenuItem key={g.id} value={g.id}>
                {g.name}
              </MenuItem>
            ))}
          </Select>
          <Tooltip title="Off for dev servers and watchers: in a package the next step starts without waiting for this one to end.">
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={draft.wait}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, wait: e.target.checked }))
                  }
                />
              }
              label={
                <Typography variant="body2">Wait until it finishes</Typography>
              }
            />
          </Tooltip>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <Select
            size="small"
            value={draft.ready?.type || 'none'}
            onChange={(e) => {
              const type = e.target.value as ReadyType;
              setDraft((d) => ({
                ...d,
                ready:
                  type === 'none'
                    ? null
                    : {
                        type,
                        target:
                          d.ready?.type === type
                            ? d.ready.target
                            : type === 'quiet'
                              ? '3'
                              : '',
                        timeout: d.ready?.timeout ?? DEFAULT_READY_TIMEOUT,
                      },
              }));
            }}
            sx={{ minWidth: 190, fontSize: 14 }}
            aria-label="Ready when"
            renderValue={(v) =>
              v === 'none' ? 'Ready when it ends' : READY_LABELS[v as ReadyType]
            }
          >
            <MenuItem value="none">Nothing extra</MenuItem>
            {(Object.keys(READY_LABELS) as ReadyType[]).map((t) => (
              <MenuItem key={t} value={t}>
                {READY_LABELS[t]}
              </MenuItem>
            ))}
          </Select>
          {draft.ready && (
            <>
              <TextField
                size="small"
                value={draft.ready.target}
                placeholder={READY_PLACEHOLDERS[draft.ready.type]}
                helperText={READY_HELP[draft.ready.type]}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    ready: d.ready
                      ? { ...d.ready, target: e.target.value }
                      : null,
                  }))
                }
                sx={{ flex: 1 }}
                InputProps={{ sx: { fontFamily: MONO_FONT, fontSize: 13 } }}
              />
              <TextField
                size="small"
                type="number"
                label="Timeout s"
                value={draft.ready.timeout}
                helperText="0 = no limit"
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    ready: d.ready
                      ? {
                          ...d.ready,
                          timeout: Math.max(0, Number(e.target.value) || 0),
                        }
                      : null,
                  }))
                }
                sx={{ width: 100 }}
              />
            </>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <Select
            size="small"
            value={draft.when?.type || 'always'}
            onChange={(e) => {
              const type = e.target.value as ConditionType | 'always';
              setDraft((d) => ({
                ...d,
                when:
                  type === 'always'
                    ? null
                    : {
                        type,
                        target: d.when?.type === type ? d.when.target : '',
                      },
              }));
            }}
            sx={{ minWidth: 190, fontSize: 14 }}
            aria-label="Run it"
          >
            <MenuItem value="always">Always run</MenuItem>
            {CONDITION_TYPES.map((t) => (
              <MenuItem key={t} value={t}>
                {WHEN_LABELS[t]}
              </MenuItem>
            ))}
          </Select>
          {draft.when ? (
            <TextField
              size="small"
              value={draft.when.target}
              placeholder={WHEN_PLACEHOLDERS[draft.when.type]}
              helperText={WHEN_HELP[draft.when.type]}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  when: d.when ? { ...d.when, target: e.target.value } : null,
                }))
              }
              sx={{ flex: 1 }}
              InputProps={{ sx: { fontFamily: MONO_FONT, fontSize: 13 } }}
            />
          ) : (
            <Box sx={{ flex: 1 }} />
          )}
          {draft.wait && (
            <TextField
              size="small"
              type="number"
              label="Time limit s"
              value={draft.timeout || ''}
              placeholder="none"
              helperText="killed after"
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  timeout: Math.max(0, Number(e.target.value) || 0) || null,
                }))
              }
              sx={{ width: 110 }}
            />
          )}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2.5 }}>
        {!isNew && initial && (
          <Button
            color="error"
            size="small"
            onClick={() => onDelete(initial.id)}
          >
            Delete
          </Button>
        )}
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
          <Button size="small" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="small"
            disabled={!valid}
            onClick={() => save(true)}
            startIcon={<PlayArrowIcon />}
          >
            Save & run
          </Button>
          <Button
            size="small"
            variant="contained"
            disableElevation
            disabled={!valid}
            onClick={() => save(false)}
          >
            Save
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}

// --- log view -------------------------------------------------------------------
function LogView({ text, filter }: { text: string; filter: string }) {
  const theme = useTheme();
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  const lines = useMemo(() => {
    const all = text.split('\n');
    const q = filter.trim().toLowerCase();
    const shown = q ? all.filter((l) => l.toLowerCase().includes(q)) : all;
    return shown.slice(-4000);
  }, [text, filter]);

  useEffect(() => {
    if (ref.current && stick.current)
      ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <Box
      component="pre"
      ref={ref}
      onScroll={(e: React.UIEvent<HTMLPreElement>) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      sx={{
        m: 0,
        p: 1.5,
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        fontFamily: MONO_FONT,
        fontSize: 12,
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        bgcolor: alpha(theme.palette.text.primary, 0.04),
        borderRadius: 2,
      }}
    >
      {lines.length === 1 && !lines[0] ? (
        <Box component="span" sx={{ color: 'text.disabled' }}>
          No output yet.
        </Box>
      ) : (
        lines.map((line, i) => {
          let color: string | undefined;
          if (line.startsWith('▶') || line.startsWith('$ '))
            color = theme.palette.primary.main;
          else if (line.startsWith('──')) color = theme.palette.text.secondary;
          else if (ERROR_LINE.test(line)) color = theme.palette.error.main;
          return (
            // eslint-disable-next-line react/no-array-index-key
            <Box
              key={i}
              component="span"
              sx={{
                display: 'block',
                color,
                fontWeight: line.startsWith('▶') ? 700 : 400,
              }}
            >
              {line || ' '}
            </Box>
          );
        })
      )}
    </Box>
  );
}

// --- main ---------------------------------------------------------------------
export default function CommandsTool({
  openRun = null,
  openPackage = null,
}: {
  openRun?: { id: string; at: number } | null; // show this run (a notification was clicked)
  openPackage?: { id: string; at: number } | null; // scroll to it (picked in search)
}) {
  const theme = useTheme();
  const [state, setState] = useState<CommandsState | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{
    command: CliCommand | null;
    groupId: string;
  } | null>(null);
  const [groupMenu, setGroupMenu] = useState<{
    anchor: HTMLElement;
    group: CommandGroup;
  } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragItem>(null);
  const [drop, setDrop] = useState<DropTarget>(null);
  const [runs, setRuns] = useState<RunSnapshot[]>([]);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [output, setOutput] = useState('');
  const [logFilter, setLogFilter] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [openLinks, setOpenLinks] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const [, tick] = useState(0);
  const { copy, copied } = useCopy();
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  // --- persistence ---
  useEffect(() => {
    window.electron.database.getAllSettings().then((settings: any) => {
      setState(parseState(settings?.[SETTINGS_KEY]));
    });
    window.electron.commands.runs().then((list) => {
      setRuns(list);
      if (list[0]) setSelectedRun(list[0].id);
    });
  }, []);

  const change = useCallback((next: CommandsState) => {
    setState(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      window.electron.database.setSetting(SETTINGS_KEY, JSON.stringify(next));
    }, 300);
  }, []);

  // --- live runs / output ---
  useEffect(() => {
    const offRun = window.electron.ipcRenderer.on('commands:run', (payload) => {
      const run = payload as RunSnapshot;
      setRuns((list) =>
        [run, ...list.filter((r) => r.id !== run.id)].sort(
          (a, b) => b.startedAt - a.startedAt,
        ),
      );
    });
    return offRun;
  }, []);

  const selected = runs.find((r) => r.id === selectedRun) || null;
  // the command whose own log is shown on the right (marked in the list)
  const logOpenFor =
    selected && selectedStep !== null
      ? selected.steps[selectedStep]?.id || null
      : null;

  useEffect(() => {
    if (!selectedRun) {
      setOutput('');
      return undefined;
    }
    let alive = true;
    window.electron.commands
      .output(selectedRun, selectedStep)
      .then((text) => alive && setOutput(text));
    const off = window.electron.ipcRenderer.on('commands:output', (payload) => {
      const { runId, chunk, step } = payload as {
        runId: string;
        chunk: string;
        step: number | null;
      };
      if (runId !== selectedRun) return;
      if (selectedStep !== null && step !== selectedStep) return;
      setOutput((text) => text + chunk);
    });
    return () => {
      alive = false;
      off();
    };
  }, [selectedRun, selectedStep]);

  // a notification was clicked: open that run, on its failed step if any
  useEffect(() => {
    if (!openRun) return;
    window.electron.commands.runs().then((list) => {
      setRuns(list);
      const run = list.find((r) => r.id === openRun.id);
      if (!run) return;
      setSelectedRun(run.id);
      const failed = run.steps.findIndex((st) => st.status === 'failed');
      setSelectedStep(failed >= 0 ? failed : null);
      setLogFilter('');
    });
  }, [openRun]);

  // durations of running steps
  useEffect(() => {
    if (!runs.some((r) => r.status === 'running')) return undefined;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [runs]);

  // --- running ---
  const start = async (
    commands: CliCommand[],
    label: string,
    group?: CommandGroup,
  ) => {
    if (!state) return;
    const steps = expandSteps(
      state,
      commands,
      null,
      new Set(group ? [group.id] : []),
    );
    const run = await window.electron.commands.run(
      steps.map((c) => ({
        id: c.id,
        name: commandLabel(c),
        command: c.command,
        cwd: c.cwd,
        wait: c.wait,
        ready: c.ready || null,
        timeout: c.timeout || null,
        when: c.when || null,
        section: c.section,
      })),
      {
        label,
        groupId: group?.id || null,
        stopOnError: group ? group.stopOnError : true,
        notify: group ? group.notify === true : false,
      },
    );
    if (run) {
      setRuns((list) => [run, ...list.filter((r) => r.id !== run.id)]);
      setSelectedRun(run.id);
      setSelectedStep(null);
      setLogFilter('');
    }
  };

  const rerun = async (options?: {
    from?: number;
    only?: number;
    section?: string;
  }) => {
    if (!selected || !state) return;
    const noScope =
      options?.from === undefined &&
      options?.only === undefined &&
      !options?.section;
    const group = state.groups.find((g) => g.id === selected.groupId);
    if (noScope && group) {
      // the whole package: run it as it is now (added / removed steps too)
      await start(group.commands, group.name, group);
      return;
    }
    // the saved commands as they are now, so a fix made after the failure runs
    const latest: Record<string, Partial<RunStepInput>> = {};
    state.groups.forEach((g) =>
      g.commands.forEach((c) => {
        if (!c.packageId) {
          latest[c.id] = {
            name: commandLabel(c),
            command: c.command,
            cwd: c.cwd,
            wait: c.wait,
            ready: c.ready || null,
            timeout: c.timeout || null,
            when: c.when || null,
          };
        }
      }),
    );
    const run = await window.electron.commands.rerun(selected.id, {
      ...options,
      latest,
    });
    if (run) {
      setRuns((list) => [run, ...list.filter((r) => r.id !== run.id)]);
      setSelectedRun(run.id);
      setSelectedStep(options?.only !== undefined ? 0 : null);
    }
  };

  const showHint = (text: string) => {
    setHint(text);
    setTimeout(() => setHint((h) => (h === text ? null : h)), 3000);
  };

  /**
   * Opens the log of the newest run of these steps (one command, or every step of a
   * package inside another): that step's own log, or for several the first one that
   * failed / is running.
   */
  const showLastLog = (stepIds: string[]) => {
    const ids = new Set(stepIds);
    const run = runs.find((r) => r.steps.some((st) => ids.has(st.id)));
    if (!run) {
      showHint('Not run yet - nothing to show');
      return;
    }
    const mine = run.steps
      .map((st, index) => ({ st, index }))
      .filter((x) => ids.has(x.st.id));
    const pick =
      stepIds.length === 1
        ? mine[0]
        : mine.find((x) => x.st.status === 'failed') ||
          mine.find(
            (x) => x.st.status === 'running' || x.st.status === 'waiting',
          );
    setSelectedRun(run.id);
    setSelectedStep(pick ? pick.index : mine[0].index);
    setLogFilter('');
  };
  /** Clicks on a row's own buttons don't count. */
  const rowClick = (e: React.MouseEvent, open: () => void) => {
    if ((e.target as HTMLElement).closest('button, input, a')) return;
    open();
  };

  /** Scroll to a package (and open it) - from a link to it inside another one. */
  const goToPackage = (id: string) => {
    if (!state) return;
    const target = state.groups.find((g) => g.id === id);
    if (target?.collapsed) {
      change(updateGroup(state, id, { collapsed: false }));
    }
    setTimeout(() => {
      document
        .getElementById(`pkg-${id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    setFlash(id);
    setTimeout(() => setFlash(null), 1400);
  };

  // picked in search: scroll to the package and flash it (once the packages are loaded)
  const loaded = !!state;
  useEffect(() => {
    if (openPackage && loaded) goToPackage(openPackage.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPackage, loaded]);

  const clearHistory = async () => {
    await window.electron.commands.clear();
    const list = await window.electron.commands.runs();
    setRuns(list);
    setSelectedRun(list[0]?.id || null);
    setSelectedStep(null);
  };

  // Latest status of each command (from the newest run it was part of)
  const lastStatus = useMemo(() => {
    const map = new Map<string, ShownStatus>();
    runs.forEach((run) =>
      run.steps.forEach((st) => {
        if (!map.has(st.id) && st.status !== 'pending') {
          map.set(st.id, stepShown(st));
        }
      }),
    );
    return map;
  }, [runs]);
  // command id -> the live step running it (run + index), for its Stop button
  const liveSteps = useMemo(() => {
    const map = new Map<string, { runId: string; index: number }>();
    runs
      .filter((r) => r.status === 'running')
      .forEach((run) =>
        run.steps.forEach((st, index) => {
          if (
            !map.has(st.id) &&
            (st.status === 'running' || st.status === 'waiting')
          ) {
            map.set(st.id, { runId: run.id, index });
          }
        }),
      );
    return map;
  }, [runs]);
  // package id -> its running run (newest first)
  const runningGroups = useMemo(() => {
    const map = new Map<string, RunSnapshot>();
    runs.forEach((r) => {
      if (r.status === 'running' && r.groupId && !map.has(r.groupId)) {
        map.set(r.groupId, r);
      }
    });
    return map;
  }, [runs]);

  // --- drag & drop ---
  const onRowDragOver = (
    e: React.DragEvent,
    groupId: string,
    index: number,
  ) => {
    if (!drag || !state) return;
    // a package dragged into another package goes in as a whole (a link to it)
    if (drag.type === 'group' && !canNest(state, drag.id, groupId)) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    setDrop({ type: 'command', groupId, index: index + (after ? 1 : 0) });
  };
  const onGroupDragOver = (
    e: React.DragEvent,
    group: CommandGroup,
    index: number,
  ) => {
    if (drag?.type === 'command') {
      // over the header / empty space: append to the group
      e.preventDefault();
      if (drop?.type !== 'command' || drop.groupId !== group.id) {
        setDrop({
          type: 'command',
          groupId: group.id,
          index: group.commands.length,
        });
      }
    } else if (drag?.type === 'group') {
      e.preventDefault();
      // over another package: its middle = put the dragged one inside (as a step),
      // its top / bottom edge = reorder the packages
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const edge = Math.min(14, rect.height * 0.25);
      const y = e.clientY - rect.top;
      const nest =
        drag.id !== group.id &&
        y > edge &&
        y < rect.height - edge &&
        !!state &&
        canNest(state, drag.id, group.id);
      if (nest) {
        if (drop?.type !== 'command' || drop.groupId !== group.id) {
          setDrop({
            type: 'command',
            groupId: group.id,
            index: group.commands.length,
          });
        }
        return;
      }
      const next = index + (y > rect.height / 2 ? 1 : 0);
      if (drop?.type !== 'group' || drop.index !== next) {
        setDrop({ type: 'group', index: next });
      }
    }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (state && drag && drop) {
      if (drag.type === 'command' && drop.type === 'command') {
        change(moveCommand(state, drag.id, drop.groupId, drop.index));
      } else if (drag.type === 'group' && drop.type === 'group') {
        change(moveGroup(state, drag.id, drop.index));
      } else if (drag.type === 'group' && drop.type === 'command') {
        const source = state.groups.find((g) => g.id === drag.id);
        const target = state.groups.find((g) => g.id === drop.groupId);
        if (source && target && canNest(state, source.id, target.id)) {
          change(addPackageLink(state, source.id, target.id, drop.index));
          showHint(
            `\u201c${source.name}\u201d is now a step of \u201c${target.name}\u201d`,
          );
        } else if (source && target) {
          showHint(
            `\u201c${source.name}\u201d already contains \u201c${target.name}\u201d`,
          );
        }
      }
    }
    setDrag(null);
    setDrop(null);
  };
  const endDrag = () => {
    setDrag(null);
    setDrop(null);
  };

  if (!state) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  const groups = searchCommands(state, query);
  const searching = !!query.trim();
  const draggedGroup =
    drag?.type === 'group' ? state.groups.find((g) => g.id === drag.id) : null;
  const dropLine = (
    <Box
      sx={{ position: 'relative', height: 2, mx: 1, my: draggedGroup ? 1 : 0 }}
    >
      <Box sx={{ height: 2, borderRadius: 1, bgcolor: 'primary.main' }} />
      {draggedGroup && drop?.type === 'command' && (
        <Typography
          variant="caption"
          sx={{
            position: 'absolute',
            left: 24,
            top: -9,
            px: 0.75,
            borderRadius: 1,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            fontSize: 10,
            lineHeight: '18px',
          }}
        >
          add the package {draggedGroup.name} here
        </Typography>
      )}
    </Box>
  );

  const rowDrag = (group: CommandGroup, c: CliCommand, index: number) => ({
    draggable: !searching,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', c.id);
      setDrag({ type: 'command', id: c.id });
    },
    onDragEnd: endDrag,
    onDragOver: (e: React.DragEvent) => onRowDragOver(e, group.id, index),
    onDrop,
  });

  /** Combined last-run status of some steps (a package, a package inside one). */
  const renderCombined = (steps: CliCommand[]) => {
    const statuses = steps.map((st) => lastStatus.get(st.id) || null);
    const status = combineShown(statuses);
    if (!status) return null;
    const ran = statuses.filter(Boolean).length;
    const passed = statuses.filter((st) => st === 'ok' || st === 'live').length;
    const failed = statuses.filter((st) => st === 'failed').length;
    return (
      <Tooltip
        title={`Last run: ${STATUS_WORDS[status] || status} · ${passed}/${steps.length} ok${failed ? ` · ${failed} failed` : ''}${ran < steps.length ? ` · ${steps.length - ran} not run yet` : ''}`}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {failed > 0 && (
            <Typography variant="caption" color="error.main">
              {failed}✖
            </Typography>
          )}
          <StatusIcon status={status} size={15} />
        </Box>
      </Tooltip>
    );
  };

  // a whole package inside this one
  const renderLink = (group: CommandGroup, c: CliCommand, index: number) => {
    const inner = state.groups.find((g) => g.id === c.packageId);
    if (!inner) return null;
    const steps = packageSteps(state, inner);
    const expanded = openLinks.has(c.id);
    const color = inner.color
      ? PACKAGE_COLOR_HEX[inner.color]
      : theme.palette.text.secondary;
    const innerRun = runningGroups.get(inner.id);
    const isDropBefore =
      drop?.type === 'command' &&
      drop.groupId === group.id &&
      drop.index === index;
    return (
      <React.Fragment key={c.id}>
        {isDropBefore && dropLine}
        <Box
          {...rowDrag(group, c, index)}
          onClick={(e) =>
            rowClick(e, () => showLastLog(steps.map((st) => st.id)))
          }
          onDoubleClick={() => goToPackage(inner.id)}
          title="Click: its last log · Double-click: go to the package"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            pl: 0.5,
            pr: 1,
            py: 0.5,
            my: 0.25,
            borderRadius: 2,
            borderLeft: `3px solid ${color}`,
            cursor: 'pointer',
            bgcolor: alpha(color, 0.07),
            opacity: drag?.id === c.id ? 0.4 : 1,
            '&:hover': { bgcolor: alpha(color, 0.12) },
            '&:hover .row-actions': { opacity: 1 },
          }}
        >
          <DragIndicatorIcon
            sx={{
              fontSize: 18,
              color: 'text.disabled',
              cursor: searching ? 'default' : 'grab',
            }}
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ width: 16, textAlign: 'right' }}
          >
            {index + 1}
          </Typography>
          <IconButton
            size="small"
            onClick={() =>
              setOpenLinks((set) => {
                const next = new Set(set);
                if (next.has(c.id)) next.delete(c.id);
                else next.add(c.id);
                return next;
              })
            }
            aria-label={expanded ? 'Hide its steps' : 'Show its steps'}
            sx={{ p: 0.25 }}
          >
            {expanded ? (
              <ExpandMoreIcon sx={{ fontSize: 18 }} />
            ) : (
              <ChevronRightIcon sx={{ fontSize: 18 }} />
            )}
          </IconButton>
          <PackageIconView icon={inner.icon} sx={{ fontSize: 18, color }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 700, color }} noWrap>
              {inner.name}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              component="div"
              noWrap
            >
              package · {steps.length} step{steps.length === 1 ? '' : 's'}
              {!inner.stopOnError && ' · continues on error'}
            </Typography>
          </Box>
          {renderCombined(steps)}
          <Box
            className="row-actions"
            sx={{
              display: 'flex',
              opacity: innerRun ? 1 : 0.5,
              transition: 'opacity .15s',
            }}
          >
            <Tooltip title="Go to the package (edit it there - it changes everywhere it's used)">
              <IconButton
                size="small"
                onClick={() => goToPackage(inner.id)}
                aria-label={`Go to ${inner.name}`}
              >
                <OpenInNewIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={`Take it out of ${group.name} (the package stays)`}>
              <IconButton
                size="small"
                onClick={() => change(removeCommand(state, c.id))}
                aria-label={`Remove ${inner.name} from ${group.name}`}
              >
                <LinkOffIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
            {innerRun ? (
              <Tooltip title={`Stop ${inner.name}`}>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => window.electron.commands.stop(innerRun.id)}
                  aria-label={`Stop ${inner.name}`}
                >
                  <StopIcon sx={{ fontSize: 19 }} />
                </IconButton>
              </Tooltip>
            ) : (
              <Tooltip title={`Run only ${inner.name}`}>
                <span>
                  <IconButton
                    size="small"
                    color="primary"
                    disabled={!steps.length}
                    onClick={() => start(inner.commands, inner.name, inner)}
                    aria-label={`Run ${inner.name}`}
                  >
                    <PlayArrowIcon sx={{ fontSize: 19 }} />
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Box>
        </Box>
        {expanded && (
          <Box
            sx={{
              ml: 7,
              mr: 1,
              mb: 0.5,
              pl: 1.25,
              borderLeft: `1px dashed ${alpha(color, 0.6)}`,
            }}
          >
            {steps.map((st, i) => (
              <Typography
                // eslint-disable-next-line react/no-array-index-key
                key={`${st.id}-${i}`}
                variant="caption"
                color="text.secondary"
                component="div"
                noWrap
                title={`${st.command}\n(click: its last log)`}
                onClick={() => showLastLog([st.id])}
                sx={{
                  py: 0.1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  cursor: 'pointer',
                  borderRadius: 1,
                  color:
                    logOpenFor === st.id ? 'primary.main' : 'text.secondary',
                  '&:hover': { color: 'text.primary' },
                }}
              >
                <StatusIcon status={lastStatus.get(st.id) || null} size={12} />
                {i + 1}.{' '}
                {st.section && (
                  <Box component="span" sx={{ color: 'text.disabled' }}>
                    {st.section} ›{' '}
                  </Box>
                )}
                {commandLabel(st)}
              </Typography>
            ))}
            {!steps.length && (
              <Typography variant="caption" color="text.disabled">
                Empty package
              </Typography>
            )}
          </Box>
        )}
      </React.Fragment>
    );
  };

  const renderCommand = (group: CommandGroup, c: CliCommand, index: number) => {
    if (c.packageId) return renderLink(group, c, index);
    const status = lastStatus.get(c.id) || null;
    const isDropBefore =
      drop?.type === 'command' &&
      drop.groupId === group.id &&
      drop.index === index;
    return (
      <React.Fragment key={c.id}>
        {isDropBefore && dropLine}
        <Box
          {...rowDrag(group, c, index)}
          onClick={(e) => rowClick(e, () => showLastLog([c.id]))}
          onDoubleClick={() => setEditing({ command: c, groupId: group.id })}
          title="Click: its last log · Double-click: edit"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            pl: 0.5,
            pr: 1,
            py: 0.5,
            borderRadius: 2,
            cursor: 'pointer',
            opacity: drag?.id === c.id ? 0.4 : 1,
            bgcolor:
              logOpenFor === c.id
                ? alpha(theme.palette.primary.main, 0.1)
                : 'transparent',
            '&:hover': {
              bgcolor:
                logOpenFor === c.id
                  ? alpha(theme.palette.primary.main, 0.14)
                  : 'action.hover',
            },
            '&:hover .row-actions': { opacity: 1 },
          }}
        >
          <DragIndicatorIcon
            sx={{
              fontSize: 18,
              color: 'text.disabled',
              cursor: searching ? 'default' : 'grab',
            }}
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ width: 16, textAlign: 'right' }}
          >
            {index + 1}
          </Typography>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                {commandLabel(c)}
              </Typography>
              {!c.wait && (
                <Chip
                  size="small"
                  label="background"
                  sx={{ height: 18, fontSize: 10 }}
                />
              )}
              {c.when && (
                <Tooltip title={`Runs only if ${describeCondition(c.when)}`}>
                  <Chip
                    size="small"
                    variant="outlined"
                    icon={
                      <FilterAltOutlinedIcon
                        sx={{ fontSize: '12px !important' }}
                      />
                    }
                    label={describeCondition(c.when)}
                    sx={{ height: 18, fontSize: 10, maxWidth: 200 }}
                  />
                </Tooltip>
              )}
              {!!c.timeout && c.wait && (
                <Tooltip title={`Killed if it takes over ${c.timeout} s`}>
                  <Chip
                    size="small"
                    variant="outlined"
                    icon={
                      <TimerOutlinedIcon sx={{ fontSize: '12px !important' }} />
                    }
                    label={`${c.timeout} s`}
                    sx={{ height: 18, fontSize: 10 }}
                  />
                </Tooltip>
              )}
              {c.ready && (
                <Tooltip
                  title={`Next step waits until ${describeReady(c.ready)}`}
                >
                  <Chip
                    size="small"
                    variant="outlined"
                    icon={
                      <HourglassTopIcon sx={{ fontSize: '12px !important' }} />
                    }
                    label={describeReady(c.ready)}
                    sx={{ height: 18, fontSize: 10, maxWidth: 200 }}
                  />
                </Tooltip>
              )}
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              component="div"
              title={`${c.cwd ? `${c.cwd}\n` : ''}${c.command}`}
              sx={{ fontFamily: MONO_FONT, fontSize: 11 }}
            >
              {c.cwd && (
                <Box component="span" sx={{ color: 'text.disabled' }}>
                  {c.cwd} ${' '}
                </Box>
              )}
              {c.command.split('\n').join(' ; ')}
            </Typography>
          </Box>
          <Tooltip title={status ? `Last run: ${status}` : 'Not run yet'}>
            <Box sx={{ display: 'flex' }}>
              <StatusIcon status={status} size={15} />
            </Box>
          </Tooltip>
          <Box
            className="row-actions"
            sx={{
              display: 'flex',
              opacity: liveSteps.has(c.id) ? 1 : 0.5,
              transition: 'opacity .15s',
            }}
          >
            <Tooltip title="Edit">
              <IconButton
                size="small"
                onClick={() => setEditing({ command: c, groupId: group.id })}
                aria-label={`Edit ${commandLabel(c)}`}
              >
                <EditOutlinedIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
            {liveSteps.has(c.id) ? (
              <Tooltip title="Stop it (a package it runs in goes on with the next step)">
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => {
                    const live = liveSteps.get(c.id)!;
                    window.electron.commands.stopStep(live.runId, live.index);
                  }}
                  aria-label={`Stop ${commandLabel(c)}`}
                >
                  <StopIcon sx={{ fontSize: 19 }} />
                </IconButton>
              </Tooltip>
            ) : (
              <Tooltip title="Run this command">
                <IconButton
                  size="small"
                  color="primary"
                  onClick={() => start([c], commandLabel(c))}
                  aria-label={`Run ${commandLabel(c)}`}
                >
                  <PlayArrowIcon sx={{ fontSize: 19 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>
      </React.Fragment>
    );
  };

  const renderGroup = (group: CommandGroup, index: number) => {
    const groupRun = runningGroups.get(group.id);
    const groupReady = !!groupRun?.readyAt;
    const stepTotal = packageSteps(state, group).length;
    const open = !group.collapsed || searching;
    const isDropBefore = drop?.type === 'group' && drop.index === index;
    const dropAtEnd =
      drop?.type === 'command' &&
      drop.groupId === group.id &&
      drop.index === group.commands.length;
    return (
      <React.Fragment key={group.id}>
        {isDropBefore && dropLine}
        <Paper
          id={`pkg-${group.id}`}
          variant="outlined"
          onDragOver={(e) => onGroupDragOver(e, group, index)}
          onDrop={onDrop}
          sx={{
            borderRadius: 3,
            p: 1,
            scrollMarginTop: 8,
            transition: 'box-shadow .3s',
            boxShadow:
              flash === group.id
                ? `0 0 0 2px ${theme.palette.primary.main}`
                : 'none',
            opacity: drag?.type === 'group' && drag.id === group.id ? 0.4 : 1,
            borderColor:
              drag && drop?.type === 'command' && drop.groupId === group.id
                ? 'primary.main'
                : 'divider',
            ...(draggedGroup &&
              drop?.type === 'command' &&
              drop.groupId === group.id && {
                outline: `2px dashed ${theme.palette.primary.main}`,
                outlineOffset: 2,
              }),
            ...(group.color && {
              borderLeft: `4px solid ${PACKAGE_COLOR_HEX[group.color]}`,
              bgcolor: alpha(PACKAGE_COLOR_HEX[group.color], 0.05),
            }),
          }}
        >
          <Box
            draggable={!searching && renaming !== group.id}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', group.id);
              setDrag({ type: 'group', id: group.id });
            }}
            onDragEnd={endDrag}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            <Box
              sx={{ display: 'flex', cursor: searching ? 'default' : 'grab' }}
              title="Drag onto another package to put it inside, or to its edge to reorder"
            >
              <DragIndicatorIcon
                sx={{ fontSize: 18, color: 'text.disabled' }}
              />
            </Box>
            <IconButton
              size="small"
              onClick={() =>
                change(
                  updateGroup(state, group.id, { collapsed: !group.collapsed }),
                )
              }
              aria-label={open ? 'Collapse package' : 'Expand package'}
              sx={{ p: 0.25 }}
            >
              {open ? (
                <ExpandMoreIcon fontSize="small" />
              ) : (
                <ChevronRightIcon fontSize="small" />
              )}
            </IconButton>
            {group.icon && (
              <PackageIconView
                icon={group.icon}
                sx={{
                  fontSize: 18,
                  color: group.color
                    ? PACKAGE_COLOR_HEX[group.color]
                    : 'text.secondary',
                }}
              />
            )}
            {renaming === group.id ? (
              <TextField
                size="small"
                variant="standard"
                autoFocus
                defaultValue={group.name}
                onBlur={(e) => {
                  change(
                    updateGroup(state, group.id, {
                      name: e.target.value.trim() || group.name,
                    }),
                  );
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
                sx={{ flex: 1 }}
              />
            ) : (
              <Typography
                variant="subtitle2"
                sx={{
                  fontWeight: 700,
                  flex: 1,
                  minWidth: 0,
                  cursor: 'text',
                  color: group.color
                    ? PACKAGE_COLOR_HEX[group.color]
                    : undefined,
                }}
                noWrap
                onDoubleClick={() => setRenaming(group.id)}
              >
                {group.name}
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 1 }}
                  title={
                    stepTotal !== group.commands.length
                      ? `${stepTotal} steps with the packages inside`
                      : undefined
                  }
                >
                  {stepTotal}
                </Typography>
              </Typography>
            )}
            {!groupRun && renderCombined(packageSteps(state, group))}
            {draggedGroup &&
              drop?.type === 'command' &&
              drop.groupId === group.id && (
                <Chip
                  size="small"
                  color="primary"
                  label={`+ ${draggedGroup.name} as a step`}
                  sx={{ height: 20, fontSize: 11 }}
                />
              )}
            <Tooltip
              title={
                group.stopOnError
                  ? 'Stops at the first failing step (click to keep going)'
                  : 'Keeps going after a failing step (click to stop on errors)'
              }
            >
              <Chip
                size="small"
                variant="outlined"
                label={
                  group.stopOnError ? 'stop on error' : 'continue on error'
                }
                onClick={() =>
                  change(
                    updateGroup(state, group.id, {
                      stopOnError: !group.stopOnError,
                    }),
                  )
                }
                sx={{ height: 20, fontSize: 11 }}
              />
            </Tooltip>
            <Tooltip
              title={
                group.notify === true
                  ? 'Notifies you when it is done, fails or is up (click to turn off)'
                  : 'No notification for this package (click to turn on)'
              }
            >
              <IconButton
                size="small"
                onClick={() =>
                  change(
                    updateGroup(state, group.id, {
                      notify: group.notify !== true,
                    }),
                  )
                }
                aria-label={
                  group.notify === true
                    ? `Turn off notifications for ${group.name}`
                    : `Turn on notifications for ${group.name}`
                }
                sx={{ p: 0.5 }}
              >
                {group.notify === true ? (
                  <NotificationsActiveOutlinedIcon sx={{ fontSize: 17 }} />
                ) : (
                  <NotificationsOffOutlinedIcon
                    sx={{ fontSize: 17, color: 'text.disabled' }}
                  />
                )}
              </IconButton>
            </Tooltip>
            <Tooltip title="Add command">
              <IconButton
                size="small"
                onClick={() => setEditing({ command: null, groupId: group.id })}
                aria-label={`Add command to ${group.name}`}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <IconButton
              size="small"
              onClick={(e) => setGroupMenu({ anchor: e.currentTarget, group })}
              aria-label={`${group.name} menu`}
            >
              <MoreHorizIcon fontSize="small" />
            </IconButton>
            {groupRun ? (
              <>
                <Tooltip
                  title={
                    groupReady
                      ? 'Ready - its background steps keep running'
                      : 'Running - click to see it'
                  }
                >
                  <Button
                    size="small"
                    color={groupReady ? 'success' : 'primary'}
                    onClick={() => {
                      setSelectedRun(groupRun.id);
                      setSelectedStep(null);
                    }}
                    startIcon={
                      groupReady ? (
                        <StatusIcon status="live" size={14} />
                      ) : (
                        <CircularProgress size={12} color="inherit" />
                      )
                    }
                    sx={{ ml: 0.5, py: 0.25, minWidth: 0 }}
                  >
                    {groupReady ? 'Ready' : 'Running'}
                  </Button>
                </Tooltip>
                <Tooltip title="Stop the package (and everything it started)">
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => window.electron.commands.stop(groupRun.id)}
                    aria-label={`Stop ${group.name}`}
                  >
                    <StopIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            ) : (
              <Button
                size="small"
                variant="contained"
                disableElevation
                disabled={!stepTotal}
                onClick={() => start(group.commands, group.name, group)}
                startIcon={<PlayArrowIcon />}
                sx={{ ml: 0.5, py: 0.25, minWidth: 0 }}
              >
                Run all
              </Button>
            )}
          </Box>
          {open && (
            <Box
              sx={{ mt: 0.5 }}
              onDragOver={(e) => {
                if (
                  drag?.type !== 'group' ||
                  !canNest(state, drag.id, group.id)
                )
                  return;
                e.preventDefault();
                e.stopPropagation();
                if (drop?.type !== 'command' || drop.groupId !== group.id) {
                  setDrop({
                    type: 'command',
                    groupId: group.id,
                    index: group.commands.length,
                  });
                }
              }}
            >
              {group.commands.map((c, i) => renderCommand(group, c, i))}
              {dropAtEnd && dropLine}
              {!group.commands.length && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="div"
                  sx={{ px: 4, py: 1 }}
                >
                  {drag
                    ? 'Drop here'
                    : 'Empty - add a command, drag one here, or drop a whole package in (it runs as one step).'}
                </Typography>
              )}
            </Box>
          )}
        </Paper>
      </React.Fragment>
    );
  };

  const failedIndex = selected
    ? selected.steps.findIndex((s) => s.status === 'failed')
    : -1;
  // the innermost nested package of the failed step
  const failedSection =
    selected && failedIndex >= 0 ? selected.steps[failedIndex].section : null;

  // nested packages that start at step i (one header per level)
  const newSections = (i: number) => {
    if (!selected) return [];
    const levels = sectionLevels(selected.steps[i].section);
    const before = sectionLevels(selected.steps[i - 1]?.section ?? null);
    let k = 0;
    while (k < levels.length && levels[k] === before[k]) k += 1;
    return levels.slice(k);
  };

  const renderSectionHeader = (section: string) => {
    if (!selected) return null;
    const steps = selected.steps.filter((st) => stepInSection(st, section));
    const status = sectionShown(steps);
    const firstIndex = selected.steps.findIndex((st) =>
      stepInSection(st, section),
    );
    const failedAt = selected.steps.findIndex(
      (st) => st.status === 'failed' && stepInSection(st, section),
    );
    const done = selected.status !== 'running';
    const name = section.split(SECTION_SEP).pop();
    return (
      <Box
        key={`section-${section}`}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          ml: -1.5,
          pl: 1,
          pr: 0.5,
          pt: 0.75,
          pb: 0.25,
          borderRadius: 1.5,
          '&:hover .section-actions': { opacity: 1 },
        }}
        title={section}
      >
        <PackageIconView
          icon={state?.groups.find((g) => g.name === name)?.icon}
          sx={{
            fontSize: 14,
            color: status === 'failed' ? 'error.main' : 'text.secondary',
          }}
        />
        <Typography
          variant="caption"
          sx={{
            fontWeight: 700,
            flex: 1,
            minWidth: 0,
            color: status === 'failed' ? 'error.main' : 'text.secondary',
          }}
          noWrap
        >
          {name}
          <Box
            component="span"
            sx={{ fontWeight: 400, ml: 0.75, color: 'text.disabled' }}
          >
            {steps.filter((st) => st.status === 'ok').length}/{steps.length}
          </Box>
        </Typography>
        <StatusIcon status={status} size={14} />
        {done && (
          <Box
            className="section-actions"
            sx={{
              display: 'flex',
              opacity: status === 'failed' ? 1 : 0,
              transition: 'opacity .15s',
            }}
          >
            {failedAt > firstIndex && (
              <Tooltip title={`Rerun ${name} from its failed step`}>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => rerun({ section, from: failedAt })}
                  aria-label={`Rerun ${name} from the failed step`}
                  sx={{ p: 0.25 }}
                >
                  <ReplayIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={`Run only ${name} again (${steps.length} steps)`}>
              <IconButton
                size="small"
                onClick={() => rerun({ section })}
                aria-label={`Rerun only ${name}`}
                sx={{ p: 0.25 }}
              >
                <PlayArrowIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Box
      sx={{
        height: '100%',
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(340px, 0.9fr) minmax(0, 1.1fr)',
        gap: 1.5,
      }}
    >
      {/* Left: packages */}
      <Box
        sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, gap: 1 }}
      >
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Search commands…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ flex: 1 }}
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
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => change({ groups: [...state.groups, emptyGroup()] })}
          >
            Package
          </Button>
          <Button
            size="small"
            variant="contained"
            disableElevation
            startIcon={<AddIcon />}
            onClick={() =>
              setEditing({ command: null, groupId: state.groups[0].id })
            }
          >
            Command
          </Button>
        </Box>
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            pb: 1,
          }}
          onDragOver={(e) => {
            if (drag?.type === 'group') {
              e.preventDefault();
            }
          }}
          onDrop={onDrop}
        >
          {groups.map(renderGroup)}
          {drop?.type === 'group' &&
            drop.index === state.groups.length &&
            dropLine}
          {searching && !groups.length && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ textAlign: 'center', mt: 3 }}
            >
              Nothing matches “{query}”.
            </Typography>
          )}
        </Box>
      </Box>

      {/* Right: runs + logs */}
      <Paper
        variant="outlined"
        sx={{
          borderRadius: 3,
          p: 1.5,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          gap: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Select
            size="small"
            displayEmpty
            value={selected?.id || ''}
            onChange={(e) => {
              setSelectedRun(String(e.target.value) || null);
              setSelectedStep(null);
            }}
            sx={{
              flex: 1,
              minWidth: 0,
              fontSize: 14,
              '& .MuiSelect-select': {
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                py: 0.75,
              },
            }}
            aria-label="Run"
            renderValue={() =>
              selected ? (
                <>
                  <StatusIcon status={runShown(selected)} />
                  <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                    {selected.label}
                  </Typography>
                  {selected.status === 'running' && selected.readyAt && (
                    <Typography
                      variant="caption"
                      color="success.main"
                      sx={{ fontWeight: 600 }}
                      noWrap
                    >
                      ready in {duration(selected.startedAt, selected.readyAt)}
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {new Date(selected.startedAt).toLocaleTimeString()} ·{' '}
                    {duration(
                      selected.startedAt,
                      selected.endedAt ?? selected.readyAt,
                    )}
                  </Typography>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No runs yet - press ▶ on a command or a package
                </Typography>
              )
            }
          >
            {runs.map((r) => (
              <MenuItem key={r.id} value={r.id} sx={{ gap: 1 }}>
                <StatusIcon status={runShown(r)} />
                <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                  {r.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(r.startedAt).toLocaleTimeString()}
                </Typography>
              </MenuItem>
            ))}
          </Select>
          {selected?.status === 'running' ? (
            <Button
              size="small"
              color="error"
              variant="outlined"
              startIcon={<StopIcon />}
              title={
                selected.stopping
                  ? 'Still not gone - kill everything with SIGKILL'
                  : undefined
              }
              onClick={() => window.electron.commands.stop(selected.id)}
            >
              {selected.stopping
                ? 'Force kill'
                : selected.readyAt
                  ? 'Stop all'
                  : 'Stop'}
            </Button>
          ) : (
            selected && (
              <>
                {failedSection && (
                  <Tooltip
                    title={`Run only “${failedSection.split(SECTION_SEP).pop()}” again, from its failed step - not the whole package`}
                  >
                    <Button
                      size="small"
                      color="error"
                      startIcon={<ReplayIcon />}
                      onClick={() =>
                        rerun({ section: failedSection, from: failedIndex })
                      }
                    >
                      Rerun failed part
                    </Button>
                  </Tooltip>
                )}
                {failedIndex > 0 && (
                  <Tooltip
                    title={`Skip the steps that passed and start at “${selected.steps[failedIndex].name}”`}
                  >
                    <Button
                      size="small"
                      startIcon={<ReplayIcon />}
                      onClick={() => rerun({ from: failedIndex })}
                    >
                      From failed
                    </Button>
                  </Tooltip>
                )}
                <Tooltip title="Run it again">
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ReplayIcon />}
                    onClick={() => rerun()}
                  >
                    Rerun
                  </Button>
                </Tooltip>
              </>
            )
          )}
          <Tooltip title="Clear finished runs">
            <span>
              <IconButton
                size="small"
                disabled={!runs.some((r) => r.status !== 'running')}
                onClick={clearHistory}
                aria-label="Clear finished runs"
              >
                <DeleteSweepOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>

        {selected && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0.25,
              maxHeight: '40%',
              overflow: 'auto',
              flexShrink: 0,
            }}
          >
            {selected.steps.length > 1 && (
              <Box
                onClick={() => setSelectedStep(null)}
                sx={{
                  px: 1,
                  py: 0.25,
                  borderRadius: 1.5,
                  cursor: 'pointer',
                  bgcolor:
                    selectedStep === null
                      ? alpha(theme.palette.primary.main, 0.1)
                      : 'transparent',
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  All output
                </Typography>
              </Box>
            )}
            {selected.steps.map((step, i) => (
              <Box
                key={`${step.id}-${i}`}
                sx={{ pl: sectionLevels(step.section).length * 1.5 }}
              >
                {newSections(i).map((level) => renderSectionHeader(level))}
                <Box
                  onClick={() =>
                    setSelectedStep(
                      selected.steps.length > 1 && selectedStep === i
                        ? null
                        : i,
                    )
                  }
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1,
                    py: 0.4,
                    borderRadius: 1.5,
                    cursor: 'pointer',
                    bgcolor:
                      selectedStep === i
                        ? alpha(theme.palette.primary.main, 0.1)
                        : 'transparent',
                    '&:hover': {
                      bgcolor:
                        selectedStep === i
                          ? alpha(theme.palette.primary.main, 0.14)
                          : 'action.hover',
                    },
                    '&:hover .step-actions': { opacity: 1 },
                  }}
                >
                  <StatusIcon status={stepShown(step)} size={15} />
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      fontWeight: step.status === 'failed' ? 700 : 400,
                    }}
                  >
                    {step.name}
                    {step.background && (
                      <Typography
                        component="span"
                        variant="caption"
                        color="text.secondary"
                        sx={{ ml: 1 }}
                      >
                        background
                      </Typography>
                    )}
                    {step.ready && step.readyState && (
                      <Typography
                        component="span"
                        variant="caption"
                        color={
                          step.readyState === 'failed'
                            ? 'error.main'
                            : step.readyState === 'ready'
                              ? 'success.main'
                              : 'info.main'
                        }
                        sx={{ ml: 1 }}
                      >
                        {step.readyState === 'waiting'
                          ? `waiting: ${step.ready}${step.readyDetail ? ` (${step.readyDetail})` : ''}`
                          : step.readyState === 'ready'
                            ? 'ready'
                            : 'not ready'}
                      </Typography>
                    )}
                    {step.stopping && (
                      <Typography
                        component="span"
                        variant="caption"
                        color="warning.main"
                        sx={{ ml: 1 }}
                      >
                        stopping…
                      </Typography>
                    )}
                    {step.note && step.status !== 'failed' && (
                      <Typography
                        component="span"
                        variant="caption"
                        color="text.secondary"
                        sx={{ ml: 1 }}
                        title={step.note}
                      >
                        {step.note}
                      </Typography>
                    )}
                  </Typography>
                  {step.status === 'failed' && step.code !== null && (
                    <Typography variant="caption" color="error.main">
                      exit {step.code}
                    </Typography>
                  )}
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ minWidth: 48, textAlign: 'right' }}
                  >
                    {duration(step.startedAt, step.endedAt ?? step.readyAt)}
                  </Typography>
                  {selected.status === 'running' &&
                    (step.status === 'running' ||
                      step.status === 'waiting') && (
                      <Tooltip
                        title={
                          step.stopping
                            ? 'Still not gone - kill it with SIGKILL'
                            : step.status === 'waiting'
                              ? 'Stop waiting - the package goes on'
                              : 'Stop this step - the package goes on'
                        }
                      >
                        <IconButton
                          size="small"
                          color="error"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.electron.commands.stopStep(selected.id, i);
                          }}
                          aria-label={`Stop ${step.name}`}
                          sx={{ p: 0.25 }}
                        >
                          <StopIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  {selected.status !== 'running' && (
                    <Box
                      className="step-actions"
                      sx={{
                        display: 'flex',
                        opacity: step.status === 'failed' ? 1 : 0,
                      }}
                    >
                      <Tooltip title="Run only this step">
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            rerun({ only: i });
                          }}
                          aria-label={`Run only ${step.name}`}
                          sx={{ p: 0.25 }}
                        >
                          <PlayArrowIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                      {i > 0 && selected.steps.length > 1 && (
                        <Tooltip title="Rerun from this step">
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              rerun({ from: i });
                            }}
                            aria-label={`Rerun from ${step.name}`}
                            sx={{ p: 0.25 }}
                          >
                            <ReplayIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  )}
                </Box>
                {step.status === 'failed' &&
                  step.tail &&
                  selectedStep !== i && (
                    <Box
                      component="pre"
                      onClick={() => setSelectedStep(i)}
                      title="Show the full log of this step"
                      sx={{
                        m: 0,
                        ml: 4,
                        mr: 1,
                        mb: 0.5,
                        px: 1,
                        py: 0.5,
                        fontFamily: MONO_FONT,
                        fontSize: 11,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        color: 'error.main',
                        bgcolor: alpha(theme.palette.error.main, 0.07),
                        borderRadius: 1.5,
                        cursor: 'pointer',
                      }}
                    >
                      {step.tail}
                      {step.note && (
                        <Box
                          component="span"
                          sx={{
                            display: 'block',
                            mt: 0.5,
                            color: 'text.primary',
                            fontFamily: 'inherit',
                          }}
                        >
                          Hint: {step.note}
                        </Box>
                      )}
                    </Box>
                  )}
              </Box>
            ))}
          </Box>
        )}

        {selected && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TextField
              size="small"
              placeholder="Filter log lines…"
              value={logFilter}
              onChange={(e) => setLogFilter(e.target.value)}
              sx={{ flex: 1, '& input': { py: 0.5, fontSize: 13 } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 16 }} />
                  </InputAdornment>
                ),
              }}
            />
            <Typography variant="caption" color="text.secondary" noWrap>
              {selectedStep === null
                ? 'all steps'
                : selected.steps[selectedStep]?.name}
            </Typography>
            <Tooltip title={copied ? 'Copied!' : 'Copy log'}>
              <IconButton
                size="small"
                onClick={() => copy(output)}
                aria-label="Copy log"
              >
                {copied ? (
                  <CheckIcon fontSize="small" />
                ) : (
                  <ContentCopyIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          </Box>
        )}
        {selected ? (
          <LogView text={output} filter={logFilter} />
        ) : (
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ textAlign: 'center', maxWidth: 340 }}
            >
              Save the commands you run all the time, group them into packages
              and run a package top to bottom with one click. Logs of every step
              land here.
            </Typography>
          </Box>
        )}
      </Paper>

      <Menu
        anchorEl={groupMenu?.anchor}
        open={!!groupMenu}
        onClose={() => setGroupMenu(null)}
      >
        {groupMenu && (
          <Box sx={{ px: 2, pt: 0.5, pb: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Color
            </Typography>
            <Box
              sx={{
                display: 'flex',
                gap: 0.75,
                mt: 0.5,
                flexWrap: 'wrap',
                maxWidth: 220,
              }}
            >
              <Tooltip title="No color">
                <Box
                  component="button"
                  aria-label="No color"
                  onClick={() => {
                    change(
                      updateGroup(state, groupMenu.group.id, { color: null }),
                    );
                    setGroupMenu(null);
                  }}
                  sx={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    cursor: 'pointer',
                    border: 2,
                    borderColor: groupMenu.group.color
                      ? 'divider'
                      : 'text.primary',
                    bgcolor: 'transparent',
                    p: 0,
                    background: (t) =>
                      `linear-gradient(135deg, transparent 45%, ${t.palette.text.disabled} 45%, ${t.palette.text.disabled} 55%, transparent 55%)`,
                  }}
                />
              </Tooltip>
              {PACKAGE_COLORS.map((c) => (
                <Box
                  key={c}
                  component="button"
                  aria-label={`Color ${c}`}
                  title={c}
                  onClick={() => {
                    change(
                      updateGroup(state, groupMenu.group.id, { color: c }),
                    );
                    setGroupMenu(null);
                  }}
                  sx={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    cursor: 'pointer',
                    p: 0,
                    border: 2,
                    borderColor:
                      groupMenu.group.color === c
                        ? 'text.primary'
                        : 'transparent',
                    bgcolor: PACKAGE_COLOR_HEX[c],
                    outline: 'none',
                  }}
                />
              ))}
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              component="div"
              sx={{ mt: 1.25 }}
            >
              Icon
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 28px)',
                gap: 0.25,
                mt: 0.5,
              }}
            >
              <Tooltip title="No icon">
                <IconButton
                  size="small"
                  aria-label="No icon"
                  onClick={() => {
                    change(
                      updateGroup(state, groupMenu.group.id, { icon: null }),
                    );
                    setGroupMenu(null);
                  }}
                  sx={{
                    width: 28,
                    height: 28,
                    border: 1,
                    borderColor: groupMenu.group.icon
                      ? 'transparent'
                      : 'text.primary',
                  }}
                >
                  <CloseIcon sx={{ fontSize: 15, color: 'text.disabled' }} />
                </IconButton>
              </Tooltip>
              {PACKAGE_ICONS.map((icon) => (
                <Tooltip key={icon} title={packageIconLabel(icon)}>
                  <IconButton
                    size="small"
                    aria-label={`Icon ${packageIconLabel(icon)}`}
                    onClick={() => {
                      change(updateGroup(state, groupMenu.group.id, { icon }));
                      setGroupMenu(null);
                    }}
                    sx={{
                      width: 28,
                      height: 28,
                      border: 1,
                      borderColor:
                        groupMenu.group.icon === icon
                          ? 'text.primary'
                          : 'transparent',
                    }}
                  >
                    <PackageIconView
                      icon={icon}
                      sx={{
                        fontSize: 17,
                        color: groupMenu.group.color
                          ? PACKAGE_COLOR_HEX[groupMenu.group.color]
                          : 'text.secondary',
                      }}
                    />
                  </IconButton>
                </Tooltip>
              ))}
            </Box>
          </Box>
        )}
        <MenuItem
          onClick={() => {
            if (groupMenu) setRenaming(groupMenu.group.id);
            setGroupMenu(null);
          }}
        >
          Rename
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (groupMenu) change(duplicateGroup(state, groupMenu.group.id));
            setGroupMenu(null);
          }}
        >
          Duplicate
        </MenuItem>
        {groupMenu &&
          state.groups
            .filter((g) => canNest(state, groupMenu.group.id, g.id))
            .map((g) => (
              <MenuItem
                key={g.id}
                onClick={() => {
                  change(addPackageLink(state, groupMenu.group.id, g.id));
                  showHint(
                    `\u201c${groupMenu.group.name}\u201d is now a step of \u201c${g.name}\u201d`,
                  );
                  setGroupMenu(null);
                }}
              >
                <Typography variant="body2" noWrap>
                  Add to <b>{g.name}</b>
                </Typography>
              </MenuItem>
            ))}
        <MenuItem
          sx={{ color: 'error.main' }}
          onClick={() => {
            const users = groupMenu
              ? packageUsers(state, groupMenu.group.id)
              : [];
            if (
              groupMenu &&
              ((!groupMenu.group.commands.length && !users.length) ||
                // eslint-disable-next-line no-alert
                window.confirm(
                  `Delete “${groupMenu.group.name}” and its ${groupMenu.group.commands.length} command(s)?${
                    users.length
                      ? `\n\nIt's also a step of ${users.map((u) => `“${u.name}”`).join(', ')} - it will be taken out of ${users.length > 1 ? 'them' : 'it'}.`
                      : ''
                  }`,
                ))
            ) {
              change(removeGroup(state, groupMenu.group.id));
            }
            setGroupMenu(null);
          }}
        >
          Delete package
        </MenuItem>
      </Menu>

      <BottomToast text={hint} onClose={() => setHint(null)} />
      <CommandDialog
        open={!!editing}
        initial={editing?.command || null}
        groupId={editing?.groupId || state.groups[0].id}
        groups={state.groups}
        onClose={() => setEditing(null)}
        onDelete={(id) => {
          change(removeCommand(state, id));
          setEditing(null);
        }}
        onSave={(command, groupId, runNow) => {
          change(saveCommand(state, groupId, command));
          setEditing(null);
          if (runNow) start([command], commandLabel(command));
        }}
      />
    </Box>
  );
}
