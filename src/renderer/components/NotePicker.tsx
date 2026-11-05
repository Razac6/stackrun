// "From a note…": pick a note and use its text (an HTTP body, an SQL script...).
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { MONO_FONT } from '../pages/notes/highlight';

export interface PickedNote {
  id: number;
  title: string;
  content: string;
  format: string; // markdown / json / sql
  notebook?: string;
}

/** A fenced ```lang block of a markdown note, or the whole text. */
export const noteText = (note: PickedNote, lang?: string) => {
  if (note.format !== 'markdown' || !lang) return note.content;
  const fence = '```';
  const re = new RegExp(
    `${fence}\\s*${lang}[^\\n]*\\n([\\s\\S]*?)${fence}`,
    'i',
  );
  return re.exec(note.content)?.[1].trim() || note.content;
};

export default function NotePicker({
  open,
  title,
  prefer,
  onClose,
  onPick,
}: {
  open: boolean;
  title: string;
  prefer?: 'json' | 'sql'; // shown first, and the default filter
  onClose: () => void;
  onPick: (note: PickedNote) => void;
}) {
  const [notes, setNotes] = useState<PickedNote[]>([]);
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState<string>(prefer || 'all');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setOnly(prefer || 'all');
    window.electron.database
      .getNotes()
      .then((list) => setNotes(list || []))
      .catch(() => setNotes([]));
  }, [open, prefer]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes
      .filter((n) => only === 'all' || n.format === only)
      .filter(
        (n) =>
          !q ||
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q),
      )
      .sort(
        (a, b) =>
          Number(b.format === prefer) - Number(a.format === prefer) ||
          a.title.localeCompare(b.title),
      );
  }, [notes, query, only, prefer]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
          <TextField
            size="small"
            autoFocus
            fullWidth
            placeholder="Search notes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && shown[0]) onPick(shown[0]);
            }}
            InputProps={{
              inputProps: { 'aria-label': 'Search notes' },
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <ToggleButtonGroup
            size="small"
            exclusive
            value={only}
            onChange={(_, v) => v && setOnly(v)}
          >
            <ToggleButton value="all">All</ToggleButton>
            {prefer && (
              <ToggleButton value={prefer}>{prefer.toUpperCase()}</ToggleButton>
            )}
          </ToggleButtonGroup>
        </Box>
        <List dense sx={{ maxHeight: 420, overflow: 'auto' }}>
          {shown.map((n) => (
            <ListItemButton
              key={n.id}
              onClick={() => onPick(n)}
              sx={{ borderRadius: 2 }}
            >
              <ListItemText
                primary={n.title || 'Untitled'}
                secondary={n.content.replace(/\s+/g, ' ').slice(0, 110)}
                primaryTypographyProps={{ noWrap: true }}
                secondaryTypographyProps={{
                  noWrap: true,
                  sx: { fontFamily: MONO_FONT, fontSize: 11 },
                }}
              />
              <Chip
                size="small"
                label={n.format.toUpperCase()}
                sx={{ ml: 1 }}
              />
            </ListItemButton>
          ))}
          {!shown.length && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              No notes{only !== 'all' ? ` in ${only.toUpperCase()}` : ''}
              {query ? ` with “${query}”` : ''}.
            </Typography>
          )}
        </List>
      </DialogContent>
    </Dialog>
  );
}
