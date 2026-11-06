// Tracing (pure): a request sent with "Trace" on carries a W3C traceparent; the services
// (OpenTelemetry) send their spans to a local Jaeger. Here a Jaeger trace becomes what the
// HTTP Client draws: the services and who called whom, and a timeline of the spans.

export const TRACE_UI_PORT = 16686;
export const OTLP_HTTP_PORT = 4318;
export const OTLP_GRPC_PORT = 4317;
export const TRACE_CONTAINER = 'stackrun-tracing';
export const TRACE_IMAGE = 'jaegertracing/all-in-one:1.62.0';
export const STACKRUN_SERVICE = 'Stackrun';

const hex = (bytes: number) =>
  Array.from({ length: bytes }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0'),
  ).join('');

/** A new trace id + the id of Stackrun's own span, and the header that carries them. */
export const newTraceContext = () => {
  const traceId = hex(16);
  const spanId = hex(8);
  return { traceId, spanId, traceparent: `00-${traceId}-${spanId}-01` };
};

/** `docker run` for the collector: OTLP in (4317 / 4318), the Jaeger UI + API on 16686. */
export const collectorRunArgs = () => [
  'run',
  '-d',
  '--name',
  TRACE_CONTAINER,
  '-p',
  `${TRACE_UI_PORT}:16686`,
  '-p',
  `${OTLP_GRPC_PORT}:4317`,
  '-p',
  `${OTLP_HTTP_PORT}:4318`,
  '-e',
  'COLLECTOR_OTLP_ENABLED=true',
  // a frontend in the browser sends its spans straight here
  '-e',
  'COLLECTOR_OTLP_HTTP_CORS_ALLOWED_ORIGINS=*',
  '-e',
  'COLLECTOR_OTLP_HTTP_CORS_ALLOWED_HEADERS=*',
  TRACE_IMAGE,
];

export interface ReportedSpan {
  traceId: string;
  spanId: string;
  method: string;
  url: string;
  startMs: number;
  endMs: number;
  status: number; // 0 = no answer
  error: string | null;
}

