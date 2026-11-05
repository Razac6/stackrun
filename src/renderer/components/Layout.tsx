// Stackrun's frame: the tools on the left (like Thingy's sidebar), the picked one on the right.
import React, { useEffect, useState } from 'react';
import {
  Badge,
  Box,
  Drawer as MuiDrawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
  styled,
  Theme,
  CSSObject,
} from '@mui/material';
import TerminalIcon from '@mui/icons-material/TerminalOutlined';
import HttpClientIcon from '@mui/icons-material/SendOutlined';
import SqlClientIcon from '@mui/icons-material/StorageOutlined';
import DockerIcon from '@mui/icons-material/ViewInArOutlined';
import NotesIcon from '@mui/icons-material/DescriptionOutlined';
import CompareIcon from '@mui/icons-material/DifferenceOutlined';
import CurlIcon from '@mui/icons-material/ContentPasteGoOutlined';
import Base64Icon from '@mui/icons-material/CodeOutlined';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import MenuIcon from '@mui/icons-material/Menu';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ButtonBase from '@mui/material/ButtonBase';
import { SEARCH_SHORTCUT } from './SearchOverlay';
import type { Mode } from '../pages/notes/Notes';
import type { RunSnapshot } from '../../main/commandRunner';

export type Page = Mode | 'settings';

/** The orange ">" of "Stackrun>" (and of the app icon). */
export const BRAND_ORANGE = '#ff8a00';

export const MENU: { mode: Mode; text: string; icon: React.ReactNode }[] = [
  { mode: 'commands', text: 'Commands', icon: <TerminalIcon /> },
  { mode: 'client', text: 'HTTP Client', icon: <HttpClientIcon /> },
  { mode: 'sql', text: 'SQL Client', icon: <SqlClientIcon /> },
  { mode: 'docker', text: 'Docker', icon: <DockerIcon /> },
  { mode: 'notes', text: 'Notes', icon: <NotesIcon /> },
  { mode: 'compare', text: 'JSON compare', icon: <CompareIcon /> },
  { mode: 'http', text: 'cURL → HTTP', icon: <CurlIcon /> },
  { mode: 'base64', text: 'Base64', icon: <Base64Icon /> },
];

const drawerWidth = 220;

const openedMixin = (theme: Theme): CSSObject => ({
  width: drawerWidth,
  transition: theme.transitions.create('width', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.enteringScreen,
  }),
  overflowX: 'hidden',
});

