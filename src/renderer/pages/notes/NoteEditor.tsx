import React, { useEffect, useRef, useState } from 'react';
import {
  Autocomplete,
  Box,
  Chip,
  Divider,
  IconButton,
  InputBase,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Popover,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import HistoryIcon from '@mui/icons-material/History';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import TitleIcon from '@mui/icons-material/Title';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import CheckBoxOutlinedIcon from '@mui/icons-material/CheckBoxOutlined';
import CodeIcon from '@mui/icons-material/Code';
import LinkIcon from '@mui/icons-material/Link';
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import EditNoteIcon from '@mui/icons-material/EditNote';
import VerticalSplitOutlinedIcon from '@mui/icons-material/VerticalSplitOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import AutoFixHighOutlinedIcon from '@mui/icons-material/AutoFixHighOutlined';
import UndoIcon from '@mui/icons-material/Undo';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import DataObjectIcon from '@mui/icons-material/DataObject';
import CodeArea from './CodeArea';
import MarkdownView from './MarkdownView';
import { Note, NoteFormat, normalizeTag } from './notesModel';
import { formatJson, parseJson, repairJson, sortKeysDeep } from './jsonTools';
import JsonFoldView from './JsonFoldView';
import { checkSql, formatSql, minifySql, repairSql } from './sqlTools';
import { repairMarkdown } from './markdownTools';
import useCopy from './useCopy';

// Editor pane for one note, built to leave the writing area as large as possible:
// one row with the title, notebook/tag chips and actions, one thin toolbar row, and the
// text below. Markdown: Write / Split / Preview with formatting buttons. JSON: highlighted
// editor with validation, Format / Minify / Sort keys. Changes autosave.

type MdView = 'write' | 'split' | 'preview';
const SAVE_DELAY = 700;

const MD_ACTIONS: {
  key: string;
  label: string;
  icon: React.ReactNode;
  apply: (sel: string) => string;
}[] = [
  {
    key: 'bold',
    label: 'Bold',
    icon: <FormatBoldIcon fontSize="small" />,
    apply: (s) => `**${s || 'bold'}**`,
  },
  {
    key: 'italic',
    label: 'Italic',
    icon: <FormatItalicIcon fontSize="small" />,
    apply: (s) => `_${s || 'italic'}_`,
  },
  {
    key: 'heading',
    label: 'Heading',
    icon: <TitleIcon fontSize="small" />,
    apply: (s) => `\n## ${s || 'Heading'}\n`,
  },
  {
    key: 'list',
    label: 'Bulleted list',
    icon: <FormatListBulletedIcon fontSize="small" />,
    apply: (s) =>
      (s || 'item')
        .split('\n')
        .map((l) => `- ${l}`)
        .join('\n'),
  },
  {
    key: 'task',
    label: 'Checklist',
    icon: <CheckBoxOutlinedIcon fontSize="small" />,
    apply: (s) =>
      (s || 'todo')
        .split('\n')
        .map((l) => `- [ ] ${l}`)
        .join('\n'),
  },
  {
    key: 'quote',
    label: 'Quote',
    icon: <FormatQuoteIcon fontSize="small" />,
    apply: (s) =>
      (s || 'quote')
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n'),
  },
  {
    key: 'code',
    label: 'Code block',
    icon: <CodeIcon fontSize="small" />,
    apply: (s) => `\n\`\`\`json\n${s || ''}\n\`\`\`\n`,
  },
  {
    key: 'link',
    label: 'Link',
    icon: <LinkIcon fontSize="small" />,
    apply: (s) => `[${s || 'text'}](https://)`,
  },
];

const smallToggle = { py: 0.25, px: 1, fontSize: '0.75rem' };

export default function NoteEditor({
  note,
  notebooks,
  allTags,
  onChange,
  onDelete,
  onExport,
  onShowHistory,
}: {
  note: Note;
  notebooks: string[];
  allTags: string[];
  onChange: (note: Note) => Promise<void> | void;
  onDelete: () => void;
  onExport: () => void;
  onShowHistory: () => void;
}) {
  const [draft, setDraft] = useState(note);
  const [saving, setSaving] = useState<'saved' | 'pending'>('saved');
  // JSON: edit as code, or browse as a foldable tree
  const [jsonView, setJsonView] = useState<'code' | 'tree'>('code');
  const [fixMessage, setFixMessage] = useState<string | null>(null);
  // Content before the last "fix", so it can be rolled back
  const [beforeFix, setBeforeFix] = useState<string | null>(null);
  const [mdView, setMdView] = useState<MdView>(
    () => (localStorage.getItem('notes_md_view') as MdView) || 'write',
  );
  const [metaAnchor, setMetaAnchor] = useState<HTMLElement | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const { copy, copied } = useCopy();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef(draft);
  latest.current = draft;
  const editorWrap = useRef<HTMLDivElement>(null);

  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    await onChange(latest.current);
    setSaving('saved');
  };

  // Leaving the note (the parent keys this component by note id) saves pending edits
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        onChange(latest.current);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const update = (patch: Partial<Note>, immediate = false) => {
    latest.current = { ...latest.current, ...patch };
    setDraft(latest.current);
    setSaving('pending');
    if (timer.current) clearTimeout(timer.current);
    if (immediate) flush();
    else timer.current = setTimeout(flush, SAVE_DELAY);
  };

  const parsed = draft.format === 'json' ? parseJson(draft.content) : null;
  const sqlCheck = draft.format === 'sql' ? checkSql(draft.content) : null;

  // Code tools per format (Markdown has its own toolbar)
  const codeTools: { key: string; label: string; run: () => string | null }[] =
    [];
  if (draft.format === 'json') {
    const value = parsed?.ok ? parsed.value : undefined;
    const ok = !!parsed?.ok;
    codeTools.push(
      {
        key: 'format',
        label: 'Format',
        run: () => (ok ? formatJson(value) : null),
      },
      {
        key: 'minify',
        label: 'Minify',
        run: () => (ok ? JSON.stringify(value) : null),
      },
      {
        key: 'sort',
        label: 'Sort keys',
        run: () => (ok ? formatJson(sortKeysDeep(value)) : null),
      },
    );
  } else if (draft.format === 'sql') {
    codeTools.push(
      { key: 'format', label: 'Format', run: () => formatSql(draft.content) },
      { key: 'minify', label: 'Minify', run: () => minifySql(draft.content) },
    );
  }

  const applyMd = (action: (typeof MD_ACTIONS)[number]) => {
    const textarea = editorWrap.current?.querySelector('textarea');
    const start = textarea?.selectionStart ?? draft.content.length;
    const end = textarea?.selectionEnd ?? draft.content.length;
    const text = action.apply(draft.content.slice(start, end));
    update({
      content: draft.content.slice(0, start) + text + draft.content.slice(end),
    });
    requestAnimationFrame(() => {
      if (!textarea) return;
      textarea.focus();
      textarea.selectionStart = start + text.length;
      textarea.selectionEnd = start + text.length;
    });
  };

  const setFormat = (format: NoteFormat) => {
    if (format === draft.format) return;
    // To JSON: pretty-print if the text already is JSON
    const p = parseJson(draft.content);
    update(
      {
        format,
        content:
          format === 'json' && p.ok ? formatJson(p.value) : draft.content,
      },
      true,
    );
  };

  // Markdown shortcuts while typing: Ctrl/Cmd+B / I / K
  const onEditorKeyDown = (e: React.KeyboardEvent) => {
    if (draft.format !== 'markdown' || !(e.ctrlKey || e.metaKey)) return;
    const key = { b: 'bold', i: 'italic', k: 'link' }[e.key.toLowerCase()];
    const action = MD_ACTIONS.find((a) => a.key === key);
    if (action) {
      e.preventDefault();
      applyMd(action);
    }
  };

  const flashFix = (text: string) => {
    setFixMessage(text);
    setTimeout(() => setFixMessage(null), 6000);
  };

  // "Try to fix": JSON (almost-JSON -> JSON), SQL (brackets, quotes, commas + format) or
  // Markdown (fences, headings, lists, blank lines). Can be undone.
  const runFix = () => {
    let result: { ok: boolean; text: string; fixes: string[] };
    if (draft.format === 'json') result = repairJson(draft.content);
    else if (draft.format === 'sql') result = repairSql(draft.content);
    else result = repairMarkdown(draft.content);
    if (result.text === draft.content || !result.fixes.length) {
      flashFix(
        result.ok ? 'Nothing to fix' : "Couldn't fix this automatically",
      );
      return;
    }
    if (!result.ok && draft.format === 'json') {
      flashFix("Couldn't fix this automatically");
      return;
    }
    setBeforeFix(draft.content);
    update({ content: result.text });
    flashFix(`Fixed: ${result.fixes.join(', ').toLowerCase()}`);
  };

  const undoFix = () => {
    if (beforeFix === null) return;
    update({ content: beforeFix });
    setBeforeFix(null);
    flashFix('Fix undone');
  };

  const editor = (
    <Box
      ref={editorWrap}
      onKeyDown={onEditorKeyDown}
      sx={{ height: '100%', minHeight: 0 }}
    >
      <CodeArea
        value={draft.content}
        onChange={(content) => {
          setBeforeFix(null);
          update({ content });
        }}
        language={draft.format}
        ariaLabel="Note content"
        placeholder={
          {
            json: '{\n  "paste": "JSON here"\n}',
            sql: 'SELECT …\nFROM …\nWHERE …',
            markdown: 'Write in Markdown…',
          }[draft.format]
        }
        errorLine={(() => {
          if (!draft.content.trim()) return undefined;
          if (parsed && !parsed.ok) return parsed.line;
          if (sqlCheck && !sqlCheck.ok) return sqlCheck.line;
          return undefined;
        })()}
        minHeight={0}
      />
    </Box>
  );

  let codeStatus = '';
  let codeOk = true;
  if (draft.content.trim()) {
    if (parsed) {
      codeOk = parsed.ok;
      codeStatus = parsed.ok ? 'Valid JSON' : parsed.error;
    } else if (sqlCheck) {
      codeOk = sqlCheck.ok;
      codeStatus = sqlCheck.ok
        ? 'Brackets and quotes balanced'
        : `${sqlCheck.error} (line ${sqlCheck.line})`;
    }
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      {/* Row 1: title, notebook/tags, actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <InputBase
          value={draft.title}
          onChange={(e) => update({ title: e.target.value })}
          onBlur={() => timer.current && flush()}
          placeholder="Untitled"
          inputProps={{ 'aria-label': 'Note title' }}
          sx={{ flex: 1, minWidth: 80, fontSize: '1.15rem', fontWeight: 600 }}
        />
        <Box
          onClick={(e) => setMetaAnchor(e.currentTarget)}
          role="button"
          aria-label="Notebook and tags"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            cursor: 'pointer',
            minWidth: 0,
            maxWidth: '45%',
            overflow: 'hidden',
            borderRadius: 1.5,
            px: 0.5,
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Chip
            size="small"
            variant="outlined"
            icon={<FolderOutlinedIcon sx={{ fontSize: 14 }} />}
            label={draft.notebook || 'Notebook'}
            sx={{
              color: draft.notebook ? 'text.primary' : 'text.disabled',
              cursor: 'pointer',
            }}
          />
          {draft.tags.length ? (
            draft.tags.map((t) => (
              <Chip
                key={t}
                size="small"
                label={`#${t}`}
                sx={{ cursor: 'pointer' }}
              />
            ))
          ) : (
            <Chip
              size="small"
              variant="outlined"
              icon={<LocalOfferOutlinedIcon sx={{ fontSize: 14 }} />}
              label="Tags"
              sx={{ color: 'text.disabled', cursor: 'pointer' }}
            />
          )}
        </Box>
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ whiteSpace: 'nowrap', mx: 0.5 }}
        >
          {saving === 'saved' ? 'Saved' : 'Saving…'}
        </Typography>
        <Tooltip title={draft.pinned ? 'Unpin' : 'Pin to top'}>
          <IconButton
            size="small"
            onClick={() => update({ pinned: !draft.pinned }, true)}
            aria-label="Pin note"
          >
            {draft.pinned ? (
              <PushPinIcon fontSize="small" />
            ) : (
              <PushPinOutlinedIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        <Tooltip title="Version history">
          <IconButton
            size="small"
            aria-label="Version history"
            onClick={async () => {
              await flush();
              onShowHistory();
            }}
          >
            <HistoryIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <IconButton
          size="small"
          aria-label="More actions"
          onClick={(e) => setMenuAnchor(e.currentTarget)}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Row 2: format + tools + view */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          my: 0.75,
          minHeight: 30,
          flexWrap: 'wrap',
        }}
      >
        <ToggleButtonGroup
          size="small"
          exclusive
          value={draft.format}
          onChange={(_, v) => v && setFormat(v)}
          aria-label="Note format"
        >
          <ToggleButton value="markdown" sx={smallToggle}>
            MD
          </ToggleButton>
          <ToggleButton value="json" sx={smallToggle}>
            JSON
          </ToggleButton>
          <ToggleButton value="sql" sx={smallToggle}>
            SQL
          </ToggleButton>
        </ToggleButtonGroup>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.75 }} />
        {draft.format === 'markdown' ? (
          <>
            {mdView !== 'preview' &&
              MD_ACTIONS.map((action) => (
                <Tooltip key={action.key} title={action.label}>
                  <IconButton
                    size="small"
                    onClick={() => applyMd(action)}
                    aria-label={action.label}
                    sx={{ p: 0.5 }}
                  >
                    {action.icon}
                  </IconButton>
                </Tooltip>
              ))}
            {fixMessage && (
              <Typography
                variant="caption"
                noWrap
                title={fixMessage}
                sx={{ ml: 1, color: 'success.main', minWidth: 0, flex: 1 }}
              >
                {fixMessage}
              </Typography>
            )}
            <ToggleButtonGroup
              size="small"
              exclusive
              value={mdView}
              onChange={(_, v) => {
                if (!v) return;
                setMdView(v);
                localStorage.setItem('notes_md_view', v);
              }}
              aria-label="Markdown view"
              sx={{ ml: 'auto' }}
            >
              <ToggleButton
                value="write"
                sx={smallToggle}
                aria-label="Write"
                title="Write"
              >
                <EditNoteIcon sx={{ fontSize: 18 }} />
              </ToggleButton>
              <ToggleButton
                value="split"
                sx={smallToggle}
                aria-label="Split"
                title="Split"
              >
                <VerticalSplitOutlinedIcon sx={{ fontSize: 18 }} />
              </ToggleButton>
              <ToggleButton
                value="preview"
                sx={smallToggle}
                aria-label="Preview"
                title="Preview"
              >
                <VisibilityOutlinedIcon sx={{ fontSize: 18 }} />
              </ToggleButton>
            </ToggleButtonGroup>
          </>
        ) : (
          <>
            {codeTools.map((tool) => (
              <ToggleButton
                key={tool.key}
                size="small"
                value={tool.key}
                disabled={tool.run() === null}
                onClick={() => {
                  const next = tool.run();
                  if (next !== null) update({ content: next });
                }}
                sx={{ ...smallToggle, mr: 0.5 }}
              >
                {tool.label}
              </ToggleButton>
            ))}
            <Typography
              variant="caption"
              noWrap
              title={codeStatus}
              sx={{
                ml: 0.5,
                color: codeOk ? 'success.main' : 'error.main',
                minWidth: 0,
                flex: 1,
              }}
            >
              {fixMessage || codeStatus}
            </Typography>
            {draft.format === 'json' && (
              <ToggleButtonGroup
                size="small"
                exclusive
                value={jsonView}
                onChange={(_, v) => v && setJsonView(v)}
                aria-label="JSON view"
              >
                <ToggleButton
                  value="code"
                  sx={smallToggle}
                  aria-label="Code"
                  title="Code (edit)"
                >
                  <DataObjectIcon sx={{ fontSize: 18 }} />
                </ToggleButton>
                <ToggleButton
                  value="tree"
                  sx={smallToggle}
                  aria-label="Tree"
                  title="Tree (fold / unfold)"
                  disabled={!parsed?.ok}
                >
                  <AccountTreeOutlinedIcon sx={{ fontSize: 18 }} />
                </ToggleButton>
              </ToggleButtonGroup>
            )}
          </>
        )}
        <Tooltip title="Try to fix">
          <IconButton
            size="small"
            onClick={runFix}
            aria-label="Try to fix"
            sx={{ p: 0.5, ml: 0.5 }}
          >
            <AutoFixHighOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {beforeFix !== null && (
          <Tooltip title="Undo fix">
            <IconButton
              size="small"
              onClick={undoFix}
              aria-label="Undo fix"
              sx={{ p: 0.5 }}
            >
              <UndoIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={copied ? 'Copied!' : 'Copy content'}>
          <IconButton
            size="small"
            onClick={() => copy(draft.content)}
            aria-label="Copy content"
            sx={{ p: 0.5, ml: 0.5 }}
          >
            {copied ? (
              <CheckIcon fontSize="small" color="success" />
            ) : (
              <ContentCopyIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
      </Box>

      {/* Body */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {draft.format === 'json' && jsonView === 'tree' && parsed?.ok ? (
          <JsonFoldView value={parsed.value} />
        ) : (
          (draft.format !== 'markdown' || mdView === 'write') && editor
        )}
        {draft.format === 'markdown' && mdView === 'preview' && (
          <Box sx={{ height: '100%', overflow: 'auto', pr: 1 }}>
            {draft.content.trim() ? (
              <MarkdownView source={draft.content} />
            ) : (
              <Typography color="text.secondary">
                Nothing to preview yet.
              </Typography>
            )}
          </Box>
        )}
        {draft.format === 'markdown' && mdView === 'split' && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 2,
              height: '100%',
            }}
          >
            {editor}
            <Box sx={{ overflow: 'auto', pr: 1, minWidth: 0 }}>
              <MarkdownView source={draft.content} />
            </Box>
          </Box>
        )}
      </Box>

      {/* Notebook + tags editor */}
      <Popover
        open={!!metaAnchor}
        anchorEl={metaAnchor}
        onClose={() => setMetaAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        PaperProps={{
          sx: {
            p: 2,
            width: 340,
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
          },
        }}
      >
        <Autocomplete
          freeSolo
          size="small"
          options={notebooks}
          value={draft.notebook}
          onChange={(_, v) => update({ notebook: (v || '').trim() }, true)}
          onInputChange={(_, v, reason) =>
            reason === 'input' && update({ notebook: v.trim() })
          }
          renderInput={(params) => (
            <TextField
              {...params}
              autoFocus
              label="Notebook"
              placeholder="e.g. Work, API, Ideas"
            />
          )}
        />
        <Autocomplete
          multiple
          freeSolo
          size="small"
          options={allTags.filter((t) => !draft.tags.includes(t))}
          value={draft.tags}
          onChange={(_, v) =>
            update(
              {
                tags: [
                  ...new Set((v as string[]).map(normalizeTag).filter(Boolean)),
                ],
              },
              true,
            )
          }
          renderTags={(value, getTagProps) =>
            value.map((tag, index) => (
              <Chip
                {...getTagProps({ index })}
                key={tag}
                label={`#${tag}`}
                size="small"
              />
            ))
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label="Tags"
              placeholder="Type and press Enter"
            />
          )}
        />
      </Popover>

      <Menu
        open={!!menuAnchor}
        anchorEl={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          onClick={async () => {
            setMenuAnchor(null);
            await flush();
            onExport();
          }}
        >
          <ListItemIcon>
            <FileDownloadOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {`Export .${draft.format === 'markdown' ? 'md' : draft.format}`}
          </ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            onDelete();
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon>
            <DeleteOutlineIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
}
