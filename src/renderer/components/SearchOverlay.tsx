// Ctrl+K (⌘K on macOS): find a note, a package or command, an HTTP request, or a tool.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Chip,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Modal,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import KeyboardReturnIcon from '@mui/icons-material/KeyboardReturn';
import SearchIcon from '@mui/icons-material/Search';
import StickyNote2OutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import TerminalIcon from '@mui/icons-material/TerminalOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import ApiIcon from '@mui/icons-material/SendOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import {
  ResultKind,
  searchAll,
  SearchResult,
  SearchSources,
} from './searchModel';
import {
  parseState as parseCommands,
  SETTINGS_KEY as COMMANDS_KEY,
} from '../pages/notes/commandsModel';
import {
  parseState as parseHttp,
  SETTINGS_KEY as HTTP_KEY,
} from '../pages/http/httpModel';

export const IS_MAC = /mac/i.test(navigator.platform || navigator.userAgent);
export const SEARCH_SHORTCUT = IS_MAC ? '⌘K' : 'Ctrl K';

const ICONS: Record<ResultKind, React.ReactNode> = {
  tool: <ArrowForwardIcon fontSize="small" />,
  note: <StickyNote2OutlinedIcon fontSize="small" />,
  package: <FolderOutlinedIcon fontSize="small" />,
  command: <TerminalIcon fontSize="small" />,
  request: <ApiIcon fontSize="small" />,
};
const KIND_LABEL: Record<ResultKind, string> = {
  tool: 'Tool',
  note: 'Note',
  package: 'Package',
  command: 'Command',
  request: 'HTTP',
};

export default function SearchOverlay({
  open,
  tools,
  onClose,
  onPick,
}: {
  open: boolean;
  tools: SearchSources['tools'];
  onClose: () => void;
  onPick: (result: SearchResult) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [sources, setSources] = useState<SearchSources | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // fresh data every time it opens: notes / packages / requests may have changed
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    Promise.all([
      window.electron.database.getNotes().catch(() => []),
      window.electron.database
        .getAllSettings()
        .catch(() => ({}) as Record<string, string>),
    ]).then(([notes, settings]) =>
      setSources({
        tools,
        notes: notes || [],
        commands: parseCommands(settings?.[COMMANDS_KEY]),
        http: parseHttp(settings?.[HTTP_KEY]),
      }),
    );
  }, [open, tools]);

  const results = useMemo(
    () => (sources ? searchAll(query, sources) : []),
    [sources, query],
  );
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (r?: SearchResult) => {
    if (!r) return;
    onPick(r);
    onClose();
  };

  // the same look as Thingy's search: blurred backdrop, a big field in the middle
  return (
    <Modal
      open={open}
      onClose={onClose}
      sx={{ backdropFilter: 'blur(4px)', backgroundColor: 'rgba(0,0,0,0.5)' }}
    >
      <Paper
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '60%',
          minWidth: 420,
          maxWidth: 700,
          p: 2,
          outline: 'none',
        }}
      >
        <TextField
          fullWidth
          autoFocus
          variant="standard"
          placeholder="Search notes, commands, HTTP requests..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(results[active]);
            }
          }}
          sx={{
            '& .MuiInput-underline:before': { borderBottom: 'none' },
            '& .MuiInput-underline:after': { borderBottom: 'none' },
            '& .MuiInput-underline:hover:not(.Mui-disabled):before': {
              borderBottom: 'none',
            },
            '& .MuiInputBase-input': { fontSize: '1.5rem', padding: '10px 0' },
          }}
          InputProps={{
            inputProps: { 'aria-label': 'Search' },
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: '2rem', mr: 1 }} />
              </InputAdornment>
            ),
          }}
        />
        {results.length > 0 && (
          <List ref={listRef} sx={{ maxHeight: 400, overflow: 'auto', mt: 1 }}>
            {results.map((r, i) => (
              <ListItemButton
                key={`${r.kind}:${r.id}:${r.title}:${r.detail}`}
                data-index={i}
                selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r)}
                sx={{ borderRadius: 2 }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  {ICONS[r.kind]}
                </ListItemIcon>
                <ListItemText
                  primary={r.title}
                  secondary={r.detail}
                  primaryTypographyProps={{ noWrap: true }}
                  secondaryTypographyProps={{ noWrap: true }}
                />
                {i === active ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.25,
                      ml: 1,
                    }}
                  >
                    <KeyboardReturnIcon fontSize="inherit" /> Enter
                  </Typography>
                ) : (
                  <Chip
                    label={KIND_LABEL[r.kind]}
                    size="small"
                    sx={{ ml: 1 }}
                  />
                )}
              </ListItemButton>
            ))}
          </List>
        )}
        {sources && query.trim() && !results.length && (
          <Box sx={{ p: 2 }}>
            <Typography color="text.secondary">No results found.</Typography>
          </Box>
        )}
      </Paper>
    </Modal>
  );
}
