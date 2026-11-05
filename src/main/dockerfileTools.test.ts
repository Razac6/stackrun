import {
  buildArgs,
  exposedPorts,
  recipeFor,
  recipeProblem,
  runArgs,
  splitArgs,
} from './dockerfileTools';

const dockerfile = `FROM node:20 AS build
ARG PORT=3000
EXPOSE 3000
EXPOSE 9229/tcp 5000/udp \${PORT}
CMD ["node", "dist/main.js"]
`;

describe('From Dockerfile', () => {
  it('reads EXPOSE lines', () => {
    expect(exposedPorts(dockerfile)).toEqual(['3000', '9229/tcp', '5000/udp']);
  });

  it('starts a recipe from the folder name and the exposed ports', () => {
    const r = recipeFor('x', 'C:\\work\\Orders API\\Dockerfile', dockerfile);
    expect(r).toMatchObject({
      name: 'Orders API',
      image: 'orders-api:dev',
      container: 'orders-api',
      ports: [
        { host: '3000', container: '3000' },
        { host: '9229', container: '9229/tcp' },
        { host: '5000', container: '5000/udp' },
      ],
    });
    expect(recipeProblem(r)).toBeNull();
  });

  it('builds the docker build / run arguments', () => {
    const r = {
      ...recipeFor('x', '/home/me/api/docker/Dockerfile', ''),
      context: '/home/me/api',
      target: 'dev',
      noCache: true,
      buildArgs: [{ key: 'NODE_ENV', value: 'development' }],
      ports: [{ host: '127.0.0.1:8080', container: '80' }],
      env: [{ key: 'DB_URL', value: 'postgres://a b' }],
      volumes: [{ host: '/home/me/api/src', container: '/app/src' }],
      network: 'dev-net',
      extraRun: '--restart unless-stopped -e "MSG=hello world"',
    };
    expect(buildArgs(r)).toEqual([
      'build',
      '-t',
      'docker:dev',
      '-f',
      '/home/me/api/docker/Dockerfile',
      '--target',
      'dev',
      '--no-cache',
      '--build-arg',
      'NODE_ENV=development',
      '/home/me/api',
    ]);
    expect(runArgs(r)).toEqual([
      'run',
      '-d',
      '--name',
      'docker',
      '--network',
      'dev-net',
      '-p',
      '127.0.0.1:8080:80',
      '-e',
      'DB_URL=postgres://a b',
      '-v',
      '/home/me/api/src:/app/src',
      '--restart',
      'unless-stopped',
      '-e',
      'MSG=hello world',
      'docker:dev',
    ]);
    // the context defaults to the Dockerfile's folder
    expect(buildArgs({ ...r, context: '' }).pop()).toBe('/home/me/api/docker');
  });

  it('says what is wrong before running', () => {
    const r = recipeFor('x', '/a/b/Dockerfile', '');
    expect(recipeProblem({ ...r, image: 'Bad Name' })).toMatch(/Image/);
    expect(recipeProblem({ ...r, container: 'has space' })).toMatch(
      /Container/,
    );
    expect(
      recipeProblem({ ...r, ports: [{ host: 'abc', container: '80' }] }),
    ).toMatch(/Port/);
    expect(recipeProblem({ ...r, dockerfile: '' })).toMatch(/Dockerfile/);
  });

  it('splits extra flags like a shell', () => {
    expect(splitArgs(`--a 1 "two words" 'x y' --b="q"`)).toEqual([
      '--a',
      '1',
      'two words',
      'x y',
      '--b="q"',
    ]);
  });
});
