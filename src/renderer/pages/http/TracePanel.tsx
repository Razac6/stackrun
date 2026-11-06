// HTTP Client → response → "Trace": how the request went through your services. The
// services send their spans (OpenTelemetry) to a local Jaeger; this draws who called whom
// and a timeline. Off unless "Trace" is on for the request.
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  IconButton,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import type { TracingStatus } from '../../../main/tracing';
import {
  logLevel,
  serviceLevels,
  stepMatches,
  STACKRUN_SERVICE,
  toTraceView,
  TraceSpan,
  TraceView,
  TRACE_UI_PORT,
  usText,
} from '../../../main/traceModel';
import { MONO_FONT } from '../notes/highlight';

const COLORS = [
  '#4e79a7',
  '#f28e2b',
  '#59a14f',
  '#b07aa1',
  '#76b7b2',
  '#edc948',
  '#ff9da7',
  '#9c755f',
  '#e15759',
  '#bab0ac',
];
const colorOf = (service: string, all: string[]) =>
  service === STACKRUN_SERVICE
    ? '#8a8a8a'
    : COLORS[Math.max(0, all.indexOf(service)) % COLORS.length];

// ---------------- how to connect the services ----------------
const DOCKER = `# A Node service in Docker (not started in Commands): the agent goes into its image
npm i @opentelemetry/api @opentelemetry/auto-instrumentations-node

# docker-compose.yml, the service's environment:
    environment:
      NODE_OPTIONS: --require @opentelemetry/auto-instrumentations-node/register
      OTEL_SERVICE_NAME: order          # its name on the diagram
      OTEL_TRACES_EXPORTER: otlp
      OTEL_EXPORTER_OTLP_ENDPOINT: http://host.docker.internal:4318
      OTEL_METRICS_EXPORTER: none
      OTEL_LOGS_EXPORTER: none
    extra_hosts:
      - host.docker.internal:host-gateway   # Linux / Colima
`;

const AZURE = `# Azure Functions (Node): "func start" in Commands with Trace ticked should be enough.
# If its spans do not show up, the agent can go into the project instead:
npm i @opentelemetry/api @opentelemetry/auto-instrumentations-node

# local.settings.json → "Values":
    "OTEL_SERVICE_NAME": "payments-fn",
    "OTEL_TRACES_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318",
    "OTEL_METRICS_EXPORTER": "none",
    "OTEL_LOGS_EXPORTER": "none",
    "languageWorkers__node__arguments": "--require @opentelemetry/auto-instrumentations-node/register"`;

const WEB = `// Angular / React: a frontend's calls start their own traces (see them in Jaeger)
// npm i @opentelemetry/sdk-trace-web @opentelemetry/exporter-trace-otlp-http \\
//   @opentelemetry/instrumentation @opentelemetry/instrumentation-fetch \\
//   @opentelemetry/instrumentation-xml-http-request @opentelemetry/resources
// tracing.ts - imported first in main.ts, in dev builds only
import { WebTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import { resourceFromAttributes } from '@opentelemetry/resources';

const provider = new WebTracerProvider({
  resource: resourceFromAttributes({ 'service.name': 'frontend' }),
  spanProcessors: [
    new BatchSpanProcessor(new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' })),
  ],
});
provider.register();
// the traceparent header goes to your APIs too (their CORS has to allow "traceparent")
const apis = [/localhost/];
registerInstrumentations({
  instrumentations: [
    new FetchInstrumentation({ propagateTraceHeaderCorsUrls: apis }),
    new XMLHttpRequestInstrumentation({ propagateTraceHeaderCorsUrls: apis }),
  ],
});`;

function Snippet({ text }: { text: string }) {
  return (
    <Box sx={{ position: 'relative' }}>
      <Tooltip title="Copy">
        <IconButton
          size="small"
          onClick={() => navigator.clipboard.writeText(text)}
          sx={{ position: 'absolute', top: 4, right: 4 }}
          aria-label="Copy"
        >
          <ContentCopyIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1,
          pr: 4,
          bgcolor: 'action.hover',
          borderRadius: 1,
          fontFamily: MONO_FONT,
          fontSize: 11.5,
          overflow: 'auto',
          whiteSpace: 'pre',
        }}
      >
        {text}
      </Box>
    </Box>
  );
}

