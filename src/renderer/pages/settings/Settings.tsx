// Settings: how Stackrun looks, which package notifications reach you, where its data is.
import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Divider,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import {
  NOTIFY_KEYS,
  NotifySettings,
  readNotifySettings,
} from '../../../main/notifySettings';
import { getLumaColors, lumaColorSettings } from '../../themes';
import { lumaDefaults } from '../../themes/luma';
import BottomToast from '../notes/BottomToast';

export const THEME_KEY = 'ui_theme';

type Settings = Record<string, string | undefined>;

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Paper sx={{ p: 2.5 }}>
      <Typography variant="h6" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {hint && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {hint}
        </Typography>
      )}
      {children}
    </Paper>
  );
}

const NOTIFY_ROWS: {
  key: keyof NotifySettings;
  label: string;
  hint: string;
  sub?: boolean;
}[] = [
  {
    key: 'ok',
    label: 'When a package is done',
    hint: '✓ every step passed',
    sub: true,
  },
  {
    key: 'failed',
    label: 'When a package fails',
    hint: '✖ names the step that failed',
    sub: true,
  },
  {
    key: 'ready',
    label: 'When a package is up',
    hint: '● its dev servers started (Nest, Angular, func…)',
    sub: true,
  },
  {
    key: 'sound',
    label: 'Play a sound when one fails',
    hint: 'Done / up are always silent',
    sub: true,
  },
  {
    key: 'onlyInBackground',
    label: 'Only when Stackrun is in the background',
    hint: 'Nothing pops up while you are looking at it',
    sub: true,
  },
];

export default function SettingsPage({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (key: string, value: string) => void;
}) {
  const [info, setInfo] = useState<{ version: string; dataDir: string }>();
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    window.electron.app
      .info()
      .then(setInfo)
      .catch(() => {});
  }, []);

  const theme = settings[THEME_KEY] === 'classic' ? 'classic' : 'luma';
  const notify = readNotifySettings(settings);
  const colors = getLumaColors(settings);
  const setNotify = (key: keyof NotifySettings, on: boolean) =>
    onChange(NOTIFY_KEYS[key], String(on));

  const test = async () => {
    const ok = await window.electron.app.testNotification();
    setToast(
      ok
        ? 'Sent - if nothing showed up, allow Stackrun in the system notification settings'
        : 'This system does not support notifications',
    );
    setTimeout(() => setToast(null), 5000);
  };

  return (
    <Box sx={{ height: '100%', overflow: 'auto' }}>
      <Stack spacing={2} sx={{ maxWidth: 720, pb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Settings
        </Typography>

        <Section title="Appearance">
          <ToggleButtonGroup
            exclusive
            size="small"
            value={theme}
            onChange={(_, v) => v && onChange(THEME_KEY, v)}
            aria-label="Theme"
          >
            <ToggleButton value="luma">Luma</ToggleButton>
            <ToggleButton value="classic">Classic</ToggleButton>
          </ToggleButtonGroup>
          {theme === 'luma' && (
            <Stack direction="row" spacing={3} sx={{ mt: 2 }}>
              {(
                [
                  ['primary', 'Buttons'],
                  ['accent', 'Accent'],
                ] as const
              ).map(([key, label]) => (
                <Box
                  key={key}
                  component="label"
                  sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                >
                  <input
                    type="color"
                    value={colors[key]}
                    aria-label={`${label} color`}
                    onChange={(e) =>
                      onChange(lumaColorSettings[key], e.target.value)
                    }
                    style={{
                      width: 32,
                      height: 32,
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                    }}
                  />
                  <Typography variant="body2">{label}</Typography>
                </Box>
              ))}
              <Tooltip title="Back to the Luma colors">
                <span>
                  <Button
                    size="small"
                    startIcon={<RestartAltIcon />}
                    disabled={
                      colors.primary === lumaDefaults.primary &&
                      colors.accent === lumaDefaults.accent
                    }
                    onClick={() => {
                      onChange(lumaColorSettings.primary, '');
                      onChange(lumaColorSettings.accent, '');
                    }}
                  >
                    Reset
                  </Button>
                </span>
              </Tooltip>
            </Stack>
          )}
        </Section>

        <Section
          title="Notifications"
          hint="Desktop notifications about packages in Commands. They are off for each package until you turn on its bell (in the package header)."
        >
          <FormControlLabel
            control={
              <Switch
                checked={notify.enabled}
                onChange={(e) => setNotify('enabled', e.target.checked)}
              />
            }
            label="Package notifications"
          />
          <Box sx={{ pl: 4, opacity: notify.enabled ? 1 : 0.5 }}>
            {NOTIFY_ROWS.map((row) => (
              <FormControlLabel
                key={row.key}
                sx={{ display: 'flex', alignItems: 'flex-start', mt: 0.5 }}
                disabled={!notify.enabled}
                control={
                  <Switch
                    size="small"
                    checked={notify[row.key]}
                    onChange={(e) => setNotify(row.key, e.target.checked)}
                  />
                }
                label={
                  <Box sx={{ pt: 0.25 }}>
                    <Typography variant="body2">{row.label}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {row.hint}
                    </Typography>
                  </Box>
                }
              />
            ))}
          </Box>
          <Divider sx={{ my: 1.5 }} />
          <Button
            size="small"
            startIcon={<NotificationsActiveOutlinedIcon />}
            onClick={test}
          >
            Send a test notification
          </Button>
        </Section>

        <Section title="About">
          <Typography variant="body2">
            Stackrun {info?.version ? `v${info.version}` : ''}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', wordBreak: 'break-all', mb: 1 }}
          >
            Data: {info?.dataDir}
          </Typography>
          <Button
            size="small"
            startIcon={<FolderOpenOutlinedIcon />}
            onClick={() => window.electron.app.openDataDir()}
          >
            Open data folder
          </Button>
        </Section>
      </Stack>
      <BottomToast text={toast} onClose={() => setToast(null)} />
    </Box>
  );
}
