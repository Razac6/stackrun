import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ListItemButton,
  Typography,
} from '@mui/material';
import DiffView from './DiffView';
import { Note } from './notesModel';
import { LiquidLoader } from '../../components/LiquidFill';

// A note's saved versions (newest first) with a diff against the current text.
// Restoring keeps the current text as a version too, so a rollback can be undone.

export interface NoteVersion {
  id: number;
  noteId: number;
  title: string;
  content: string;
  format: string;
  savedAt: string;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function VersionHistoryDialog({
  note,
  open,
  onClose,
  onRestore,
}: {
  note: Note;
  open: boolean;
  onClose: () => void;
  onRestore: (version: NoteVersion) => void;
}) {
  const [versions, setVersions] = useState<NoteVersion[] | null>(null);
  const [selected, setSelected] = useState<NoteVersion | null>(null);

  useEffect(() => {
    if (!open || !note.id) return;
    setVersions(null);
    setSelected(null);
    window.electron.database
      .getNoteVersions(note.id)
      .then((list: NoteVersion[]) => {
        setVersions(list);
        setSelected(list[0] ?? null);
      })
      .catch(() => setVersions([]));
  }, [open, note.id]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>Version history · {note.title || 'Untitled'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', gap: 2, height: '65vh' }}>
        {versions === null && (
          <LiquidLoader size={40} label="Loading versions" />
        )}
        {versions && versions.length === 0 && (
          <Typography color="text.secondary" sx={{ m: 'auto' }}>
            No earlier versions yet. A version is kept each time you come back
            to edit the note (and before every restore).
          </Typography>
        )}
        {versions && versions.length > 0 && (
          <>
            <Box sx={{ width: 200, flexShrink: 0, overflow: 'auto' }}>
              {versions.map((v) => (
                <ListItemButton
                  key={v.id}
                  selected={selected?.id === v.id}
                  onClick={() => setSelected(v)}
                  sx={{
                    borderRadius: 2,
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                  }}
                >
                  <Typography variant="body2" fontWeight={600}>
                    {when(v.savedAt)}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{ maxWidth: '100%' }}
                  >
                    {v.title || 'Untitled'} · {v.content.length} chars
                  </Typography>
                </ListItemButton>
              ))}
            </Box>
            {selected && (
              <Box
                sx={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <DiffView
                  left={`${selected.title}\n\n${selected.content}`}
                  right={`${note.title}\n\n${note.content}`}
                  leftLabel={`Version · ${when(selected.savedAt)}`}
                  rightLabel="Current"
                  maxHeight="100%"
                />
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button
          variant="contained"
          disabled={!selected}
          onClick={() => selected && onRestore(selected)}
        >
          Restore this version
        </Button>
      </DialogActions>
    </Dialog>
  );
}
