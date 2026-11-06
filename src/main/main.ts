/* eslint global-require: off, no-console: off */
// Stackrun: dev notes, command packages, Docker and small dev tools.
import path from 'path';
import fs from 'fs';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  session,
  shell,
} from 'electron';
import log from 'electron-log';
import { resolveHtmlPath } from './util';
import { containerReady, registerDockerIpc } from './docker';
import { registerCommandIpc, RunNotice, stopAllRuns } from './commandRunner';
import { Store } from './store';
import { registerHttpIpc } from './httpClient';
import { registerOAuthIpc } from './oauth';
import { registerSqlIpc, setSnapshotDir } from './sqlRunner';
import { registerDockerfileIpc } from './dockerfileRunner';
import { registerComposeIpc } from './composeRunner';
import { registerPortIpc } from './ports';
import { noticeDecision, readNotifySettings } from './notifySettings';

app.setName('Stackrun');
if (process.platform === 'win32') {
  // Windows shows notifications only for an app with an id
  app.setAppUserModelId(
    app.isPackaged ? 'pl.webbd.stackrun' : process.execPath,
  );
}

// One window: a second launch brings the first one to the front
if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow: BrowserWindow | null = null;

// Files that would run when "opened" - Base64 → Open refuses them (Save still works)
const RUNNABLE =
  /\.(exe|com|bat|cmd|msi|msp|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|scr|pif|cpl|lnk|reg|jar|app|command|sh|bash|zsh|csh|pkg|mpkg|dmg|scpt|workflow|appimage|deb|rpm|run|py|pl|rb)$/i;

const getAssetPath = (...paths: string[]): string =>
  path.join(
    app.isPackaged
      ? path.join(process.resourcesPath, 'assets')
      : path.join(__dirname, '../../assets'),
    ...paths,
  );
const appIconPath = getAssetPath('icons', 'icon.png');

const showWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
};
app.on('second-instance', showWindow);

// ---------------- notes + settings ----------------
let store: Store;
const data = () => {
  if (!store)
    store = new Store(path.join(app.getPath('userData'), 'stackrun-data.json'));
  return store;
};

ipcMain.handle('notes:list', () => data().getNotes());
ipcMain.handle('notes:create', (event, note) => data().createNote(note));
ipcMain.handle('notes:update', (event, note, options) =>
  data().updateNote(note, options || {}),
);
ipcMain.handle('notes:versions', (event, noteId) =>
  data().getNoteVersions(noteId),
);
ipcMain.handle('notes:delete', (event, noteId) => data().deleteNote(noteId));
ipcMain.handle('settings:all', () => data().getAllSettings());
ipcMain.handle('settings:set', (event, key, value) =>
  data().setSetting(key, value),
);

// ---------------- files ----------------
// Only plain file names - never let a note title escape the chosen folder
const safeFileName = (name: string) =>
  path.basename(String(name || 'file')).replace(/[<>:"/\\|?*]/g, '_');

ipcMain.handle('notes:import-files', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Import notes',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Notes', extensions: ['md', 'markdown', 'txt', 'json', 'sql'] },
    ],
  });
  if (result.canceled) return [];
  return result.filePaths.map((filePath) => ({
    fileName: path.basename(filePath),
    text: fs.readFileSync(filePath, 'utf-8'),
  }));
});

