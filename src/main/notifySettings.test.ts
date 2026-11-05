import {
  NOTIFY_DEFAULTS,
  noticeDecision,
  readNotifySettings,
} from './notifySettings';

describe('notification settings', () => {
  it('uses the defaults for anything missing or odd', () => {
    expect(readNotifySettings(null)).toEqual(NOTIFY_DEFAULTS);
    expect(
      readNotifySettings({ notify_ok: 'false', notify_ready: 'maybe' }),
    ).toEqual({ ...NOTIFY_DEFAULTS, ok: false });
  });

  it('lets through what is turned on, with a sound only for failures', () => {
    const s = NOTIFY_DEFAULTS;
    expect(noticeDecision(s, 'failed', false)).toEqual({
      show: true,
      sound: true,
    });
    expect(noticeDecision(s, 'ok', false)).toEqual({
      show: true,
      sound: false,
    });
    expect(noticeDecision({ ...s, sound: false }, 'failed', false).sound).toBe(
      false,
    );
    expect(noticeDecision({ ...s, ready: false }, 'ready', false).show).toBe(
      false,
    );
    expect(noticeDecision({ ...s, enabled: false }, 'failed', false)).toEqual({
      show: false,
      sound: false,
    });
  });

  it('can stay quiet while you are looking at the app', () => {
    const s = { ...NOTIFY_DEFAULTS, onlyInBackground: true };
    expect(noticeDecision(s, 'ok', true).show).toBe(false);
    expect(noticeDecision(s, 'ok', false).show).toBe(true);
  });
});
