import { serviceNameOf, tracedEnv } from './otelAgent';

describe('tracing a step without touching the service', () => {
  it('names the service after the step', () => {
    expect(serviceNameOf('Payment API')).toBe('payment-api');
    expect(serviceNameOf('  order  ')).toBe('order');
    expect(serviceNameOf('!!!')).toBe('service');
  });

  it('adds the agent and where to send spans, keeping what is set', () => {
    const env = tracedEnv(
      { PATH: '/bin', NODE_OPTIONS: '--max-old-space-size=4096' },
      'Order API',
      '/Users/me/Library/Application Support/Stackrun/otel/register.js',
    );
    expect(env.NODE_OPTIONS).toBe(
      '--max-old-space-size=4096 --require "/Users/me/Library/Application Support/Stackrun/otel/register.js"',
    );
    expect(env.OTEL_SERVICE_NAME).toBe('order-api');
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe('http://localhost:4318');
    expect(env.PATH).toBe('/bin');
    // a name set already wins
    expect(
      tracedEnv({ OTEL_SERVICE_NAME: 'orders' }, 'x', '/a/register.js')
        .OTEL_SERVICE_NAME,
    ).toBe('orders');
    // Windows paths go with forward slashes (NODE_OPTIONS is parsed like a shell line)
    expect(
      tracedEnv({}, 'x', 'C:\\Users\\me\\agent\\register.js').NODE_OPTIONS,
    ).toBe('--require C:/Users/me/agent/register.js');
  });
});
