import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import FormatAlignLeftIcon from '@mui/icons-material/FormatAlignLeft';
import CheckIcon from '@mui/icons-material/Check';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import CloseIcon from '@mui/icons-material/Close';
import AutoFixHighOutlinedIcon from '@mui/icons-material/AutoFixHighOutlined';
import UndoIcon from '@mui/icons-material/Undo';
import CodeArea from './CodeArea';
import DiffView from './DiffView';
import {
  diffJson,
  formatJson,
  parseJson,
  repairJson,
  JsonDifference,
} from './jsonTools';
import { checkSql, formatSql, normalizeSql, repairSql } from './sqlTools';
import { Note, NoteFormat } from './notesModel';
import { MONO_FONT } from './highlight';
import useCopy from './useCopy';

// Compare two documents - JSON (e.g. API responses from the browser), SQL (two versions of
// a query) or plain text. Both sides are editable. JSON and SQL are normalised before the
// diff, so formatting, key order (JSON, optional) and keyword case / whitespace (SQL)
// don't show up as differences. JSON can also be compared by path.

type Kind = 'json' | 'sql' | 'text';

const preview = (value: unknown) => {
  const text = JSON.stringify(value);
  if (text === undefined) return 'undefined';
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
};

const validate = (kind: Kind, value: string) => {
  if (!value.trim()) return { ok: true, message: ' ', line: undefined };
  if (kind === 'json') {
    const p = parseJson(value);
    return p.ok
      ? { ok: true, message: 'Valid JSON', line: undefined }
      : { ok: false, message: p.error, line: p.line };
  }
  if (kind === 'sql') {
    const c = checkSql(value);
    return c.ok
      ? { ok: true, message: 'Brackets and quotes balanced', line: undefined }
      : { ok: false, message: `${c.error} (line ${c.line})`, line: c.line };
  }
  return {
    ok: true,
    message: `${value.split('\n').length} lines`,
    line: undefined,
  };
};

const prettify = (kind: Kind, value: string) => {
  if (kind === 'json') {
    const p = parseJson(value);
    return p.ok ? formatJson(p.value) : null;
  }
  if (kind === 'sql') return formatSql(value);
  return null;
};