export function TraceSetup({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [tab, setTab] = useState('commands');
  return (
    <Accordion
      defaultExpanded={defaultOpen}
      disableGutters
      variant="outlined"
      sx={{ mt: 1 }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          How to connect your services
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Each service sends its spans (OpenTelemetry) to the collector here.
          The traceparent header Stackrun adds is picked up on its own and
          passed on to the services it calls.
        </Typography>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ minHeight: 32, mb: 1 }}
        >
          <Tab
            value="commands"
            label="Started in Commands"
            sx={{ minHeight: 32 }}
          />
          <Tab value="docker" label="In Docker" sx={{ minHeight: 32 }} />
          <Tab value="azure" label="Azure Functions" sx={{ minHeight: 32 }} />
          <Tab value="web" label="Angular / React" sx={{ minHeight: 32 }} />
        </Tabs>
        {tab === 'commands' && (
          <Box
            component="ol"
            sx={{ m: 0, pl: 2.5, fontSize: 13.5, '& li': { mb: 0.5 } }}
          >
            <li>
              Commands → edit the step that starts the service (NestJS, Node,
              Azure Functions) → tick <b>Trace</b>. Nothing to install in the
              service.
            </li>
            <li>
              Start it again. The first time Stackrun gets the OpenTelemetry
              agent (npm, once) and starts the collector; its log says{' '}
              <code>Traced as "order"</code> - the step&apos;s name is the name
              on the diagram.
            </li>
            <li>
              Here: Trace on for the request (the icon next to Send), send it,
              open this tab. The logs of those steps show under their spans.
            </li>
          </Box>
        )}
        {tab === 'docker' && <Snippet text={DOCKER} />}
        {tab === 'azure' && <Snippet text={AZURE} />}
        {tab === 'web' && <Snippet text={WEB} />}
      </AccordionDetails>
    </Accordion>
  );
}

// ---------------- the diagram: services and the calls between them ----------------
const NODE_W = 150;
const NODE_H = 46;
const COL_W = 220;
const ROW_H = 70;

