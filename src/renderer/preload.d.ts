import type { DockerStatus } from '../main/docker';
import type { HttpResult, HttpSend } from '../main/httpClient';
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
