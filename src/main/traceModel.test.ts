import {
  logLevel,
  newTraceContext,
  otlpSpan,
  serviceLevels,
  stepMatches,
  toTraceView,
  usText,
} from './traceModel';

// what Jaeger's /api/traces/<id> gives: Stackrun → order → payment → (inventory, untraced)
const jaeger = {
  traceID: 'abc',
  processes: {
    p1: { serviceName: 'Stackrun' },
    p2: { serviceName: 'order' },
    p3: { serviceName: 'payment' },
  },
  spans: [
    {
      spanID: 's0',
      operationName: 'GET /orders/7',
      references: [],
      startTime: 1000,
      duration: 60000,
      processID: 'p1',
      tags: [{ key: 'span.kind', value: 'client' }],
    },
    {
      spanID: 's1',
      operationName: 'GET /orders/:id',
      references: [{ refType: 'CHILD_OF', spanID: 's0' }],
      startTime: 2000,
      duration: 40000,
      processID: 'p2',
      tags: [
        { key: 'span.kind', value: 'server' },
        { key: 'http.response.status_code', value: 200 },
      ],
    },
    {
      spanID: 's2',
      operationName: 'GET',
      references: [{ refType: 'CHILD_OF', spanID: 's1' }],
      startTime: 3000,
      duration: 30000,
      processID: 'p2',
      tags: [{ key: 'span.kind', value: 'client' }],
    },
    {
      spanID: 's3',
      operationName: 'GET /pay',
      references: [{ refType: 'CHILD_OF', spanID: 's2' }],
      startTime: 4000,
      duration: 20000,
      processID: 'p3',
      tags: [{ key: 'span.kind', value: 'server' }],
    },
    {
      spanID: 's4',
      operationName: 'GET',
      references: [{ refType: 'CHILD_OF', spanID: 's3' }],
      startTime: 5000,
      duration: 10000,
      processID: 'p3',
      tags: [
        { key: 'span.kind', value: 'client' },
        { key: 'server.address', value: '127.0.0.1' },
        { key: 'server.port', value: 3103 },
        { key: 'http.response.status_code', value: 503 },
      ],
    },
  ],
};

describe('tracing', () => {
  it('makes a W3C traceparent', () => {
    const t = newTraceContext();
    expect(t.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(t.traceparent).toContain(t.traceId);
  });

  it("sends Stackrun's span as OTLP/JSON", () => {
    const body = otlpSpan({
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      method: 'GET',
      url: 'http://localhost:3101/orders/7?x=1',
      startMs: 1000,
      endMs: 1060,
      status: 502,
      error: null,
    });
    const span = body.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.name).toBe('GET /orders/7');
    expect(span.startTimeUnixNano).toBe('1000000000');
    expect(span.status.code).toBe(2);
  });

  it('turns a Jaeger trace into services, calls and a timeline', () => {
    const v = toTraceView(jaeger)!;
    expect(v.services).toEqual([
      'Stackrun',
      'order',
      'payment',
      '127.0.0.1:3103',
    ]);
    expect(v.calls.map((c) => `${c.from}→${c.to}`)).toEqual([
      'Stackrun→order',
      'order→payment',
      'payment→127.0.0.1:3103',
    ]);
    expect(v.calls[2].errors).toBe(1);
    expect(v.spans.map((s) => s.depth)).toEqual([0, 1, 2, 3, 4]);
    expect(v.errors).toBe(1);
    expect(v.startMs).toBe(1);
    expect([...serviceLevels(v).values()]).toEqual([0, 1, 2, 3]);
    expect(toTraceView({ spans: [] })).toBeNull();
    expect(usText(43742)).toBe('43.7 ms');
  });

  it('finds the step that runs a service, and errors in its logs', () => {
    expect(
      stepMatches('order', { name: 'Order API', command: 'npm start' }),
    ).toBe(true);
    expect(
      stepMatches('order', {
        name: 'api',
        command: 'OTEL_SERVICE_NAME=order npm run start:dev',
      }),
    ).toBe(true);
    expect(
      stepMatches('payment', {
        name: 'payment-old',
        command: 'OTEL_SERVICE_NAME=billing node x',
      }),
    ).toBe(false);
    expect(stepMatches('Stackrun', { name: 'stackrun', command: '' })).toBe(
      false,
    );
    expect(
      stepMatches('127.0.0.1:3103', {
        name: 'inventory',
        command: 'node svc.js inventory 3103',
      }),
    ).toBe(true);
    expect(
      stepMatches('127.0.0.1:3103', { name: 'x', command: 'node a.js 31030' }),
    ).toBe(false);
    expect(logLevel('[Nest] ERROR [ExceptionsHandler] boom')).toBe('error');
    expect(logLevel('WARN slow query')).toBe('warn');
    expect(logLevel('GET /orders 200 12ms')).toBeNull();
  });
});
