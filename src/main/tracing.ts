// Tracing: a local Jaeger in Docker collects the spans of your services (OpenTelemetry,
// OTLP on 4317 / 4318); Stackrun sends its own span for a traced request and reads the
// whole trace back from Jaeger's API to draw it.
import http from 'http';
import type { IpcMain } from 'electron';
import { docker } from './docker';
import {
  collectorRunArgs,
  OTLP_HTTP_PORT,
  otlpSpan,
  ReportedSpan,
  TRACE_CONTAINER,
  TRACE_UI_PORT,
} from './traceModel';

export interface TracingStatus {
  running: boolean;
  exists: boolean;
  error: string | null;
}

export const tracingStatus = async (): Promise<TracingStatus> => {
  const r = await docker(
    ['inspect', '--format', '{{.State.Running}}', TRACE_CONTAINER],
    10000,
  );
  if (r.missing)
    return { running: false, exists: false, error: 'Docker is not installed' };
  if (!r.ok) {
    if (/no such object|no such container/i.test(r.stderr))
      return { running: false, exists: false, error: null };
    return {
      running: false,
      exists: false,
      error: r.stderr.trim().split('\n')[0] || 'Docker does not answer',
    };
  }
  return { running: r.stdout.trim() === 'true', exists: true, error: null };
};

const firstError = (stderr: string) =>
  stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop() || 'Failed';

export const startTracing = async (): Promise<TracingStatus> => {
  const now = await tracingStatus();
  if (now.error || now.running) return now;
  const r = now.exists
    ? await docker(['start', TRACE_CONTAINER], 60000)
    : await docker(collectorRunArgs(), 5 * 60000); // pulls the image the first time
  if (!r.ok) {
    const why = firstError(r.stderr);
    return {
      running: false,
      exists: now.exists,
      error: /port is already allocated|address already in use/i.test(why)
        ? `${why} - something else uses 4317, 4318 or 16686 (another Jaeger / collector?)`
        : why,
    };
  }
  return tracingStatus();
};

export const stopTracing = async () => {
  await docker(['stop', TRACE_CONTAINER], 30000);
  return tracingStatus();
};

const request = (
  method: string,
  port: number,
  path: string,
  body?: string,
): Promise<{ status: number; text: string }> =>
  new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        timeout: 5000,
        headers: body
          ? {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(body),
            }
          : {},
      },
      (res) => {
        let text = '';
        res.setEncoding('utf-8');
        res.on('data', (d) => {
          text += d;
        });
        res.on('end', () => resolve({ status: res.statusCode || 0, text }));
      },
    );
    req.on('error', () => resolve({ status: 0, text: '' }));
    req.on('timeout', () => req.destroy());
    if (body) req.write(body);
    req.end();
  });

/** Stackrun's span: the root of the trace, so it shows where the request came from. */
export const reportSpan = async (span: ReportedSpan) => {
  if (!/^[0-9a-f]{32}$/.test(span.traceId)) return false;
  const r = await request(
    'POST',
    OTLP_HTTP_PORT,
    '/v1/traces',
    JSON.stringify(otlpSpan(span)),
  );
  return r.status >= 200 && r.status < 300;
};

/** The trace as Jaeger has it (null while its spans have not arrived). */
export const getTrace = async (traceId: string) => {
  if (!/^[0-9a-f]{32}$/.test(traceId))
    return { trace: null, error: 'Not a trace id' };
  const r = await request('GET', TRACE_UI_PORT, `/api/traces/${traceId}`);
  if (r.status === 0)
    return { trace: null, error: 'The trace collector does not answer' };
  if (r.status === 404) return { trace: null, error: null };
  try {
    return { trace: JSON.parse(r.text)?.data?.[0] || null, error: null };
  } catch (e) {
    return { trace: null, error: 'Unexpected answer from Jaeger' };
  }
};

export const registerTracingIpc = (ipcMain: IpcMain) => {
  ipcMain.handle('tracing:status', () => tracingStatus());
  ipcMain.handle('tracing:start', () => startTracing());
  ipcMain.handle('tracing:stop', () => stopTracing());
  ipcMain.handle('tracing:report', (e, span: ReportedSpan) =>
    span ? reportSpan(span) : false,
  );
  ipcMain.handle('tracing:get', (e, traceId: string) =>
    getTrace(String(traceId || '')),
  );
};