const closedMixin = (theme: Theme): CSSObject => ({
  transition: theme.transitions.create('width', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  overflowX: 'hidden',
  width: `calc(${theme.spacing(8)} + 1px)`,
});

const Drawer = styled(MuiDrawer, {
  shouldForwardProp: (prop) => prop !== 'open',
})(({ theme, open }) => ({
  width: drawerWidth,
  flexShrink: 0,
  whiteSpace: 'nowrap',
  boxSizing: 'border-box',
  ...(open && {
    ...openedMixin(theme),
    '& .MuiDrawer-paper': openedMixin(theme),
  }),
  ...(!open && {
    ...closedMixin(theme),
    '& .MuiDrawer-paper': closedMixin(theme),
  }),
}));

/**
 * What runs right now (the number on "Commands"): every package or single command that
 * has not finished - including packages that are up, with their dev servers running in
 * the background until you stop them.
 */
const useRunning = () => {
  const [runs, setRuns] = useState<
    Record<string, { label: string; up: boolean; running: boolean }>
  >({});
  useEffect(() => {
    const info = (r: RunSnapshot) => ({
      label: r.label,
      up: !!r.readyAt,
      running: r.status === 'running',
    });
    window.electron.commands
      .runs()
      .then((list) =>
        setRuns(Object.fromEntries(list.map((r) => [r.id, info(r)]))),
      );
    return window.electron.ipcRenderer.on('commands:run', (run: any) => {
      if (run?.id) setRuns((m) => ({ ...m, [run.id]: info(run) }));
    });
  }, []);
  return Object.values(runs).filter((r) => r.running);
};

export default function Layout({
  page,
  onPage,
  onSearch,
  children,
}: {
  page: Page;
  onPage: (page: Page) => void;
  onSearch: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(
    () => localStorage.getItem('sidebar_open') !== 'false',
  );
  const toggle = () =>
    setOpen((o) => {
      localStorage.setItem('sidebar_open', String(!o));
      return !o;
    });
  const live = useRunning();
  const running = live.length;
  const item = (
    key: string,
    text: string,
    icon: React.ReactNode,
    selected: boolean,
    onClick: () => void,
  ) => (
    <ListItem key={key} disablePadding sx={{ display: 'block' }}>
      <Tooltip title={open ? '' : text} placement="right">
        <ListItemButton
          selected={selected}
          onClick={onClick}
          aria-label={text}
          sx={{
            minHeight: 46,
            justifyContent: open ? 'initial' : 'center',
            px: 2.5,
          }}
        >
          <ListItemIcon
            sx={{
              minWidth: 0,
              mr: open ? 2.5 : 'auto',
              justifyContent: 'center',
            }}
          >
            {icon}
          </ListItemIcon>
          <ListItemText primary={text} sx={{ opacity: open ? 1 : 0 }} />
        </ListItemButton>
      </Tooltip>
    </ListItem>
  );

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <Drawer variant="permanent" open={open}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: open ? 'space-between' : 'center',
            px: open ? 2.5 : 0,
            minHeight: 56,
          }}
        >
          {open && (
            <Typography
              variant="h6"
              sx={{ fontWeight: 700, color: 'inherit' }}
              noWrap
            >
              Stackrun
              <Box component="span" sx={{ color: BRAND_ORANGE, ml: 0.25 }}>
                &gt;
              </Box>
            </Typography>
          )}
          <IconButton
            color="inherit"
            onClick={toggle}
            aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {open ? <ChevronLeftIcon /> : <MenuIcon />}
          </IconButton>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <List>
            {MENU.map((m) =>
              item(
                m.mode,
                m.text,
                m.mode === 'commands' && running ? (
                  <Tooltip
                    placement="right"
                    title={
                      <Box>
                        <b>{running} running</b>
                        {live.map((r, i) => (
                          // eslint-disable-next-line react/no-array-index-key
                          <Box key={i}>
                            {r.up ? '● ' : '◌ '}
                            {r.label}
                            {r.up ? ' - up, servers in the background' : ''}
                          </Box>
                        ))}
                      </Box>
                    }
                  >
                    <Badge badgeContent={running} color="success">
                      {m.icon}
                    </Badge>
                  </Tooltip>
                ) : (
                  m.icon
                ),
                page === m.mode,
                () => onPage(m.mode),
              ),
            )}
          </List>
          <Box sx={{ flexGrow: 1 }} />
          <List>
            {item(
              'settings',
              'Settings',
              <SettingsIcon />,
              page === 'settings',
              () => onPage('settings'),
            )}
          </List>
        </Box>
      </Drawer>
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          p: 3,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
        }}
      >
        {/* Like Thingy's Luma: search floats in the top-right corner */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            flexShrink: 0,
            mt: -1.5,
            mb: 1.5,
          }}
        >
          <ButtonBase
            onClick={onSearch}
            aria-label="Search"
            sx={{
              height: 40,
              px: 2,
              gap: 1,
              borderRadius: 999,
              bgcolor: 'background.paper',
              color: 'text.secondary',
              border: 1,
              borderColor: 'divider',
              boxShadow: '0 8px 24px rgba(17,18,20,0.08)',
              fontSize: '0.875rem',
              fontWeight: 500,
              transition: 'color 0.2s, border-color 0.2s',
              '&:hover': { color: 'text.primary', borderColor: 'text.primary' },
            }}
          >
            <SearchIcon fontSize="small" />
            Search
            <Box
              component="kbd"
              sx={{
                ml: 1,
                px: 0.75,
                borderRadius: 1,
                bgcolor: 'background.default',
                fontFamily: 'inherit',
                fontSize: '0.7rem',
              }}
            >
              {SEARCH_SHORTCUT}
            </Box>
          </ButtonBase>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0 }}>{children}</Box>
      </Box>
    </Box>
  );
}
