// The environment of the user's interactive login shell. An app started from the Dock or
// Finder gets a bare PATH, and a login shell alone only reads ~/.zprofile - nvm, sdkman,
// pyenv, asdf, Homebrew lines in ~/.zshrc would be missing, so `java`, `flyway`, `pnpm`...
// end up "command not found". Like VS Code: start the shell once as interactive + login
// and let it print its environment as JSON through this very binary in node mode.
import { execFile } from 'child_process';

const MARK = '__STACKRUN_ENV__';
const TIMEOUT_MS = 10000;

let cached: Promise<NodeJS.ProcessEnv> | null = null;

export const parseEnvDump = (out: string): NodeJS.ProcessEnv | null => {
  const start = out.indexOf(MARK);
  const end = out.lastIndexOf(MARK);
  if (start < 0 || end <= start) return null;
  try {
    const env = JSON.parse(out.slice(start + MARK.length, end));
    return env && typeof env === 'object' ? env : null;
  } catch (e) {
    return null;
  }
};

const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

export const resolveShellEnv = (): Promise<NodeJS.ProcessEnv> => {
  if (process.platform === 'win32') return Promise.resolve({ ...process.env });
  if (!cached) {
    cached = new Promise((resolve) => {
      const shell = process.env.SHELL || '/bin/zsh';
      const script = `${quote(process.execPath)} -e ${quote(
        `process.stdout.write("${MARK}" + JSON.stringify(process.env) + "${MARK}")`,
      )}`;
      execFile(
        shell,
        ['-i', '-l', '-c', script],
        {
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            ELECTRON_NO_ATTACH_CONSOLE: '1',
          },
          timeout: TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout) => {
          const env = parseEnvDump(String(stdout || ''));
          if (!env) {
            resolve({ ...process.env });
            return;
          }
          delete env.ELECTRON_RUN_AS_NODE;
          delete env.ELECTRON_NO_ATTACH_CONSOLE;
          resolve({ ...process.env, ...env });
        },
      );
    });
  }
  return cached;
};
