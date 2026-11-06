import type { DockerStatus } from '../main/docker';
import type { HttpResult, HttpSend } from '../main/httpClient';
import type { HistoryEntry } from '../main/httpHistory';
import type { TracingStatus } from '../main/tracing';
import type { ReportedSpan } from '../main/traceModel';
import type { OAuthRequest, OAuthToken } from '../main/oauth';
import type { SqlResult, Timing } from '../main/sqlTools';
import type { DockerfileRecipe } from '../main/dockerfileTools';
import type { ComposeRun } from '../main/composeTools';
import type { PortInfo } from '../main/ports';
import type { Snapshot } from '../main/sqlRunner';
import type { RunSnapshot, RunStepInput } from '../main/commandRunner';
import type {
  ConnectionString,
  DockerContainer,
  DockerVolume,
} from '../main/dockerTools';

export interface IElectronAPI {
  database: {
    getNotes: () => Promise<any[]>;
    createNote: (note: any) => Promise<any>;
    updateNote: (
      note: any,
      options?: { forceVersion?: boolean },
    ) => Promise<any>;
    getNoteVersions: (noteId: number) => Promise<any[]>;
    deleteNote: (noteId: number) => Promise<number>;
    importNoteFiles: () => Promise<{ fileName: string; text: string }[]>;
    exportNoteFiles: (
      files: { fileName: string; content: string }[],
    ) => Promise<number>;
    saveBase64File: (
      fileName: string,
      base64: string,
    ) => Promise<string | null>;
    openBase64File: (
      fileName: string,
      base64: string,
    ) => Promise<string | null>;
    getAllSettings: () => Promise<Record<string, string>>;
    setSetting: (key: string, value: string) => Promise<void>;
  };
  ipcRenderer: {
    on(channel: string, func: (...args: unknown[]) => void): () => void;
    once(channel: string, func: (...args: unknown[]) => void): () => void;
  };
  commands: {
    run: (
      steps: RunStepInput[],
      options: {
        label: string;
        groupId?: string | null;
        stopOnError?: boolean;
        notify?: boolean;
      },
    ) => Promise<RunSnapshot | null>;
    stop: (runId: string, force?: boolean) => Promise<boolean>;
    stopStep: (
      runId: string,
      index: number,
      force?: boolean,
    ) => Promise<boolean>;
    runs: () => Promise<RunSnapshot[]>;
    logsBetween: (
      from: number,
      to: number,
    ) => Promise<
      {
        runId: string;
        step: number;
        name: string;
        command: string;
        running: boolean;
        lines: { at: number; text: string }[];
      }[]
    >;
    output: (runId: string, step?: number | null) => Promise<string>;
    rerun: (
      runId: string,
      options?: {
        from?: number;
        only?: number;
        section?: string;
        latest?: Record<string, Partial<RunStepInput>>;
      },
    ) => Promise<RunSnapshot | null>;
    retry: (
      runId: string,
      index: number,
      latest?: Partial<RunStepInput> | null,
    ) => Promise<RunSnapshot | null>;
    clear: () => Promise<boolean>;
    pickFolder: (current?: string) => Promise<string | null>;
  };
  docker: {
    status: () => Promise<DockerStatus>;
    list: () => Promise<{
      containers: DockerContainer[];
      error: string | null;
    }>;
    action: (
      ids: string[],
      action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause',
    ) => Promise<{ ok: boolean; error: string | null }>;
    logs: (id: string, tail?: number) => Promise<{ ok: boolean; text: string }>;
    connections: (id: string) => Promise<ConnectionString[]>;
    startColima: () => Promise<{ ok: boolean; error: string | null }>;
    remove: (
      id: string,
      options: {
        force?: boolean;
        anonymousVolumes?: boolean;
        volumes?: string[];
      },
    ) => Promise<{ ok: boolean; error: string | null }>;
    volumes: (
      withSizes?: boolean,
    ) => Promise<{ volumes: DockerVolume[]; error: string | null }>;
    removeVolumes: (
      names: string[],
    ) => Promise<{ ok: boolean; error: string | null }>;
    resetInfo: (
      id: string,
      dbName?: string,
    ) => Promise<{
      supported: boolean;
      kind?: string;
      dbName?: string;
      error: string | null;
      command?: string;
    }>;
    resetDb: (
      id: string,
      dbName: string,
    ) => Promise<{ ok: boolean; error: string | null; output?: string }>;
    pruneVolumes: (all?: boolean) => Promise<{
      ok: boolean;
      error: string | null;
      reclaimed: string | null;
    }>;
  };
  shell: {
    openExternal: (url: string) => void;
  };
  http: {
    send: (req: HttpSend) => Promise<HttpResult>;
    cancel: (id: string) => Promise<boolean>;
    history: () => Promise<HistoryEntry[]>;
    addHistory: (entry: HistoryEntry) => Promise<boolean>;
    deleteHistory: (id: string) => Promise<boolean>;
    clearHistory: () => Promise<boolean>;
  };
  tracing: {
    status: () => Promise<TracingStatus>;
    start: () => Promise<TracingStatus>;
    stop: () => Promise<TracingStatus>;
    report: (span: ReportedSpan) => Promise<boolean>;
    get: (traceId: string) => Promise<{ trace: any; error: string | null }>;
  };
  ports: {
    who: (port: number) => Promise<PortInfo>;
    kill: (pid: number) => Promise<{ ok: boolean; error: string | null }>;
  };
  compose: {
    pick: (current?: string) => Promise<string | null>;
    up: (run: ComposeRun) => Promise<{ ok: boolean; error: string | null }>;
    down: (run: ComposeRun) => Promise<{ ok: boolean; error: string | null }>;
    stop: (id: string) => Promise<boolean>;
  };
  dockerfile: {
    pick: (current?: string) => Promise<{ path: string; text: string } | null>;
    pickFolder: (current?: string) => Promise<string | null>;
    read: (file: string) => Promise<string | null>;
    up: (
      recipe: DockerfileRecipe,
      rebuild: boolean,
    ) => Promise<{ ok: boolean; error: string | null; id?: string }>;
    stopBuild: (id: string) => Promise<boolean>;
  };
  sql: {
    targets: () => Promise<{
      error: string | null;
      targets: {
        id: string;
        name: string;
        kind: string;
        running: boolean;
        project: string | null;
      }[];
    }>;
    databases: (
      id: string,
    ) => Promise<{ databases: string[]; error: string | null }>;
    schemas: (id: string, db: string) => Promise<string[]>;
    tables: (id: string, db: string, schema?: string) => Promise<string[]>;
    setLogin: (
      container: string,
      user: string,
      password: string,
    ) => Promise<void>;
    run: (
      runId: string,
      id: string,
      db: string,
      sql: string,
      dryRun?: boolean,
      schema?: string,
    ) => Promise<SqlResult>;
    cancel: (runId: string) => Promise<boolean>;
    time: (
      runId: string,
      id: string,
      db: string,
      sql: string,
      schema?: string,
    ) => Promise<Timing>;
    snapshots: (container?: string, db?: string) => Promise<Snapshot[]>;
    renameSnapshot: (file: string, name: string) => Promise<boolean>;
    snapshot: (
      id: string,
      db: string,
      name?: string,
      auto?: boolean,
    ) => Promise<{
      ok: boolean;
      error: string | null;
      snapshot: Snapshot | null;
    }>;
    restore: (
      id: string,
      db: string,
      file: string,
    ) => Promise<{ ok: boolean; error: string | null }>;
    deleteSnapshot: (file: string) => Promise<boolean>;
  };
  oauth: {
    token: (req: OAuthRequest) => Promise<OAuthToken>;
  };
  files: {
    openText: (
      title: string,
      extensions: string[],
    ) => Promise<{ fileName: string; text: string }[]>;
    saveText: (fileName: string, content: string) => Promise<string | null>;
  };
  app: {
    info: () => Promise<{ version: string; dataDir: string; platform: string }>;
    openDataDir: () => Promise<string>;
    testNotification: () => Promise<boolean>;
  };
  platform: string;
}

declare global {
  interface Window {
    electron: IElectronAPI;
  }
}
