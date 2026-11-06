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
    retry: (runId: string, index: number, latest?: any) =>
      ipcRenderer.invoke('commands:retry', runId, index, latest),
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
  ports: {
    who: (port: number) => ipcRenderer.invoke('ports:who', port),
    kill: (pid: number) => ipcRenderer.invoke('ports:kill', pid),
  },
  compose: {
    pick: (current?: string) => ipcRenderer.invoke('compose:pick', current),
    up: (run: any) => ipcRenderer.invoke('compose:up', run),
    down: (run: any) => ipcRenderer.invoke('compose:down', run),
    stop: (id: string) => ipcRenderer.invoke('compose:stop', id),
  },
  dockerfile: {
    pick: (current?: string) => ipcRenderer.invoke('dockerfile:pick', current),
    pickFolder: (current?: string) =>
      ipcRenderer.invoke('dockerfile:pick-folder', current),
    read: (file: string) => ipcRenderer.invoke('dockerfile:read', file),
    up: (recipe: any, rebuild: boolean) =>
      ipcRenderer.invoke('dockerfile:up', recipe, rebuild),
    stopBuild: (id: string) => ipcRenderer.invoke('dockerfile:stop-build', id),
  },
  sql: {
    targets: () => ipcRenderer.invoke('sql:targets'),
    databases: (id: string) => ipcRenderer.invoke('sql:databases', id),
    schemas: (id: string, db: string) =>
      ipcRenderer.invoke('sql:schemas', id, db),
    tables: (id: string, db: string, schema?: string) =>
      ipcRenderer.invoke('sql:tables', id, db, schema),
    setLogin: (container: string, user: string, password: string) =>
      ipcRenderer.invoke('sql:set-login', container, user, password),
    run: (
      runId: string,
      id: string,
      db: string,
      sql: string,
      dryRun?: boolean,
      schema?: string,
    ) => ipcRenderer.invoke('sql:run', runId, id, db, sql, dryRun, schema),
    cancel: (runId: string) => ipcRenderer.invoke('sql:cancel', runId),
    snapshots: (container?: string, db?: string) =>
      ipcRenderer.invoke('sql:snapshots', container, db),
    snapshot: (id: string, db: string, name?: string, auto?: boolean) =>
      ipcRenderer.invoke('sql:snapshot', id, db, name, auto),
    renameSnapshot: (file: string, name: string) =>
      ipcRenderer.invoke('sql:rename-snapshot', file, name),
    restore: (id: string, db: string, file: string) =>
      ipcRenderer.invoke('sql:restore', id, db, file),
    deleteSnapshot: (file: string) =>
      ipcRenderer.invoke('sql:delete-snapshot', file),
  },
  oauth: {
    token: (req: any) => ipcRenderer.invoke('oauth:token', req),
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
