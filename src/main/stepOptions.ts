// Shared by the main process and the renderer (no Node imports here): the "only run if…"
// condition of a saved command, and plain-language hints for why a step failed.

export type ConditionType = 'changed' | 'missing' | 'succeeds';

export interface RunCondition {
  type: ConditionType;
  // changed / missing: paths relative to the working directory, comma separated
  // succeeds: a check command - the step runs only when it exits with 0
  target: string;
}

export const CONDITION_TYPES: ConditionType[] = [
  'changed',
  'missing',
  'succeeds',
];

export const splitPaths = (target: string) =>
  target
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean);

export const normalizeCondition = (raw: any): RunCondition | null => {
  if (!raw || !CONDITION_TYPES.includes(raw.type)) return null;
  const target = String(raw.target || '').trim();
  if (!target) return null;
  return { type: raw.type, target };
};

export const describeCondition = (when?: RunCondition | null) => {
  if (!when) return '';
  if (when.type === 'changed') {
    return `${splitPaths(when.target).join(', ')} changed`;
  }
  if (when.type === 'missing') {
    return `${splitPaths(when.target).join(', ')} missing`;
  }
  return `\`${when.target.split('\n')[0]}\` succeeds`;
};

/** Why a process most likely failed, from its exit code / signal / last output. */
export const exitHint = (
  code: number | null,
  signal: string | null,
  output: string,
): string | null => {
  const tail = output.slice(-4000);
  if (
    code === 127 ||
    /command not found|is not recognized as (the name of )?a cmdlet|not recognized as an internal or external command/i.test(
      tail,
    )
  ) {
    return 'Command not found. The app uses the PATH of your shell (~/.zprofile and ~/.zshrc) - check the name or use the full path.';
  }
  if (
    /Host key verification failed|Permission denied \(publickey/i.test(tail)
  ) {
    return 'SSH refused the connection - check your SSH key / known_hosts in a terminal first.';
  }
  if (
    /could not read Username|terminal prompts disabled|Authentication failed/i.test(
      tail,
    )
  ) {
    return 'Git asked for a login - commands run without a terminal, so set up an SSH key or a credential helper.';
  }
  if (code === 126 || /permission denied/i.test(tail)) {
    return 'Permission denied - not executable (chmod +x?) or no access to a file.';
  }
  if (
    /EADDRINUSE|address already in use|port \d+ is already in use/i.test(tail)
  ) {
    return 'The port is already in use - an earlier run (or another app) still listens on it.';
  }
  if (/ENOSPC|No space left on device/i.test(tail)) {
    return 'The disk is full.';
  }
  if (/heap out of memory|ENOMEM|Cannot allocate memory/i.test(tail)) {
    return 'It ran out of memory.';
  }
  if (signal === 'SIGKILL') {
    return 'Killed (SIGKILL) - by the system (out of memory?) or from outside.';
  }
  if (signal && signal !== 'SIGTERM' && signal !== 'SIGINT') {
    return `It crashed (${signal}).`;
  }
  return null;
};
