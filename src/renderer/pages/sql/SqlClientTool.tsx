// DB Client: pick a database container (Postgres / MySQL / MariaDB / MongoDB in Docker)
// and a database, write SQL - or a mongosh script - (or take it from a note) and run it.
// SQL changes can be tried with a rollback first, and versions of the database - named
// like commits - let you go back.
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
  MenuItem,
  Paper,
  Select,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import FormatAlignLeftIcon from '@mui/icons-material/FormatAlignLeft';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay';
import StopIcon from '@mui/icons-material/Stop';
import RefreshIcon from '@mui/icons-material/Refresh';
import UndoIcon from '@mui/icons-material/Undo';
import RestoreIcon from '@mui/icons-material/Restore';
import BookmarkAddOutlinedIcon from '@mui/icons-material/BookmarkAddOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import TableChartOutlinedIcon from '@mui/icons-material/TableChartOutlined';
import NotesIcon from '@mui/icons-material/DescriptionOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import type { SqlResult } from '../../../main/sqlTools';
import { changesData } from '../../../main/sqlTools';
import {
  mongoBrowse,
  mongoChanges,
  mongoStatementAt,
} from '../../../main/mongoTools';
import type { Snapshot } from '../../../main/sqlRunner';
import CodeArea from '../notes/CodeArea';
import BottomToast from '../notes/BottomToast';
import { MONO_FONT } from '../notes/highlight';
import NotePicker, { noteText } from '../../components/NotePicker';
import { SQL_SETTINGS_KEY, statementAt, toCsv } from './sqlModel';
import { checkSql, formatSql, repairSql } from '../notes/sqlTools';

interface Target {
  id: string;
  name: string;
  kind: string;
  running: boolean;
  project: string | null;
}

interface Saved {
  container: string;
  db: string;
  schema: string; // postgres
  text: string; // SQL
  mongoText: string; // the mongosh script, kept apart from the SQL
  dryRun: boolean;
  autoVersion: boolean;
  logins: Record<string, { user: string; password: string }>; // typed in, by container
}

const KIND_LABEL: Record<string, string> = {
  postgres: 'Postgres',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  mongo: 'MongoDB',
};

