// Notes for the Notes page. Stackrun has a single local user, so there is no user id.

export const fetchNotes = async () => {
  try {
    return (await window.electron.database.getNotes()) || [];
  } catch (error) {
    console.error('[Notes] Error fetching notes:', error);
    return [];
  }
};

export const createNote = async (note: any) =>
  window.electron.database.createNote(note);

export const updateNote = async (
  note: any,
  options?: { forceVersion?: boolean },
) =>
  options
    ? window.electron.database.updateNote(note, options)
    : window.electron.database.updateNote(note);

export const deleteNote = async (noteId: number) =>
  window.electron.database.deleteNote(noteId);