function ServiceMap({ view }: { view: TraceView }) {
  const theme = useTheme();
  const levels = useMemo(() => serviceLevels(view), [view]);
  const pos = useMemo(() => {
    const rows = new Map<number, number>();
    const at = new Map<string, { x: number; y: number }>();
    view.services.forEach((s) => {
      const col = levels.get(s) || 0;
      const row = rows.get(col) || 0;
      rows.set(col, row + 1);
      at.set(s, { x: 10 + col * COL_W, y: 10 + row * ROW_H });
    });
    return at;
  }, [view, levels]);
  const width = Math.max(...[...pos.values()].map((p) => p.x)) + NODE_W + 20;
  const height = Math.max(...[...pos.values()].map((p) => p.y)) + NODE_H + 20;
  const stats = (service: string) => {
    const mine = view.spans.filter((s) => s.service === service);
    return {
      spans: mine.length,
      errors: mine.filter((s) => s.error).length,
      longest: Math.max(0, ...mine.map((s) => s.durationUs)),
      traced: mine.length > 0,
    };
  };
  const red = theme.palette.error.main;
  const line = theme.palette.text.secondary;
  return (
    <Box
      sx={{
        overflow: 'auto',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
      }}
    >
      <svg width={width} height={height} style={{ display: 'block' }}>
        <defs>
          <marker
            id="trace-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={line} />
          </marker>
          <marker
            id="trace-arrow-red"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={red} />
          </marker>
        </defs>
        {view.calls.map((c) => {
          const a = pos.get(c.from);
          const b = pos.get(c.to);
          if (!a || !b) return null;
          const back = b.x <= a.x; // a call back to an earlier column
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = back ? b.x + NODE_W / 2 : b.x;
          const y2 = back ? b.y + (b.y > a.y ? 0 : NODE_H) : b.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          const d = back
            ? `M ${x1} ${y1} C ${x1 + 60} ${y1}, ${x2} ${y2 + (b.y > a.y ? -60 : 60)}, ${x2} ${y2}`
            : `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
          const bad = c.errors > 0;
          return (
            <g key={`${c.from}→${c.to}`}>
              <path
                d={d}
                fill="none"
                stroke={bad ? red : line}
                strokeWidth={bad ? 2 : 1.4}
                markerEnd={`url(#${bad ? 'trace-arrow-red' : 'trace-arrow'})`}
              />
              <text
                x={mx}
                y={(y1 + y2) / 2 - 6}
                textAnchor="middle"
                fontSize={11}
                fontFamily={MONO_FONT}
                fill={bad ? red : line}
              >
                {c.count > 1 ? `${c.count}× ` : ''}
                {usText(c.durationUs)}
                {bad ? ` · ${c.errors} failed` : ''}
              </text>
            </g>
          );
        })}
        {view.services.map((s) => {
          const p = pos.get(s)!;
          const st = stats(s);
          const color = colorOf(s, view.services);
          return (
            <g key={s}>
              <title>
                {st.traced
                  ? `${s}: ${st.spans} span(s), longest ${usText(st.longest)}`
                  : `${s}: called, not traced (a database or an API without OpenTelemetry)`}
              </title>
              <rect
                x={p.x}
                y={p.y}
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={alpha(color, st.traced ? 0.16 : 0.05)}
                stroke={st.errors ? red : color}
                strokeWidth={st.errors ? 2 : 1.5}
                strokeDasharray={st.traced ? undefined : '4 3'}
              />
              <text
                x={p.x + NODE_W / 2}
                y={p.y + 19}
                textAnchor="middle"
                fontSize={12.5}
                fontWeight={700}
                fill={theme.palette.text.primary}
              >
                {s.length > 20 ? `${s.slice(0, 19)}…` : s}
              </text>
              <text
                x={p.x + NODE_W / 2}
                y={p.y + 35}
                textAnchor="middle"
                fontSize={10.5}
                fill={st.errors ? red : theme.palette.text.secondary}
              >
                {st.traced
                  ? `${st.spans} span${st.spans === 1 ? '' : 's'}${st.errors ? ` · ${st.errors} error${st.errors === 1 ? '' : 's'}` : ''}`
                  : 'not traced'}
              </text>
            </g>
          );
        })}
      </svg>
    </Box>
  );
}

// ---------------- the timeline ----------------
// ---------------- logs of the steps (Commands) at the time of the trace ----------------
type StepLogs = Awaited<
  ReturnType<typeof window.electron.commands.logsBetween>
>;

const msFrom = (at: number, startMs: number) => {
  const d = at - startMs;
  return `${d >= 0 ? '+' : ''}${Math.round(d)} ms`;
};