ipcMain.handle(
  'notes:export-files',
  async (event, files: { fileName: string; content: string }[]) => {
    const safe = (files || []).map((f) => ({
      fileName: safeFileName(f.fileName),
      content: f.content,
    }));
    if (safe.length === 0) return 0;
    if (safe.length === 1) {
      const result = await dialog.showSaveDialog({
        title: 'Export note',
        defaultPath: safe[0].fileName,
      });
      if (result.canceled || !result.filePath) return 0;
      fs.writeFileSync(result.filePath, safe[0].content, 'utf-8');
      return 1;
    }
    const result = await dialog.showOpenDialog({
      title: 'Export notes to folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return 0;
    const dir = result.filePaths[0];
    safe.forEach((f) =>
      fs.writeFileSync(path.join(dir, f.fileName), f.content, 'utf-8'),
    );
    return safe.length;
  },
);

// Binary files from base64: save with a dialog, or open a temp copy in the default app
ipcMain.handle(
  'files:save-base64',
  async (event, fileName: string, base64: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Save file',
      defaultPath: safeFileName(fileName),
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(
      result.filePath,
      new Uint8Array(Buffer.from(base64, 'base64')),
    );
    return result.filePath;
  },
);
ipcMain.handle(
  'files:open-base64',
  async (event, fileName: string, base64: string) => {
    if (RUNNABLE.test(safeFileName(fileName)))
      return 'This kind of file could run a program when opened - use Save and check it first';
    const filePath = path.join(
      app.getPath('temp'),
      `stackrun-${Date.now()}-${safeFileName(fileName)}`,
    );
    fs.writeFileSync(filePath, new Uint8Array(Buffer.from(base64, 'base64')));
    const error = await shell.openPath(filePath);
    return error || null;
  },
);

ipcMain.on('shell:open-external', (event, url: string) => {
  if (/^https?:\/\//i.test(String(url))) shell.openExternal(String(url));
});

// ---------------- package notifications ----------------
// Held until closed: a notification that gets garbage-collected loses its click handler
// (and on Windows can vanish from the action centre).
const shown = new Set<Notification>();

const showRunNotice = (notice: RunNotice, force = false) => {
  // Settings > Notifications (a test from Settings always shows)
  const decision = force
    ? { show: true, sound: true }
    : noticeDecision(
        readNotifySettings(data().getAllSettings()),
        notice.kind,
        !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused(),
      );
  if (!decision.show) return;
  if (!Notification.isSupported()) {
    log.warn('[notify] notifications are not supported here');
    return;
  }
  const n = new Notification({
    title: notice.title,
    body: notice.body,
    // macOS always uses the app icon; a custom one is only for Windows / Linux
    ...(process.platform === 'darwin' ? {} : { icon: appIconPath }),
    silent: !decision.sound,
  });
  shown.add(n);
  const forget = () => shown.delete(n);
  n.on('click', () => {
    forget();
    showWindow();
    if (notice.runId)
      mainWindow?.webContents.send('commands:open-run', notice.runId);
  });
  // not forgotten on 'close': Windows "closes" it into the action centre, where it
  // can still be clicked
  n.on('failed', (e, error) => {
    forget();
    log.warn('[notify] could not show a notification:', error);
  });
  n.show();
  // ...but not kept forever
  setTimeout(forget, 60 * 60 * 1000);
};

ipcMain.handle('notify:test', () => {
  showRunNotice(
    {
      runId: '',
      kind: 'ok',
      title: '✓ Stackrun notifications work',
      body: 'This is how a finished package will tell you.',
    },
    true,
  );
  return Notification.isSupported();
});

// ---------------- about ----------------
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  dataDir: app.getPath('userData'),
  platform: process.platform,
}));
ipcMain.handle('app:open-data-dir', () =>
  shell.openPath(app.getPath('userData')),
);

