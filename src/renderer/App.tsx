import React, { useEffect, useMemo, useState } from 'react';
import { MemoryRouter as Router } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import GlobalStyles from '@mui/material/GlobalStyles';
import { Box } from '@mui/material';
import Notes from './pages/notes/Notes';
import SettingsPage, { THEME_KEY } from './pages/settings/Settings';
import Layout, { MENU, Page } from './components/Layout';
import SearchOverlay, { IS_MAC } from './components/SearchOverlay';
import type { SearchResult } from './components/searchModel';
import ErrorBoundary from './components/ErrorBoundary';
import { resolveTheme } from './themes';
import './App.css';

export default function App() {
  // the start page is Commands
  const [page, setPage] = useState<Page>('commands');
  const [openRun, setOpenRun] = useState<{ id: string; at: number } | null>(
    null,
  );
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [openNote, setOpenNote] = useState<{ id: number; at: number } | null>(
    null,
  );
  const [openPackage, setOpenPackage] = useState<{
    id: string;
    at: number;
  } | null>(null);
  const [openRequest, setOpenRequest] = useState<{
    id: string;
    at: number;
  } | null>(null);

  // Ctrl+K, or ⌘K on macOS
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || e.altKey || e.shiftKey) return;
      if (IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const searchTools = useMemo(
    () => [
      ...MENU.map((m) => ({ page: m.mode as string, text: m.text })),
      { page: 'settings', text: 'Settings' },
    ],
    [],
  );
  const pick = (r: SearchResult) => {
    const at = Date.now();
    if (r.kind === 'tool') setPage(r.id as Page);
    if (r.kind === 'note') {
      setPage('notes');
      setOpenNote({ id: Number(r.id), at });
    }
    if (r.kind === 'package' || r.kind === 'command') {
      setPage('commands');
      setOpenPackage({ id: r.id, at });
    }
    if (r.kind === 'request') {
      setPage('client');
      setOpenRequest({ id: r.id, at });
    }
  };

  useEffect(() => {
    window.electron.database
      .getAllSettings()
      .then((s) => setSettings(s || {}))
      .catch(() => {});
    // a package notification was clicked: show that run's log
    return window.electron.ipcRenderer.on('commands:open-run', (runId) => {
      setPage('commands');
      setOpenRun({ id: String(runId), at: Date.now() });
    });
  }, []);

  const changeSetting = (key: string, value: string) => {
    setSettings((s) => ({ ...s, [key]: value }));
    window.electron.database.setSetting(key, value);
  };

  // Luma unless you picked Classic
  const themeSettings = {
    ...settings,
    [THEME_KEY]: settings[THEME_KEY] === 'classic' ? 'classic' : 'luma',
  };
  const theme = useMemo(
    () => resolveTheme(themeSettings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      themeSettings[THEME_KEY],
      settings.luma_primary,
      settings.luma_accent,
      settings.luma_highlight,
      settings.luma_band,
    ],
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          ':root': {
            '--thingy-primary': theme.palette.primary.main,
            '--thingy-primary-contrast': theme.palette.primary.contrastText,
          },
        }}
      />
      <ErrorBoundary>
        <Router>
          <Layout
            page={page}
            onPage={setPage}
            onSearch={() => setSearchOpen(true)}
          >
            {/* the tools stay mounted while Settings is open: nothing is lost */}
            <Box
              sx={{
                height: '100%',
                display: page === 'settings' ? 'none' : 'block',
              }}
            >
              <Notes
                mode={page === 'settings' ? 'commands' : page}
                onModeChange={setPage}
                openRun={openRun}
                openNote={openNote}
                openPackage={openPackage}
                openRequest={openRequest}
              />
            </Box>
            {page === 'settings' && (
              <SettingsPage settings={settings} onChange={changeSetting} />
            )}
          </Layout>
          <SearchOverlay
            open={searchOpen}
            tools={searchTools}
            onClose={() => setSearchOpen(false)}
            onPick={pick}
          />
        </Router>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
