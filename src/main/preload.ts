import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  // Notes, settings and files (the name is kept from where these tools came from)
  database: {
    getNotes: () => ipcRenderer.invoke('notes:list'),
    createNote: (note: any) => ipcRenderer.invoke('notes:create', note),
    updateNote: (note: any, options?: { forceVersion?: boolean }) =>
      ipcRenderer.invoke('notes:update', note, options),
    getNoteVersions: (noteId: number) =>
      ipcRenderer.invoke('notes:versions', noteId),
    deleteNote: (noteId: number) => ipcRenderer.invoke('notes:delete', noteId),
    importNoteFiles: () => ipcRenderer.invoke('notes:import-files'),
    exportNoteFiles: (files: { fileName: string; content: string }[]) =>
      ipcRenderer.invoke('notes:export-files', files),
    saveBase64File: (fileName: string, base64: string) =>
      ipcRenderer.invoke('files:save-base64', fileName, base64),
    openBase64File: (fileName: string, base64: string) =>
      ipcRenderer.invoke('files:open-base64', fileName, base64),
    getAllSettings: () => ipcRenderer.invoke('settings:all'),
    setSetting: (key: string, value: string) =>
      ipcRenderer.invoke('settings:set', key, value),
  },
  ipcRenderer: {
    on(channel: string, func: (...args: unknown[]) => void) {
      const subscription = (_event: any, ...args: unknown[]) => func(...args);
      ipcRenderer.on(channel, subscription);
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: string, func: (...args: unknown[]) => void) {
      const subscription = (_event: any, ...args: unknown[]) => func(...args);
      ipcRenderer.once(channel, subscription);
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
  },
  commands: {
    run: (steps: any[], options: any) =>
      ipcRenderer.invoke('commands:run', steps, options),
    stop: (runId: string, force?: boolean) =>
      ipcRenderer.invoke('commands:stop', runId, force),
    stopStep: (runId: string, index: number, force?: boolean) =>
      ipcRenderer.invoke('commands:stop-step', runId, index, force),
    runs: () => ipcRenderer.invoke('commands:runs'),
    output: (runId: string, step?: number | null) =>
      ipcRenderer.invoke('commands:output', runId, step),
    rerun: (runId: string, options?: any) =>
      ipcRenderer.invoke('commands:rerun', runId, options),
    clear: () => ipcRenderer.invoke('commands:clear'),
    pickFolder: (current?: string) =>
      ipcRenderer.invoke('commands:pick-folder', current),
  },
  docker: {
    status: () => ipcRenderer.invoke('docker:status'),
    list: () => ipcRenderer.invoke('docker:list'),
    action: (ids: string[], action: string) =>
      ipcRenderer.invoke('docker:action', ids, action),
    logs: (id: string, tail?: number) =>
      ipcRenderer.invoke('docker:logs', id, tail),
    connections: (id: string) => ipcRenderer.invoke('docker:connections', id),
    startColima: () => ipcRenderer.invoke('docker:start-colima'),
    remove: (id: string, options: any) =>
      ipcRenderer.invoke('docker:remove', id, options),
    volumes: (withSizes?: boolean) =>
      ipcRenderer.invoke('docker:volumes', withSizes),
    removeVolumes: (names: string[]) =>
      ipcRenderer.invoke('docker:remove-volumes', names),
    resetInfo: (id: string, dbName?: string) =>
      ipcRenderer.invoke('docker:reset-info', id, dbName),
    resetDb: (id: string, dbName: string) =>
      ipcRenderer.invoke('docker:reset-db', id, dbName),
    pruneVolumes: (all?: boolean) =>
      ipcRenderer.invoke('docker:prune-volumes', all),
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.send('shell:open-external', url),
  },
  http: {
    send: (req: any) => ipcRenderer.invoke('http:send', req),
    cancel: (id: string) => ipcRenderer.invoke('http:cancel', id),
  },
  files: {
    openText: (title: string, extensions: string[]) =>
      ipcRenderer.invoke('files:open-text', title, extensions),
    saveText: (fileName: string, content: string) =>
      ipcRenderer.invoke('files:save-text', fileName, content),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
    testNotification: () => ipcRenderer.invoke('notify:test'),
  },
  platform: process.platform,
});