/** Stackrun's own span (the root: the request as sent), as OTLP/JSON. */
export const otlpSpan = (s: ReportedSpan) => {
  let path = s.url;
  try {
    path = new URL(s.url).pathname;
  } catch (e) {
    // as typed
  }
  const failed = !!s.error || s.status >= 500 || s.status === 0;
  const attrs: [string, string | number][] = [
    ['http.request.method', s.method],
    ['url.full', s.url],
  ];
  if (s.status) attrs.push(['http.response.status_code', s.status]);
  if (s.error) attrs.push(['error.message', s.error]);
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: STACKRUN_SERVICE } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'stackrun-http-client' },
            spans: [
              {
                traceId: s.traceId,
                spanId: s.spanId,
                name: `${s.method} ${path}`,
                kind: 3, // client
                startTimeUnixNano: `${Math.round(s.startMs)}000000`,
                endTimeUnixNano: `${Math.round(s.endMs)}000000`,
                attributes: attrs.map(([key, v]) => ({
                  key,
                  value:
                    typeof v === 'number'
                      ? { intValue: String(v) }
                      : { stringValue: v },
                })),
                status: failed
                  ? { code: 2, message: s.error || `HTTP ${s.status}` }
                  : { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };
};

// ---------------- a Jaeger trace → spans, services, calls ----------------
export interface TraceSpan {
  id: string;
  parent: string | null;
  service: string;
  name: string;
  kind: string; // server, client, internal, producer, consumer
  startUs: number; // from the start of the trace
  durationUs: number;
  error: boolean;
  status: number | null; // HTTP status, when there is one
  peer: string | null; // where a client span went (host), for a service not traced
  depth: number;
  tags: Record<string, string>;
}

export interface TraceCall {
  from: string;
  to: string;
  count: number;
  errors: number;
  durationUs: number; // the longest of these calls
}

export interface TraceView {
  traceId: string;
  startMs: number; // when it started (epoch ms) - to find the logs of that moment
  durationUs: number;
  spans: TraceSpan[]; // in timeline order (parents before their children)
  services: string[]; // in the order they are reached
  calls: TraceCall[];
  errors: number;
}

const tagValue = (t: any) => String(t?.value ?? '');

/** The host a client span called (newer and older OpenTelemetry names). */
const peerOf = (tags: Record<string, string>) => {
  if (tags['peer.service']) return tags['peer.service'];
  const host = tags['server.address'] || tags['net.peer.name'];
  const port = tags['server.port'] || tags['net.peer.port'];
  if (host) return port ? `${host}:${port}` : host;
  if (tags['db.system']) return tags['db.system'];
  const url = tags['url.full'] || tags['http.url'];
  if (url) {
    try {
      return new URL(url).host;
    } catch (e) {
      return null;
    }
  }
  return null;
};

export const toTraceView = (trace: any): TraceView | null => {
  if (!trace?.spans?.length) return null;
  const processes = trace.processes || {};
  const raw = trace.spans as any[];
  const start = Math.min(...raw.map((s) => Number(s.startTime) || 0));
  const end = Math.max(
    ...raw.map((s) => (Number(s.startTime) || 0) + (Number(s.duration) || 0)),
  );
  const ids = new Set(raw.map((s) => String(s.spanID)));
  const spans: TraceSpan[] = raw.map((s) => {
    const tags: Record<string, string> = {};
    (s.tags || []).forEach((t: any) => {
      tags[t.key] = tagValue(t);
    });
    const parentRef = (s.references || []).find(
      (r: any) => r.refType === 'CHILD_OF' && ids.has(String(r.spanID)),
    );
    const status =
      Number(tags['http.response.status_code'] || tags['http.status_code']) ||
      null;
    return {
      id: String(s.spanID),
      parent: parentRef ? String(parentRef.spanID) : null,
      service: processes[s.processID]?.serviceName || 'unknown',
      name: String(s.operationName || ''),
      kind: tags['span.kind'] || 'internal',
      startUs: (Number(s.startTime) || 0) - start,
      durationUs: Number(s.duration) || 0,
      error:
        tags.error === 'true' ||
        tags['otel.status_code'] === 'ERROR' ||
        (status !== null && status >= 500),
      status,
      peer: null,
      depth: 0,
      tags,
    };
  });
  const byId = new Map(spans.map((s) => [s.id, s]));
  const children = new Map<string | null, TraceSpan[]>();
  spans.forEach((s) => {
    const list = children.get(s.parent) || [];
    list.push(s);
    children.set(s.parent, list);
  });
  // timeline order: depth first, siblings by start
  const ordered: TraceSpan[] = [];
  const walk = (parent: string | null, depth: number) => {
    (children.get(parent) || [])
      .sort((a, b) => a.startUs - b.startUs)
      .forEach((s) => {
        s.depth = depth;
        ordered.push(s);
        walk(s.id, depth + 1);
      });
  };
  walk(null, 0);

  // calls between services: a span whose parent is in another service; a client span
  // with nothing traced under it went to something not traced (a database, an API)
  const calls = new Map<string, TraceCall>();
  const addCall = (from: string, to: string, s: TraceSpan) => {
    const key = `${from}→${to}`;
    const c = calls.get(key) || {
      from,
      to,
      count: 0,
      errors: 0,
      durationUs: 0,
    };
    c.count += 1;
    if (s.error) c.errors += 1;
    c.durationUs = Math.max(c.durationUs, s.durationUs);
    calls.set(key, c);
  };
  ordered.forEach((s) => {
    const parent = s.parent ? byId.get(s.parent) : null;
    if (parent && parent.service !== s.service)
      addCall(parent.service, s.service, s);
    const traced = (children.get(s.id) || []).some(
      (c) => c.service !== s.service,
    );
    if (s.kind === 'client' && !traced) {
      const peer = peerOf(s.tags);
      if (peer && peer !== s.service && s.service !== STACKRUN_SERVICE) {
        s.peer = peer;
        addCall(s.service, peer, s);
      }
    }
  });
  const services: string[] = [];
  const reach = (name: string) => {
    if (!services.includes(name)) services.push(name);
  };
  ordered.forEach((s) => {
    reach(s.service);
    if (s.peer) reach(s.peer);
  });
  return {
    traceId: String(trace.traceID),
    startMs: start / 1000,
    durationUs: end - start,
    spans: ordered,
    services,
    calls: [...calls.values()],
    errors: spans.filter((s) => s.error).length,
  };
};

/** Columns for the diagram: how many calls away from the first service each one is. */
export const serviceLevels = (view: TraceView) => {
  const level = new Map<string, number>();
  if (view.services[0]) level.set(view.services[0], 0);
  // breadth first over the calls; a service reached again keeps its first column
  const reached = () =>
    view.calls.filter((c) => level.has(c.from) && !level.has(c.to));
  for (let next = reached(), guard = 0; next.length && guard < 50; guard += 1) {
    next.forEach((c) => {
      if (!level.has(c.to)) level.set(c.to, (level.get(c.from) || 0) + 1);
    });
    next = reached();
  }
  view.services.forEach((s) => {
    if (!level.has(s)) level.set(s, 0);
  });
  return level;
};

export const usText = (us: number) => {
  if (us >= 1000000) return `${(us / 1000000).toFixed(2)} s`;
  if (us >= 1000) return `${(us / 1000).toFixed(us >= 100000 ? 0 : 1)} ms`;
  return `${Math.round(us)} µs`;
};

// ---------------- logs of the steps (Commands) while the request went through ----------------
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Which step (a command running a service) is this service: OTEL_SERVICE_NAME=… in its
 * command, else the step's name and the service's name containing one another.
 */
export const stepMatches = (
  service: string,
  step: { name: string; command: string },
) => {
  const svc = norm(service);
  if (!svc || service === STACKRUN_SERVICE) return false;
  // something not traced, seen as "host:port": the step whose command has that port
  const port = /^[\w.-]+:(\d{2,5})$/.exec(service)?.[1];
  if (port) return new RegExp(`(^|\\D)${port}(\\D|$)`).test(step.command);
  const named = /OTEL_SERVICE_NAME\s*[=:]\s*["']?([\w.-]+)/.exec(step.command);
  if (named) return norm(named[1]) === svc;
  const name = norm(step.name);
  return !!name && (name.includes(svc) || svc.includes(name));
};

/** error / warn / null - from the words a log line usually has. */
export const logLevel = (text: string): 'error' | 'warn' | null => {
  if (
    /\b(error|err|exception|fatal|failed|unhandled|ECONNREFUSED|5\d\d)\b/i.test(
      text,
    )
  )
    return 'error';
  if (/\b(warn|warning|deprecated|timeout|retry)\b/i.test(text)) return 'warn';
  return null;
};