const ago = (at: number) => {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(at).toLocaleString();
};
const sizeText = (n: number) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} KB`
    : `${(n / 1024 / 1024).toFixed(1)} MB`;

export default function SqlClientTool() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [targetsLoaded, setTargetsLoaded] = useState(false);
  const [saved, setSaved] = useState<Saved>({
    container: '',
    db: '',
    schema: '',
    text: '',
    mongoText: '',
    dryRun: false,
    autoVersion: true,
    logins: {},
  });
  const [schemas, setSchemas] = useState<string[]>([]);
  const [dbError, setDbError] = useState<string | null>(null);
  const [connKey, setConnKey] = useState(0); // bump to connect again
  const [loginDialog, setLoginDialog] = useState<{
    user: string;
    password: string;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [versions, setVersions] = useState<Snapshot[]>([]);
  const [result, setResult] = useState<SqlResult | null>(null);
  const [ran, setRan] = useState('');
  const [busy, setBusy] = useState<string | null>(null); // what is happening right now
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null,
  );
  const [fromNote, setFromNote] = useState(false);
  const [nameDialog, setNameDialog] = useState<{
    file?: string;
    name: string;
  } | null>(null);
  const [restoreAsk, setRestoreAsk] = useState<Snapshot | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const runId = useRef('');
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const say = (text: string, error = false) => {
    setToast({ text, error });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 4000);
  };

  // ---------------- saved state ----------------
  useEffect(() => {
    window.electron.database
      .getAllSettings()
      .then((s) => {
        try {
          const v = JSON.parse(s?.[SQL_SETTINGS_KEY] || '{}');
          setSaved((cur) => ({
            ...cur,
            container: String(v.container || ''),
            db: String(v.db || ''),
            schema: String(v.schema || ''),
            logins: v.logins && typeof v.logins === 'object' ? v.logins : {},
            text: String(v.text || ''),
            mongoText: String(v.mongoText || ''),
            dryRun: !!v.dryRun,
            autoVersion: v.autoVersion !== false,
          }));
        } catch (e) {
          // start empty
        }
      })
      .finally(() => setLoaded(true));
  }, []);
  const update = useCallback((patch: Partial<Saved>) => {
    setSaved((cur) => {
      const next = { ...cur, ...patch };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(
        () =>
          window.electron.database.setSetting(
            SQL_SETTINGS_KEY,
            JSON.stringify(next),
          ),
        500,
      );
      return next;
    });
  }, []);

  // ---------------- containers, databases, tables, versions ----------------
  const loadTargets = useCallback(async () => {
    const r = await window.electron.sql.targets();
    setTargets(r.targets);
    setTargetsError(r.error);
    setTargetsLoaded(true);
  }, []);
  useEffect(() => {
    loadTargets();
  }, [loadTargets]);

  const target = targets.find((t) => t.name === saved.container) || null;

  const isPostgres = target?.kind === 'postgres';
  const isMongo = target?.kind === 'mongo';
  // the script of this kind: SQL, or mongosh for MongoDB
  const text = isMongo ? saved.mongoText : saved.text;
  const setText = (t: string) =>
    update(isMongo ? { mongoText: t } : { text: t });
  const dryRun = saved.dryRun && !isMongo;
  useEffect(() => {
    setDbError(null);
    if (!target?.running) {
      setDatabases([]);
      return;
    }
    (async () => {
      // a user / password typed in for this container goes first
      const login = saved.logins[target.name];
      await window.electron.sql.setLogin(
        target.name,
        login?.user || '',
        login?.password || '',
      );
      const r = await window.electron.sql.databases(target.name);
      setDatabases(r.databases);
      setDbError(r.error);
      if ((!saved.db || !r.databases.includes(saved.db)) && r.databases.length)
        update({ db: r.databases[0] });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.name, target?.running, connKey]);

  // postgres: the schemas of the database, "public" first
  useEffect(() => {
    if (!target?.running || !saved.db || !isPostgres) {
      setSchemas([]);
      return;
    }
    window.electron.sql.schemas(target.name, saved.db).then((list) => {
      setSchemas(list);
      if (list.length && !list.includes(saved.schema))
        update({ schema: list.includes('public') ? 'public' : list[0] });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.name, target?.running, saved.db, isPostgres, connKey]);

  const schema = isPostgres ? saved.schema || 'public' : undefined;
  const loadTables = useCallback(() => {
    if (!target?.running || !saved.db) {
      setTables([]);
      return;
    }
    window.electron.sql.tables(target.name, saved.db, schema).then(setTables);
  }, [target?.name, target?.running, saved.db, schema]);
  useEffect(loadTables, [loadTables]);

  const loadVersions = useCallback(() => {
    if (!saved.container || !saved.db) {
      setVersions([]);
      return;
    }
    window.electron.sql.snapshots(saved.container, saved.db).then(setVersions);
  }, [saved.container, saved.db]);
  useEffect(loadVersions, [loadVersions]);

  // ---------------- running ----------------
  const ready = !!target?.running && !!saved.db;

  const saveVersion = async (name: string, auto: boolean) => {
    if (!target) return false;
    setBusy(auto ? 'Saving a version before the change…' : 'Saving a version…');
    const r = await window.electron.sql.snapshot(
      target.name,
      saved.db,
      name,
      auto,
    );
    setBusy(null);
    loadVersions();
    if (!r.ok) say(`Version not saved: ${r.error}`, true);
    else if (!auto) say(`Saved version "${name || 'unnamed'}"`);
    return r.ok;
  };

  const run = async (sql: string) => {
    if (!target) {
      say('Pick a database container first', true);
      return;
    }
    if (!target.running) {
      say(`Start ${target.name} first (Docker)`, true);
      return;
    }
    if (!sql.trim()) {
      say('Nothing to run', true);
      return;
    }
    const change = isMongo ? mongoChanges(sql) : changesData(sql);
    if (change && !dryRun && saved.autoVersion) {
      const ok = await saveVersion(
        `Before: ${sql.replace(/\s+/g, ' ').trim().slice(0, 80)}`,
        true,
      );
      // eslint-disable-next-line no-alert
      if (
        !ok &&
        !window.confirm('Could not save a version first. Run it anyway?')
      )
        return;
    }
    runId.current = `sql-${Date.now()}`;
    setBusy(dryRun ? 'Running (will roll back)…' : 'Running…');
    setRan(sql);
    const r = await window.electron.sql.run(
      runId.current,
      target.name,
      saved.db,
      sql,
      dryRun,
      schema,
    );
    setBusy(null);
    setResult(r);
    if (change && !dryRun) loadTables();
  };

  const runAtCursor = (el: HTMLTextAreaElement | null) => {
    const at = el?.selectionStart ?? text.length;
    const stmt = isMongo ? mongoStatementAt(text, at) : statementAt(text, at);
    const selected =
      el && el.selectionEnd > el.selectionStart
        ? text.slice(el.selectionStart, el.selectionEnd)
        : '';
    run(selected || stmt?.text || '');
  };
  const editorRef = useRef<HTMLDivElement>(null);
  const textarea = () => editorRef.current?.querySelector('textarea') || null;

  const restore = async (v: Snapshot) => {
    if (!target) return;
    setRestoreAsk(null);
    setBusy(`Going back to "${v.name || ago(v.at)}"…`);
    const r = await window.electron.sql.restore(target.name, saved.db, v.file);
    setBusy(null);
    if (r.ok) {
      say(`Database is back at "${v.name || new Date(v.at).toLocaleString()}"`);
      loadTables();
    } else say(`Restore failed: ${r.error}`, true);
  };

  const saveAsNote = async () => {
    if (!text.trim()) return;
    const first = text
      .trim()
      .split('\n')[0]
      .replace(/^(--|\/\/)\s*/, '')
      .slice(0, 60);
    await window.electron.database.createNote({
      title: first || (isMongo ? 'MongoDB' : 'SQL'),
      // a mongosh script goes in a markdown note, as a code block
      content: isMongo ? `\`\`\`js\n${text.trim()}\n\`\`\`\n` : text,
      format: isMongo ? 'markdown' : 'sql',
      tags: [],
      notebook: '',
      pinned: false,
    });
    say(isMongo ? 'Saved as a note' : 'Saved as an SQL note');
  };

  // checked as you type: unbalanced brackets, unterminated strings / comments
  const check = useMemo(
    () => (text.trim() && !isMongo ? checkSql(text) : { ok: true as const }),
    [text, isMongo],
  );
  const tryFix = () => {
    const fixed = repairSql(text);
    setText(fixed.text);
    say(
      fixed.fixes.length
        ? `${fixed.fixes.join(' · ')}${fixed.ok ? '' : ' - still something to look at'}`
        : 'Nothing to fix',
      !fixed.ok,
    );
  };

  const columnsWidth = useMemo(
    () =>
      (result?.columns || []).map((c) =>
        Math.min(320, Math.max(80, c.length * 9)),
      ),
    [result],
  );

  if (!loaded) return null;

  return (
    <Box
      sx={{
        height: '100%',
        display: 'grid',
        gridTemplateColumns: '290px minmax(0, 1fr)',
        gap: 1.5,
        minHeight: 0,
      }}
    >
      {/* ---------------- left: where, tables, versions ---------------- */}
      <Paper
        sx={{
          p: 1.25,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          minHeight: 0,
        }}
      >
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <Select
            size="small"
            fullWidth
            displayEmpty
            sx={{ minWidth: 0 }}
            value={target ? target.name : ''}
            onChange={(e) =>
              update({ container: String(e.target.value), db: '' })
            }
            inputProps={{ 'aria-label': 'Database container' }}
          >
            <MenuItem value="" disabled>
              Database container
            </MenuItem>
            {targets.map((t) => (
              <MenuItem key={t.id} value={t.name}>
                {t.name}
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 1 }}
                >
                  {KIND_LABEL[t.kind] || t.kind}
                  {t.running ? '' : ' · stopped'}
                </Typography>
              </MenuItem>
            ))}
          </Select>
          <Tooltip title="Look for containers again">
            <IconButton
              size="small"
              onClick={loadTargets}
              aria-label="Refresh containers"
              sx={{ flexShrink: 0 }}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        {targetsError && <Alert severity="warning">{targetsError}</Alert>}
        {targetsLoaded && !targetsError && !targets.length && (
          <Typography variant="body2" color="text.secondary">
            No Postgres / MySQL / MariaDB / MongoDB containers. Start one
            (Docker) and refresh.
          </Typography>
        )}
        {target && !target.running && (
          <Alert severity="info">
            {target.name} is stopped - start it in Docker.
          </Alert>
        )}
        <Select
          size="small"
          fullWidth
          displayEmpty
          disabled={!databases.length}
          value={databases.includes(saved.db) ? saved.db : ''}
          onChange={(e) => update({ db: String(e.target.value) })}
          inputProps={{ 'aria-label': 'Database' }}
        >
          <MenuItem value="" disabled>
            Database
          </MenuItem>
          {databases.map((d) => (
            <MenuItem key={d} value={d}>
              {d}
            </MenuItem>
          ))}
        </Select>

        {isPostgres && schemas.length > 0 && (
          <Select
            size="small"
            fullWidth
            value={schemas.includes(saved.schema) ? saved.schema : ''}
            onChange={(e) => update({ schema: String(e.target.value) })}
            inputProps={{ 'aria-label': 'Schema' }}
            renderValue={(v) => `schema: ${v}`}
          >
            {schemas.map((x) => (
              <MenuItem key={x} value={x}>
                {x}
              </MenuItem>
            ))}
          </Select>
        )}
        {dbError && (
          <Alert
            severity="error"
            sx={{
              fontSize: 12,
              '& .MuiAlert-message': { wordBreak: 'break-word' },
            }}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => setConnKey((k) => k + 1)}
              >
                Retry
              </Button>
            }
          >
            {dbError}
          </Alert>
        )}
        {target && (
          <Button
            size="small"
            sx={{ alignSelf: 'flex-start', p: 0, minWidth: 0 }}
            onClick={() =>
              setLoginDialog({
                user: saved.logins[target.name]?.user || '',
                password: saved.logins[target.name]?.password || '',
              })
            }
          >
            {saved.logins[target.name]?.user
              ? `Connection: ${saved.logins[target.name].user}`
              : 'Connection…'}
          </Button>
        )}
        <Typography variant="overline" color="text.secondary" sx={{ mt: 0.5 }}>
          {isMongo ? 'Collections' : 'Tables'}{' '}
          {tables.length ? `(${tables.length})` : ''}
        </Typography>
        <Box sx={{ flex: 1, minHeight: 80, overflow: 'auto' }}>
          {tables.map((t) => (
            <Box
              key={t}
              onClick={() => {
                const name =
                  schema && schema !== 'public' ? `${schema}.${t}` : t;
                const q = isMongo
                  ? mongoBrowse(t)
                  : `SELECT * FROM ${name} LIMIT 100;`;
                setText(
                  text.trim() ? `${text.replace(/\s*$/, '')}\n\n${q}` : q,
                );
                run(q);
              }}
              title={
                isMongo
                  ? 'Show the first 100 documents'
                  : 'Show the first 100 rows'
              }
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                px: 0.75,
                py: 0.3,
                borderRadius: 1,
                cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <TableChartOutlinedIcon
                sx={{ fontSize: 15, color: 'text.secondary' }}
              />
              <Typography
                variant="body2"
                noWrap
                sx={{ fontFamily: MONO_FONT, fontSize: 12.5 }}
              >
                {t}
              </Typography>
            </Box>
          ))}
        </Box>

        <Divider />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title="Versions of this database - go back to one, name them">
            <span style={{ flex: 1 }}>
              <Button
                size="small"
                startIcon={<RestoreIcon />}
                disabled={!saved.container || !saved.db}
                onClick={() => setVersionsOpen(true)}
                sx={{ justifyContent: 'flex-start' }}
                fullWidth
              >
                Versions{versions.length ? ` (${versions.length})` : ''}
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Save the database as it is now - like a commit you can go back to">
            <span>
              <IconButton
                size="small"
                disabled={!ready || !!busy}
                onClick={() => setNameDialog({ name: '' })}
                aria-label="Save version"
              >
                <BookmarkAddOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Paper>

      {/* ---------------- right: SQL + result ---------------- */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr) minmax(0, 1.2fr)',
          gap: 1.5,
          minHeight: 0,
          // a wide result scrolls inside its panel instead of widening the app
          minWidth: 0,
        }}
      >
        <Paper
          sx={{
            p: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
          }}
        >
          <Tooltip title="Run the statement under the cursor, or the selection (Ctrl/⌘+Enter)">
            <span>
              <Button
                variant="contained"
                size="small"
                startIcon={<PlayArrowIcon />}
                disabled={!!busy}
                onClick={() => runAtCursor(textarea())}
              >
                Run
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Run the whole script">
            <span>
              <Button
                size="small"
                startIcon={<PlaylistPlayIcon />}
                disabled={!!busy}
                onClick={() => run(text)}
              >
                Run all
              </Button>
            </span>
          </Tooltip>
          {busy && (
            <Button
              size="small"
              color="error"
              startIcon={<StopIcon />}
              onClick={() => window.electron.sql.cancel(runId.current)}
            >
              Stop
            </Button>
          )}
          <Tooltip
            title={
              isMongo
                ? 'Not for MongoDB - save a version first instead (it is made on its own before changes)'
                : 'Run it in a transaction that is rolled back: see the result, keep nothing (MySQL keeps CREATE / ALTER / DROP anyway)'
            }
          >
            <FormControlLabel
              disabled={isMongo}
              control={
                <Switch
                  size="small"
                  checked={dryRun}
                  onChange={(e) => update({ dryRun: e.target.checked })}
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <UndoIcon sx={{ fontSize: 16 }} />
                  <Typography variant="body2">Dry run (rollback)</Typography>
                </Box>
              }
            />
          </Tooltip>
          <Box sx={{ flex: 1 }} />
          {!check.ok && (
            <Tooltip title="Close strings / comments, balance ( ), drop dangling commas, format">
              <Chip
                size="small"
                color="warning"
                icon={<AutoFixHighIcon />}
                label={`Line ${check.line}: ${check.error} · Try fix`}
                onClick={tryFix}
              />
            </Tooltip>
          )}
          {!isMongo && (
            <Tooltip title="Format the SQL">
              <span>
                <IconButton
                  size="small"
                  disabled={!text.trim()}
                  onClick={() => setText(formatSql(text))}
                  aria-label="Format SQL"
                >
                  <FormatAlignLeftIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
          {target && saved.db && (
            <Chip
              size="small"
              variant="outlined"
              label={`${target.name} · ${saved.db}`}
              sx={{ fontFamily: MONO_FONT, fontSize: 11 }}
            />
          )}
          <Tooltip
            title={
              isMongo
                ? 'Optional: put the text of a note in'
                : 'Optional: put the SQL of a note in'
            }
          >
            <Button
              size="small"
              startIcon={<NotesIcon />}
              onClick={() => setFromNote(true)}
            >
              From note…
            </Button>
          </Tooltip>
          <Tooltip
            title={
              isMongo
                ? 'Save this script as a note'
                : 'Save this script as an SQL note'
            }
          >
            <span>
              <IconButton
                size="small"
                disabled={!text.trim()}
                onClick={saveAsNote}
                aria-label="Save as note"
              >
                <SaveOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Paper>

        <Box
          ref={editorRef}
          sx={{ minHeight: 0, overflow: 'auto' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              runAtCursor(e.target as HTMLTextAreaElement);
            }
          }}
        >
          <CodeArea
            value={text}
            onChange={setText}
            language={isMongo ? 'javascript' : 'sql'}
            minHeight="100%"
            ariaLabel={isMongo ? 'MongoDB script' : 'SQL'}
            errorLine={check.ok ? undefined : check.line}
            placeholder={
              isMongo
                ? '// Ctrl/⌘+Enter runs the statement under the cursor - its value is shown\ndb.users.find({ active: true }).limit(10)'
                : '-- Ctrl/⌘+Enter runs the statement under the cursor\nSELECT * FROM users LIMIT 10;'
            }
          />
        </Box>

        <Paper
          sx={{
            p: 1.25,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            minWidth: 0,
          }}
        >
          {busy && (
            <Box
              sx={{ display: 'flex', alignItems: 'center', gap: 1, m: 'auto' }}
            >
              <CircularProgress size={16} />
              <Typography variant="body2">{busy}</Typography>
            </Box>
          )}
          {!busy && !result && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ m: 'auto' }}
            >
              {ready
                ? 'Run a query to see the rows here.'
                : 'Pick a database container and a database on the left.'}
            </Typography>
          )}
          {!busy && result && (
            <>
              <Box
                sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}
              >
                <Chip
                  size="small"
                  color={result.ok ? 'success' : 'error'}
                  label={result.ok ? result.message : 'Error'}
                />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ flex: 1, fontFamily: MONO_FONT }}
                >
                  {result.timeMs} ms
                  {result.truncated
                    ? ` · first ${result.rows.length} rows shown`
                    : ''}{' '}
                  · {ran.replace(/\s+/g, ' ').slice(0, 120)}
                </Typography>
                {!!result.columns.length && (
                  <Tooltip title="Copy the rows as CSV">
                    <IconButton
                      size="small"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          toCsv(result.columns, result.rows),
                        );
                        say('Copied as CSV');
                      }}
                      aria-label="Copy as CSV"
                    >
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
              {!result.ok && (
                <Alert
                  severity="error"
                  sx={{
                    whiteSpace: 'pre-wrap',
                    fontFamily: MONO_FONT,
                    fontSize: 12,
                  }}
                  action={
                    /syntax|unterminated|parse|near/i.test(result.message) ? (
                      <Button
                        color="inherit"
                        size="small"
                        startIcon={<AutoFixHighIcon />}
                        onClick={tryFix}
                      >
                        Try fix
                      </Button>
                    ) : undefined
                  }
                >
                  {result.message}
                </Alert>
              )}
              {result.ok && !!result.columns.length && (
                <Box
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    minWidth: 0,
                    maxWidth: '100%',
                    overflow: 'auto',
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                  }}
                >
                  <Box
                    component="table"
                    sx={{
                      borderCollapse: 'collapse',
                      fontFamily: MONO_FONT,
                      fontSize: 12.5,
                      '& th, & td': {
                        borderBottom: 1,
                        borderRight: 1,
                        borderColor: 'divider',
                        px: 1,
                        py: 0.4,
                        textAlign: 'left',
                        whiteSpace: 'nowrap',
                        maxWidth: 420,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      },
                      '& th': {
                        position: 'sticky',
                        top: 0,
                        bgcolor: 'background.paper',
                        fontWeight: 700,
                        zIndex: 1,
                      },
                      '& tr:hover td': { bgcolor: 'action.hover' },
                    }}
                  >
                    <thead>
                      <tr>
                        <Box
                          component="th"
                          sx={{ color: 'text.disabled', width: 40 }}
                        >
                          #
                        </Box>
                        {result.columns.map((c, i) => (
                          // eslint-disable-next-line react/no-array-index-key
                          <th key={i} style={{ minWidth: columnsWidth[i] }}>
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, i) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <tr key={i}>
                          <Box component="td" sx={{ color: 'text.disabled' }}>
                            {i + 1}
                          </Box>
                          {row.map((cell, j) => (
                            // eslint-disable-next-line react/no-array-index-key
                            <td key={j} title={cell}>
                              {cell === '' || cell === 'NULL' ? (
                                <Box
                                  component="span"
                                  sx={{ color: 'text.disabled' }}
                                >
                                  {cell === '' ? '' : 'NULL'}
                                </Box>
                              ) : (
                                cell
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </Box>
                </Box>
              )}
            </>
          )}
        </Paper>
      </Box>

      {/* ---------------- dialogs ---------------- */}
      <Dialog
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ flex: 1 }}>
            Versions of {saved.db || 'the database'}
            <Typography variant="body2" color="text.secondary">
              {target?.name} · like commits: save one, go back to any
            </Typography>
          </Box>
          <Button
            size="small"
            variant="contained"
            startIcon={<BookmarkAddOutlinedIcon />}
            disabled={!ready || !!busy}
            onClick={() => setNameDialog({ name: '' })}
          >
            Save version
          </Button>
        </DialogTitle>
        <DialogContent>
          <FormControlLabel
            sx={{ ml: 0 }}
            control={
              <Switch
                size="small"
                checked={saved.autoVersion}
                onChange={(e) => update({ autoVersion: e.target.checked })}
              />
            }
            label={
              <Typography variant="caption">
                Save a version before every change
              </Typography>
            }
          />
          <Box sx={{ maxHeight: 420, overflow: 'auto', mt: 1 }}>
            {!versions.length && (
              <Typography variant="caption" color="text.secondary">
                No versions of this database yet.
              </Typography>
            )}
            {versions.map((v) => (
              <Box
                key={v.file}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  py: 0.4,
                  '&:hover .v-actions': { opacity: 1 },
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap title={v.name}>
                    {v.name || 'Unnamed version'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {ago(v.at)} · {sizeText(v.size)}
                    {v.auto ? ' · auto' : ''}
                  </Typography>
                </Box>
                <Box
                  className="v-actions"
                  sx={{ display: 'flex', opacity: 0.6 }}
                >
                  <Tooltip title="Go back to this version">
                    <span>
                      <IconButton
                        size="small"
                        disabled={!ready || !!busy}
                        onClick={() => setRestoreAsk(v)}
                        aria-label={`Restore ${v.name}`}
                      >
                        <RestoreIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Name it (named versions are kept)">
                    <IconButton
                      size="small"
                      onClick={() =>
                        setNameDialog({ file: v.file, name: v.name })
                      }
                      aria-label={`Rename ${v.name}`}
                    >
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete this version">
                    <IconButton
                      size="small"
                      onClick={async () => {
                        await window.electron.sql.deleteSnapshot(v.file);
                        loadVersions();
                      }}
                      aria-label={`Delete ${v.name}`}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVersionsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!loginDialog}
        onClose={() => setLoginDialog(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Connection to {target?.name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Stackrun logs in with the container&apos;s own settings
            (POSTGRES_USER, MYSQL_ROOT_PASSWORD, MONGO_INITDB_ROOT_USERNAME…).
            When those do not work, type the user here.
          </Typography>
          <TextField
            fullWidth
            size="small"
            label="User"
            value={loginDialog?.user || ''}
            onChange={(e) =>
              setLoginDialog((d) => (d ? { ...d, user: e.target.value } : d))
            }
            sx={{ mb: 1.5 }}
            autoFocus
          />
          <TextField
            fullWidth
            size="small"
            label="Password"
            type="password"
            value={loginDialog?.password || ''}
            onChange={(e) =>
              setLoginDialog((d) =>
                d ? { ...d, password: e.target.value } : d,
              )
            }
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              if (!target) return;
              const logins = { ...saved.logins };
              delete logins[target.name];
              update({ logins });
              setLoginDialog(null);
              setConnKey((k) => k + 1);
            }}
            sx={{ mr: 'auto' }}
          >
            Use the container&apos;s
          </Button>
          <Button onClick={() => setLoginDialog(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (!target || !loginDialog) return;
              update({
                logins: { ...saved.logins, [target.name]: loginDialog },
              });
              setLoginDialog(null);
              setConnKey((k) => k + 1);
            }}
          >
            Connect
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!nameDialog}
        onClose={() => setNameDialog(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {nameDialog?.file ? 'Name this version' : 'Save a version'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {nameDialog?.file
              ? 'Named versions are kept until you delete them.'
              : `A copy of "${saved.db}" as it is now. You can go back to it at any time.`}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Name"
            placeholder="before the users migration"
            value={nameDialog?.name || ''}
            onChange={(e) =>
              setNameDialog((d) => (d ? { ...d, name: e.target.value } : d))
            }
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNameDialog(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={async () => {
              const d = nameDialog;
              setNameDialog(null);
              if (!d) return;
              if (d.file) {
                await window.electron.sql.renameSnapshot(d.file, d.name);
                loadVersions();
              } else await saveVersion(d.name, false);
            }}
          >
            {nameDialog?.file ? 'Save name' : 'Save version'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!restoreAsk}
        onClose={() => setRestoreAsk(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Go back to this version?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            <b>{saved.db}</b> in <b>{target?.name}</b> is emptied and loaded
            from &quot;
            {restoreAsk?.name ||
              (restoreAsk && new Date(restoreAsk.at).toLocaleString())}
            &quot;. Everything changed since then is lost
            {saved.autoVersion
              ? ' (a version of the current state is saved first)'
              : ''}
            .
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestoreAsk(null)}>Cancel</Button>
          <Button
            color="warning"
            variant="contained"
            onClick={async () => {
              const v = restoreAsk;
              if (!v) return;
              if (saved.autoVersion)
                await saveVersion(
                  `Before going back to: ${v.name || ago(v.at)}`,
                  true,
                );
              restore(v);
            }}
          >
            Go back
          </Button>
        </DialogActions>
      </Dialog>

      <NotePicker
        open={fromNote}
        title={isMongo ? 'Script from a note' : 'SQL from a note'}
        prefer={isMongo ? undefined : 'sql'}
        onClose={() => setFromNote(false)}
        onPick={(note) => {
          setFromNote(false);
          const sql = noteText(
            note,
            isMongo ? '(?:javascript|js|mongo)' : 'sql',
          );
          setText(text.trim() ? `${text.replace(/\s*$/, '')}\n\n${sql}` : sql);
          say(`Added the text of "${note.title || 'Untitled'}"`);
        }}
      />
      <BottomToast
        text={toast?.text || null}
        error={toast?.error}
        onClose={() => setToast(null)}
      />
    </Box>
  );
}
