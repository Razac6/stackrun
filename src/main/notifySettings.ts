// Shared by the main process and the renderer (no Node imports here): which package
// notifications Settings lets through. Stored as strings ('true' / 'false') like every
// other setting; anything missing means the default.

export type NoticeKind = 'ok' | 'failed' | 'ready';

export interface NotifySettings {
  enabled: boolean; // all package notifications
  ok: boolean; // a package is done
  failed: boolean; // a package failed
  ready: boolean; // a package's servers are up
  sound: boolean; // a sound when one fails
  onlyInBackground: boolean; // not while you are looking at Stackrun
}

export const NOTIFY_DEFAULTS: NotifySettings = {
  enabled: true,
  ok: true,
  failed: true,
  ready: true,
  sound: true,
  onlyInBackground: false,
};

export const NOTIFY_KEYS: Record<keyof NotifySettings, string> = {
  enabled: 'notify_enabled',
  ok: 'notify_ok',
  failed: 'notify_failed',
  ready: 'notify_ready',
  sound: 'notify_sound',
  onlyInBackground: 'notify_only_background',
};

export const readNotifySettings = (
  settings: Record<string, string | undefined> | null | undefined,
): NotifySettings => {
  const out = { ...NOTIFY_DEFAULTS };
  (Object.keys(NOTIFY_KEYS) as (keyof NotifySettings)[]).forEach((k) => {
    const raw = settings?.[NOTIFY_KEYS[k]];
    if (raw === 'true') out[k] = true;
    else if (raw === 'false') out[k] = false;
  });
  return out;
};

/** Whether this notice is shown, and with a sound. */
export const noticeDecision = (
  s: NotifySettings,
  kind: NoticeKind,
  appFocused: boolean,
): { show: boolean; sound: boolean } => {
  const show = s.enabled && s[kind] && !(s.onlyInBackground && appFocused);
  return { show, sound: show && kind === 'failed' && s.sound };
};
