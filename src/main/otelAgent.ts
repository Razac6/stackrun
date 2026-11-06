// Tracing without touching the services: Stackrun keeps the OpenTelemetry Node agent in
// its own folder (installed once, with npm) and a step with "Trace" on gets it through
// NODE_OPTIONS, plus where to send its spans - like the OpenTelemetry Operator does.
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';

export const AGENT_PACKAGES = [
  '@opentelemetry/auto-instrumentations-node@^0.81.2',
  '@opentelemetry/api@^1.9.1',
];

let dir = '';
export const setAgentDir = (d: string) => {
  dir = d;
};

export const agentRegister = (base = dir) =>
  path.join(
    base,
    'node_modules',
    '@opentelemetry',
    'auto-instrumentations-node',
    'build',
    'src',
    'register.js',
  );

export const agentInstalled = () => !!dir && fs.existsSync(agentRegister());

let installing: Promise<{ ok: boolean; error: string | null }> | null = null;

/** npm install into Stackrun's folder - once; later calls wait for the same one. */
export const installAgent = (
  env: NodeJS.ProcessEnv,
): Promise<{ ok: boolean; error: string | null }> => {
  if (agentInstalled()) return Promise.resolve({ ok: true, error: null });
  if (!dir)
    return Promise.resolve({ ok: false, error: 'No folder for the agent' });
  if (installing) return installing;
  fs.mkdirSync(dir, { recursive: true });
  const pkg = path.join(dir, 'package.json');
  if (!fs.existsSync(pkg))
    fs.writeFileSync(
      pkg,
      JSON.stringify({ name: 'stackrun-otel-agent', private: true }),
    );
  installing = new Promise((resolve) => {
    execFile(
      'npm',
      ['install', '--no-audit', '--no-fund', '--omit=dev', ...AGENT_PACKAGES],
      {
        cwd: dir,
        env,
        shell: process.platform === 'win32', // npm.cmd
        timeout: 5 * 60000,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        installing = null;
        if (agentInstalled()) resolve({ ok: true, error: null });
        else
          resolve({
            ok: false,
            error:
              (error as any)?.code === 'ENOENT'
                ? 'npm was not found - install Node.js'
                : String(stderr || error?.message || 'npm install failed')
                    .trim()
                    .split('\n')
                    .slice(-3)
                    .join('\n'),
          });
      },
    );
  });
  return installing;
};

/** "Payment API" → "payment-api": the name on the trace diagram. */
export const serviceNameOf = (stepName: string) =>
  stepName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'service';

const quoteForNode = (p: string) => (/\s/.test(p) ? `"${p}"` : p);

/**
 * The env of a traced step: the agent in NODE_OPTIONS (after what is there already) and
 * OTLP to the local collector. OTEL_* set in the env or in the command itself win.
 */
export const tracedEnv = (
  env: NodeJS.ProcessEnv,
  stepName: string,
  register = agentRegister(),
): NodeJS.ProcessEnv => {
  const require = `--require ${quoteForNode(register.replace(/\\/g, '/'))}`;
  const keep = (k: string, v: string) => (env[k] ? {} : { [k]: v });
  return {
    ...env,
    NODE_OPTIONS: [env.NODE_OPTIONS, require].filter(Boolean).join(' '),
    ...keep('OTEL_SERVICE_NAME', serviceNameOf(stepName)),
    ...keep('OTEL_TRACES_EXPORTER', 'otlp'),
    ...keep('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://localhost:4318'),
    ...keep('OTEL_EXPORTER_OTLP_PROTOCOL', 'http/protobuf'),
    ...keep('OTEL_METRICS_EXPORTER', 'none'),
    ...keep('OTEL_LOGS_EXPORTER', 'none'),
    // spans go out within a second, not every 5 s
    ...keep('OTEL_BSP_SCHEDULE_DELAY', '1000'),
  };
};