function LogLines({
  lines,
  startMs,
  traceId,
}: {
  lines: { at: number; text: string; step?: string }[];
  startMs: number;
  traceId: string;
}) {
  const theme = useTheme();
  return (
    <Box
      sx={{
        fontFamily: MONO_FONT,
        fontSize: 11.5,
        maxHeight: 260,
        overflow: 'auto',
      }}
    >
      {lines.map((l, i) => {
        const level = logLevel(l.text);
        const mine = l.text.includes(traceId);
        return (
          <Box
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            sx={{
              display: 'flex',
              gap: 1,
              px: 0.5,
              borderLeft: 3,
              borderColor: mine ? 'primary.main' : 'transparent',
              bgcolor:
                // eslint-disable-next-line no-nested-ternary
                level === 'error'
                  ? alpha(theme.palette.error.main, 0.1)
                  : level === 'warn'
                    ? alpha(theme.palette.warning.main, 0.1)
                    : undefined,
            }}
            title={mine ? 'This line has the trace id' : undefined}
          >
            <Box sx={{ color: 'text.disabled', flexShrink: 0, minWidth: 64 }}>
              {msFrom(l.at, startMs)}
            </Box>
            {l.step && (
              <Box sx={{ color: 'text.secondary', flexShrink: 0 }}>
                [{l.step}]
              </Box>
            )}
            <Box sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {l.text}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

/** The logs of the step running this service, while this span ran (a bit after too). */
const spanLogs = (s: TraceSpan, view: TraceView, logs: StepLogs) => {
  const from = view.startMs + s.startUs / 1000 - 50;
  const to = view.startMs + (s.startUs + s.durationUs) / 1000 + 300;
  return logs
    .filter(
      (st) =>
        stepMatches(s.service, st) || (!!s.peer && stepMatches(s.peer, st)),
    )
    .flatMap((st) => st.lines)
    .filter((l) => l.at >= from && l.at <= to)
    .sort((a, b) => a.at - b.at);
};

function TraceLogs({ view, logs }: { view: TraceView; logs: StepLogs }) {
  const [onlyMatched, setOnlyMatched] = useState(false);
  const serviceOf = (st: StepLogs[number]) =>
    view.services.find((svc) => stepMatches(svc, st)) || null;
  const shown = logs.filter((st) => !onlyMatched || serviceOf(st));
  const lines = shown
    .flatMap((st) =>
      st.lines.map((l) => ({
        ...l,
        step: serviceOf(st) ? `${st.name} · ${serviceOf(st)}` : st.name,
      })),
    )
    .sort((a, b) => a.at - b.at);
  const errors = lines.filter((l) => logLevel(l.text) === 'error').length;
  return (
    <Box sx={{ mt: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="subtitle2">Logs</Typography>
        <Typography variant="caption" color="text.secondary">
          from your running commands, at the time of the request ·{' '}
          {lines.length} line{lines.length === 1 ? '' : 's'}
          {errors ? ` · ${errors} with errors` : ''}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Chip
          size="small"
          label="Only the traced services"
          color={onlyMatched ? 'primary' : 'default'}
          variant={onlyMatched ? 'filled' : 'outlined'}
          onClick={() => setOnlyMatched((v) => !v)}
        />
      </Box>
      {lines.length ? (
        <Box
          sx={{ border: 1, borderColor: 'divider', borderRadius: 1, py: 0.5 }}
        >
          <LogLines
            lines={lines}
            startMs={view.startMs}
            traceId={view.traceId}
          />
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {logs.length
            ? 'None of these steps is one of the traced services (name the step like the service, or put OTEL_SERVICE_NAME=… in its command).'
            : 'Nothing printed by a running command at that time. Services started in Commands show their logs here.'}
        </Typography>
      )}
    </Box>
  );
}

const SHOWN_TAGS =
  /^(http\.|url\.|server\.|db\.|rpc\.|messaging\.|peer\.|net\.|error|exception|code\.|faas\.)/;

function Timeline({ view, logs }: { view: TraceView; logs: StepLogs }) {
  const theme = useTheme();
  const [open, setOpen] = useState<string | null>(null);
  const total = Math.max(1, view.durationUs);
  return (
    <Box sx={{ fontSize: 12 }}>
      {view.spans.map((s: TraceSpan) => {
        const color = colorOf(s.service, view.services);
        const left = (s.startUs / total) * 100;
        const width = Math.max(0.4, (s.durationUs / total) * 100);
        const tags = Object.entries(s.tags).filter(([k]) => SHOWN_TAGS.test(k));
        const own = open === s.id ? spanLogs(s, view, logs) : [];
        const logCount = logs.length
          ? spanLogs(s, view, logs).filter((l) => logLevel(l.text) === 'error')
              .length
          : 0;
        return (
          <Box key={s.id}>
            <Box
              onClick={() => setOpen(open === s.id ? null : s.id)}
              sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 340px) minmax(0, 1fr) 70px',
                alignItems: 'center',
                gap: 1,
                py: 0.3,
                cursor: 'pointer',
                borderRadius: 0.5,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  pl: s.depth * 1.5,
                  minWidth: 0,
                }}
              >
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: color,
                    flexShrink: 0,
                  }}
                />
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, flexShrink: 0 }}
                >
                  {s.service}
                </Typography>
                <Typography
                  variant="caption"
                  noWrap
                  sx={{
                    fontFamily: MONO_FONT,
                    color: s.error ? 'error.main' : 'text.secondary',
                  }}
                  title={s.name}
                >
                  {s.name}
                  {s.peer ? ` → ${s.peer}` : ''}
                </Typography>
                {logCount > 0 && (
                  <Tooltip
                    title={`${logCount} log line(s) with errors - click to see`}
                  >
                    <Chip
                      size="small"
                      color="error"
                      label={`${logCount} log`}
                      sx={{ height: 16, fontSize: 10, flexShrink: 0 }}
                    />
                  </Tooltip>
                )}
              </Box>
              <Box sx={{ position: 'relative', height: 12 }}>
                <Box
                  sx={{
                    position: 'absolute',
                    left: `${left}%`,
                    width: `${width}%`,
                    top: 0,
                    bottom: 0,
                    borderRadius: 0.5,
                    bgcolor: s.error ? theme.palette.error.main : color,
                    opacity: 0.85,
                  }}
                />
              </Box>
              <Typography
                variant="caption"
                align="right"
                sx={{ fontFamily: MONO_FONT }}
              >
                {usText(s.durationUs)}
              </Typography>
            </Box>
            {open === s.id && (
              <Box
                sx={{
                  ml: s.depth * 1.5 + 2,
                  mb: 0.5,
                  p: 0.75,
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  fontFamily: MONO_FONT,
                  fontSize: 11.5,
                }}
              >
                <div>
                  {s.kind} · starts at {usText(s.startUs)}
                  {s.status ? ` · HTTP ${s.status}` : ''}
                </div>
                {tags.map(([k, v]) => (
                  <div key={k} style={{ wordBreak: 'break-all' }}>
                    <b>{k}</b>: {v}
                  </div>
                ))}
                {own.length > 0 && (
                  <Box sx={{ mt: 0.75 }}>
                    <b>Logs of {s.service} meanwhile</b>
                    <LogLines
                      lines={own}
                      startMs={view.startMs}
                      traceId={view.traceId}
                    />
                  </Box>
                )}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

// ---------------- the panel ----------------
export default function TracePanel({
  traceId,
  onResend,
}: {
  traceId: string;
  onResend?: () => void; // send the request again (a new trace)
}) {
  const [status, setStatus] = useState<TracingStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [view, setView] = useState<TraceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [logs, setLogs] = useState<StepLogs>([]);
  const [full, setFull] = useState(false); // the trace over the whole window
  const timer = useRef<ReturnType<typeof setTimeout>>();

  // spans arrive in batches (a few seconds after the request): ask until it settles
  const load = useCallback(
    (tries = 10, lastCount = -1) => {
      clearTimeout(timer.current);
      setWaiting(true);
      window.electron.tracing
        .get(traceId)
        .then((r) => {
          setError(r.error);
          const v = toTraceView(r.trace);
          if (v) setView(v);
          const count = v?.spans.length ?? 0;
          // settled: the same spans twice in a row, after more than Stackrun's own
          const settled = count > 1 && count === lastCount;
          if (!r.error && !settled && tries > 1)
            timer.current = setTimeout(() => load(tries - 1, count), 1500);
          else setWaiting(false);
          return v;
        })
        .catch(() => setWaiting(false));
    },
    [traceId],
  );

  // the commands' logs from just before the request to a little after it
  useEffect(() => {
    if (!view || waiting) return;
    window.electron.commands
      .logsBetween(
        view.startMs - 1000,
        view.startMs + view.durationUs / 1000 + 3000,
      )
      .then(setLogs)
      .catch(() => setLogs([]));
  }, [view, waiting]);

  useEffect(() => {
    setView(null);
    setLogs([]);
    window.electron.tracing
      .status()
      .then((s) => {
        setStatus(s);
        if (s.running) load();
        return s;
      })
      .catch(() => setStatus(null));
    return () => clearTimeout(timer.current);
  }, [traceId, load]);

  if (!status) return null;

  if (!status.running)
    return (
      <Box sx={{ p: 1, width: 0, minWidth: '100%' }}>
        <Alert
          severity="info"
          action={
            <Button
              color="inherit"
              size="small"
              disabled={starting || !!status.error}
              startIcon={
                starting ? <CircularProgress size={14} /> : <PlayArrowIcon />
              }
              onClick={async () => {
                setStarting(true);
                const s = await window.electron.tracing.start();
                setStarting(false);
                setStatus(s);
                // this request went out before: its spans were not collected
                if (s.running && onResend) onResend();
              }}
            >
              Start collector
            </Button>
          }
        >
          {status.error ||
            'The trace collector is not running (a small Jaeger in Docker, ports 4317, 4318, 16686). Start it - the request is sent again, now traced.'}
        </Alert>
        <TraceSetup defaultOpen />
      </Box>
    );

  const onlyStackrun =
    view && view.spans.every((s) => s.service === STACKRUN_SERVICE);
  const panel = (
    // width 0 + minWidth 100%: as wide as the response pane, never wider - the
    // diagram and long log lines scroll inside instead of widening the whole page
    <Box sx={{ p: full ? 2 : 0.5, width: 0, minWidth: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        {view && (
          <>
            <Chip
              size="small"
              color={view.errors ? 'error' : 'success'}
              variant="outlined"
              label={
                view.errors
                  ? `${view.errors} failed span${view.errors === 1 ? '' : 's'}`
                  : 'No errors'
              }
            />
            <Typography variant="caption" color="text.secondary">
              {usText(view.durationUs)} · {view.services.length} service
              {view.services.length === 1 ? '' : 's'} · {view.spans.length}{' '}
              spans
            </Typography>
          </>
        )}
        {waiting && <CircularProgress size={14} />}
        <Box sx={{ flex: 1 }} />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontFamily: MONO_FONT }}
        >
          {traceId}
        </Typography>
        <Tooltip title="Ask Jaeger again">
          <IconButton size="small" onClick={() => load()} aria-label="Refresh">
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Open in Jaeger">
          <IconButton
            size="small"
            onClick={() =>
              window.electron.shell.openExternal(
                `http://localhost:${TRACE_UI_PORT}/trace/${traceId}`,
              )
            }
            aria-label="Open in Jaeger"
          >
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={full ? 'Exit full screen (Esc)' : 'Full screen'}>
          <IconButton
            size="small"
            onClick={() => setFull(!full)}
            aria-label={full ? 'Exit full screen' : 'Full screen'}
          >
            {full ? (
              <FullscreenExitIcon fontSize="small" />
            ) : (
              <FullscreenIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
      </Box>
      {error && <Alert severity="warning">{error}</Alert>}
      {!view && !error && waiting && (
        <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
          Waiting for the spans of your services…
        </Typography>
      )}
      {view && (
        <>
          <ServiceMap view={view} />
          <Box sx={{ mt: 1.5 }}>
            <Timeline view={view} logs={logs} />
          </Box>
          {!waiting && <TraceLogs view={view} logs={logs} />}
        </>
      )}
      {!waiting && !error && (onlyStackrun || !view) && (
        <>
          <Alert
            severity={view ? 'warning' : 'info'}
            sx={{ mt: 1 }}
            action={
              onResend ? (
                <Button color="inherit" size="small" onClick={onResend}>
                  Send again
                </Button>
              ) : undefined
            }
          >
            {view
              ? 'Only Stackrun sent its part - your services did not send spans. Is Trace ticked on their steps in Commands, and were they started again after that?'
              : 'Nothing arrived for this trace - it was probably sent before the collector was running. Send it again.'}
          </Alert>
          <TraceSetup defaultOpen={!!view} />
        </>
      )}
    </Box>
  );
  return (
    <>
      {full ? (
        <Box sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            The trace is open full screen.
          </Typography>
          <Button size="small" onClick={() => setFull(false)}>
            Back here
          </Button>
        </Box>
      ) : (
        panel
      )}
      <Dialog fullScreen open={full} onClose={() => setFull(false)}>
        {full && panel}
      </Dialog>
    </>
  );
}