function Side({
  label,
  kind,
  value,
  onChange,
  notes,
  onSaveAsNote,
}: {
  label: string;
  kind: Kind;
  value: string;
  onChange: (v: string) => void;
  notes: Note[];
  onSaveAsNote: (content: string, title: string, format?: NoteFormat) => void;
}) {
  const status = validate(kind, value);
  const { copy, copied } = useCopy();
  const [undo, setUndo] = useState<string | null>(null);
  const noteFormat: NoteFormat = kind === 'text' ? 'markdown' : kind;
  const loadable = notes.filter((n) => n.format === noteFormat);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
        <Typography variant="subtitle2" sx={{ mr: 1 }}>
          {label}
        </Typography>
        <Tooltip title="Paste from clipboard">
          <IconButton
            size="small"
            aria-label={`Paste into ${label}`}
            onClick={async () => onChange(await navigator.clipboard.readText())}
          >
            <ContentPasteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {kind !== 'text' && (
          <Tooltip title="Format">
            <span>
              <IconButton
                size="small"
                aria-label={`Format ${label}`}
                disabled={prettify(kind, value) === null || !value.trim()}
                onClick={() => {
                  const next = prettify(kind, value);
                  if (next !== null) onChange(next);
                }}
              >
                <FormatAlignLeftIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {kind !== 'text' && (
          <Tooltip
            title={kind === 'json' ? 'Try to fix' : 'Try to fix (and format)'}
          >
            <span>
              <IconButton
                size="small"
                aria-label={`Try to fix ${label}`}
                disabled={!value.trim()}
                onClick={() => {
                  const result =
                    kind === 'json' ? repairJson(value) : repairSql(value);
                  if (result.ok && result.text !== value) {
                    setUndo(value);
                    onChange(result.text);
                  }
                }}
              >
                <AutoFixHighOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
        {undo !== null && (
          <Tooltip title="Undo fix">
            <IconButton
              size="small"
              aria-label={`Undo fix ${label}`}
              onClick={() => {
                onChange(undo);
                setUndo(null);
              }}
            >
              <UndoIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={copied ? 'Copied!' : 'Copy'}>
          <IconButton
            size="small"
            aria-label={`Copy ${label}`}
            onClick={() => copy(value)}
          >
            {copied ? (
              <CheckIcon fontSize="small" color="success" />
            ) : (
              <ContentCopyIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        {loadable.length > 0 && (
          <Select
            size="small"
            value=""
            displayEmpty
            onChange={(e) => {
              const n = loadable.find((x) => x.id === Number(e.target.value));
              if (n) onChange(n.content);
            }}
            renderValue={() => 'Load note…'}
            sx={{ ml: 'auto', fontSize: '0.8rem', height: 30, minWidth: 120 }}
          >
            {loadable.map((n) => (
              <MenuItem key={n.id} value={n.id}>
                {n.title || 'Untitled'}
              </MenuItem>
            ))}
          </Select>
        )}
        <Button
          size="small"
          disabled={!value.trim() || !status.ok}
          onClick={() =>
            onSaveAsNote(value, `${label} ${kind.toUpperCase()}`, noteFormat)
          }
          sx={{ ml: loadable.length ? 0 : 'auto', whiteSpace: 'nowrap' }}
        >
          Save as note
        </Button>
      </Box>
      <Box sx={{ flex: 1, minHeight: 220 }}>
        <CodeArea
          value={value}
          onChange={onChange}
          language={kind === 'text' ? 'plain' : kind}
          ariaLabel={`${label} ${kind.toUpperCase()}`}
          placeholder={
            {
              json: 'Paste JSON here…',
              sql: 'Paste SQL here…',
              text: 'Paste text here…',
            }[kind]
          }
          errorLine={status.line}
        />
      </Box>
      <Typography
        variant="caption"
        sx={{
          mt: 0.5,
          color: status.ok ? 'text.secondary' : 'error.main',
          minHeight: 20,
        }}
        noWrap
      >
        {status.message}
      </Typography>
    </Box>
  );
}

export default function JsonCompare({
  notes,
  onSaveAsNote,
}: {
  notes: Note[];
  onSaveAsNote: (content: string, title: string, format?: NoteFormat) => void;
}) {
  const theme = useTheme();
  const [kind, setKind] = useState<Kind>('json');
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [sortKeys, setSortKeys] = useState(true);
  const [ignoreComments, setIgnoreComments] = useState(true);
  const [mode, setMode] = useState<'lines' | 'paths'>('lines');
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [diffOpen, setDiffOpen] = useState(false);
  const { copy, copied } = useCopy();

  const normalized = useMemo(() => {
    if (!left.trim() || !right.trim()) return null;
    if (kind === 'json') {
      const a = parseJson(left);
      const b = parseJson(right);
      if (!a.ok || !b.ok) return null;
      return {
        left: formatJson(a.value, 2, sortKeys),
        right: formatJson(b.value, 2, sortKeys),
        differences: diffJson(a.value, b.value) as JsonDifference[] | null,
      };
    }
    if (kind === 'sql') {
      if (!checkSql(left).ok || !checkSql(right).ok) return null;
      return {
        left: normalizeSql(left, ignoreComments),
        right: normalizeSql(right, ignoreComments),
        differences: null,
      };
    }
    return { left, right, differences: null };
  }, [kind, left, right, sortKeys, ignoreComments]);

  const changedLines = useMemo(() => {
    if (!normalized) return 0;
    const a = normalized.left.split('\n');
    const b = normalized.right.split('\n');
    return a.join('\n') === b.join('\n') ? 0 : 1;
  }, [normalized]);

  const kindColor = (d: JsonDifference) =>
    ({
      added: theme.palette.success.main,
      removed: theme.palette.error.main,
      changed: theme.palette.warning.main,
    })[d.kind];

  const byPath = kind === 'json' && mode === 'paths';

  // The differences panel - inline under the editors, or full screen in a dialog
  const diffPanel = (inModal: boolean) => (
    <>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          mb: 1.5,
          flexWrap: 'wrap',
        }}
      >
        <Typography variant="subtitle2">Differences</Typography>
        {normalized && (
          <Typography variant="body2" color="text.secondary">
            {normalized.differences
              ? `${normalized.differences.length || 'No'} difference${normalized.differences.length === 1 ? '' : 's'}`
              : changedLines
                ? ''
                : 'Identical'}
          </Typography>
        )}
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
          {kind === 'json' && (
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={sortKeys}
                  onChange={(e) => setSortKeys(e.target.checked)}
                />
              }
              label={<Typography variant="body2">Ignore key order</Typography>}
            />
          )}
          {kind === 'sql' && (
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={ignoreComments}
                  onChange={(e) => setIgnoreComments(e.target.checked)}
                />
              }
              label={<Typography variant="body2">Ignore comments</Typography>}
            />
          )}
          {!byPath && (
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={onlyChanges}
                  onChange={(e) => setOnlyChanges(e.target.checked)}
                />
              }
              label={<Typography variant="body2">Only changes</Typography>}
            />
          )}
          {kind === 'json' && (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={mode}
              onChange={(_, v) => v && setMode(v)}
            >
              <ToggleButton value="lines">Side by side</ToggleButton>
              <ToggleButton value="paths">By path</ToggleButton>
            </ToggleButtonGroup>
          )}
          {inModal ? (
            <IconButton
              aria-label="Close differences"
              onClick={() => setDiffOpen(false)}
            >
              <CloseIcon />
            </IconButton>
          ) : (
            <Tooltip title="Open the differences full screen">
              <span>
                <IconButton
                  aria-label="Open differences full screen"
                  disabled={!normalized}
                  onClick={() => setDiffOpen(true)}
                >
                  <OpenInFullIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>
      </Box>

      {!normalized && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ py: 3, textAlign: 'center' }}
        >
          {kind === 'text'
            ? 'Paste text on both sides to see the differences.'
            : `Paste valid ${kind.toUpperCase()} on both sides to see the differences.`}
        </Typography>
      )}

      {normalized && !byPath && (
        <DiffView
          left={normalized.left}
          right={normalized.right}
          leftLabel={kind === 'sql' ? 'Left (normalised)' : 'Left'}
          rightLabel={kind === 'sql' ? 'Right (normalised)' : 'Right'}
          onlyChanges={onlyChanges}
          maxHeight={inModal ? '100%' : 420}
        />
      )}

      {normalized && byPath && normalized.differences && (
        <Box
          sx={{
            overflow: 'auto',
            fontFamily: MONO_FONT,
            fontSize: '0.8rem',
            maxHeight: inModal ? undefined : 420,
            flex: inModal ? 1 : undefined,
            minHeight: 0,
          }}
        >
          {normalized.differences.map((d) => (
            <Box
              key={`${d.kind}${d.path}`}
              sx={{
                display: 'grid',
                gridTemplateColumns:
                  '80px minmax(160px, 1fr) minmax(0, 1fr) minmax(0, 1fr) 32px',
                gap: 1.5,
                alignItems: 'center',
                py: 0.5,
                px: 1,
                borderTop: 1,
                borderColor: 'divider',
                '&:first-of-type': { borderTop: 0 },
              }}
            >
              <Box
                sx={{
                  fontFamily: 'inherit',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: kindColor(d),
                  bgcolor: alpha(kindColor(d), 0.1),
                  borderRadius: 1,
                  px: 0.75,
                  textAlign: 'center',
                }}
              >
                {d.kind}
              </Box>
              <Box
                sx={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={d.path}
              >
                {d.path}
              </Box>
              <Box
                sx={{
                  color: 'error.main',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {d.kind === 'added' ? '' : preview(d.left)}
              </Box>
              <Box
                sx={{
                  color: 'success.main',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {d.kind === 'removed' ? '' : preview(d.right)}
              </Box>
              <Tooltip title={copied === d.path ? 'Copied!' : 'Copy path'}>
                <IconButton
                  size="small"
                  onClick={() => copy(d.path, d.path)}
                  aria-label="Copy path"
                >
                  {copied === d.path ? (
                    <CheckIcon sx={{ fontSize: 16 }} color="success" />
                  ) : (
                    <ContentCopyIcon sx={{ fontSize: 16 }} />
                  )}
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </Box>
      )}
    </>
  );

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        height: '100%',
        minHeight: 0,
      }}
    >
      <ToggleButtonGroup
        size="small"
        exclusive
        value={kind}
        onChange={(_, v) => v && setKind(v)}
        aria-label="What to compare"
        sx={{ alignSelf: 'flex-start' }}
      >
        <ToggleButton value="json">JSON</ToggleButton>
        <ToggleButton value="sql">SQL</ToggleButton>
        <ToggleButton value="text">Text</ToggleButton>
      </ToggleButtonGroup>

      <Paper
        sx={{
          p: 2,
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          gap: 1.5,
          minHeight: 320,
        }}
      >
        <Side
          label="Left"
          kind={kind}
          value={left}
          onChange={setLeft}
          notes={notes}
          onSaveAsNote={onSaveAsNote}
        />
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Tooltip title="Swap sides">
            <IconButton
              aria-label="Swap sides"
              onClick={() => {
                setLeft(right);
                setRight(left);
              }}
            >
              <SwapHorizIcon />
            </IconButton>
          </Tooltip>
        </Box>
        <Side
          label="Right"
          kind={kind}
          value={right}
          onChange={setRight}
          notes={notes}
          onSaveAsNote={onSaveAsNote}
        />
      </Paper>

      <Paper
        sx={{
          p: 2,
          flex: 1,
          minHeight: 240,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {diffPanel(false)}
      </Paper>

      <Dialog
        open={diffOpen && !!normalized}
        onClose={() => setDiffOpen(false)}
        fullWidth
        maxWidth="xl"
        PaperProps={{
          sx: {
            height: '92vh',
            p: 2,
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        {diffPanel(true)}
      </Dialog>
    </Box>
  );
}