// Text files for import / export (HTTP Client: .http, http-client.env.json, backups)
ipcMain.handle(
  'files:open-text',
  async (event, title: string, extensions: string[]) => {
    const result = await dialog.showOpenDialog({
      title: String(title || 'Open'),
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Files', extensions: (extensions || []).map(String) },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled) return [];
    return result.filePaths.map((filePath) => ({
      fileName: path.basename(filePath),
      text: fs.readFileSync(filePath, 'utf-8'),
    }));
  },
);
ipcMain.handle(
  'files:save-text',
  async (event, fileName: string, content: string) => {
    const result = await dialog.showSaveDialog({
      title: 'Save',
      defaultPath: safeFileName(fileName),
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, String(content), 'utf-8');
    return result.filePath;
  },
);

registerHttpIpc(ipcMain);
registerOAuthIpc(ipcMain);
registerSqlIpc(ipcMain);
registerDockerfileIpc(ipcMain);
registerComposeIpc(ipcMain);
registerPortIpc(ipcMain);
setSnapshotDir(path.join(app.getPath('userData'), 'sql-snapshots'));
registerDockerIpc(ipcMain);
registerCommandIpc(ipcMain, {
  containerReady,
  conditionFile: path.join(app.getPath('userData'), 'command-conditions.json'),
  notify: showRunNotice,
});

// ---------------- window ----------------
// The menu and the window's key handler both lead here: pass each shortcut on once
const lastShortcut = new Map<string, number>();
const sendShortcut = (channel: string) => {
  const now = Date.now();
  if (now - (lastShortcut.get(channel) || 0) < 400) return;
  lastShortcut.set(channel, now);
  showWindow();
  mainWindow?.webContents.send(channel);
};

const buildMenu = () => {
  const mac = process.platform === 'darwin';
  // The shortcuts themselves are caught in before-input-event (createWindow): that works
  // on macOS whatever has the focus. The menu only shows them (registerAccelerator off,
  // or one press would toggle the search twice).
  const go: Electron.MenuItemConstructorOptions = {
    label: 'Go',
    submenu: [
      {
        label: 'Search…',
        accelerator: 'CmdOrCtrl+K',
        registerAccelerator: false,
        click: () => sendShortcut('app:search'),
      },
      {
        label: 'Free a port…',
        accelerator: 'CmdOrCtrl+Shift+P',
        registerAccelerator: false,
        click: () => sendShortcut('app:ports'),
      },
    ],
  };
  // macOS needs the Edit menu for ⌘C / ⌘V / ⌘A in text fields
  const template: Electron.MenuItemConstructorOptions[] = mac
    ? [
        { role: 'appMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        go,
        { role: 'windowMenu' },
      ]
    : [{ role: 'editMenu' }, { role: 'viewMenu' }, go];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    title: 'Stackrun',
    icon: getAssetPath('icon.png'),
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
      // the page gets only what preload.ts exposes - no Node, its own JS world
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Chromium's PDF viewer previews decoded base64 PDFs
      plugins: true,
    },
  });
  mainWindow.loadURL(resolveHtmlPath('index.html'));
  mainWindow.on('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  // links open in the browser, not in a new app window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // ...and never inside this window: a page from the internet must not get the app's
  // API (it can run commands)
  const home = resolveHtmlPath('index.html');
  // ⌘K / Ctrl+K and ⌘⇧P / Ctrl+Shift+P, before the page (or a text field) gets them
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.alt || input.isAutoRepeat) return;
    const mod = process.platform === 'darwin' ? input.meta : input.control;
    if (!mod) return;
    const key = input.code || `Key${input.key.toUpperCase()}`;
    if (key === 'KeyK' && !input.shift) {
      event.preventDefault();
      sendShortcut('app:search');
    } else if (key === 'KeyP' && input.shift) {
      event.preventDefault();
      sendShortcut('app:ports');
    }
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.split('#')[0] === home.split('#')[0]) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  mainWindow.webContents.on('will-attach-webview', (event) =>
    event.preventDefault(),
  );
};

// macOS: closing the window keeps the app (and the running packages) alive
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (mainWindow === null) createWindow();
  else showWindow();
});
app.on('will-quit', () => stopAllRuns());

app
  .whenReady()
  .then(() => {
    // the page asks for nothing (camera, mic, location...) except writing the clipboard
    session.defaultSession.setPermissionRequestHandler((wc, permission, done) =>
      done(permission === 'clipboard-sanitized-write'),
    );
    buildMenu();
    createWindow();
  })
  .catch((e) => {
    log.error('Stackrun failed to start', e);
    app.quit();
  });
