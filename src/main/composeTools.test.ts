import {
  COMPOSE_FILE_RE,
  composeDownArgs,
  composeUpArgs,
  legacyArgs,
  noComposePlugin,
} from './composeTools';

describe('composeTools', () => {
  const r = { id: 'c1', file: '/work/orders/docker-compose.yml', build: false };

  it('builds the up / down arguments', () => {
    expect(composeUpArgs(r)).toEqual([
      'compose',
      '-f',
      '/work/orders/docker-compose.yml',
      'up',
      '-d',
    ]);
    expect(composeUpArgs({ ...r, build: true }).slice(-1)).toEqual(['--build']);
    expect(composeDownArgs(r).slice(-1)).toEqual(['down']);
    expect(legacyArgs(composeDownArgs(r))[0]).toBe('-f');
  });

  it('knows compose files and a missing plugin', () => {
    expect(COMPOSE_FILE_RE.test('C:\\x\\docker-compose.yml')).toBe(true);
    expect(COMPOSE_FILE_RE.test('/x/compose.dev.yaml')).toBe(true);
    expect(COMPOSE_FILE_RE.test('/x/values.yaml')).toBe(false);
    expect(noComposePlugin("docker: 'compose' is not a docker command.")).toBe(
      true,
    );
  });
});
