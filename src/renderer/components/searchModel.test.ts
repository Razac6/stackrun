import { matchScore, searchAll, SearchSources } from './searchModel';
import { emptyState, newCollection, newRequest } from '../pages/http/httpModel';

const src: SearchSources = {
  tools: [
    { page: 'commands', text: 'Commands' },
    { page: 'docker', text: 'Docker' },
  ],
  notes: [
    {
      id: 1,
      title: 'Docker cheatsheet',
      content: 'prune volumes',
      tags: ['ops'],
    },
    { id: 2, title: 'Release', content: 'remember to bump the docker image' },
  ],
  commands: {
    groups: [
      {
        id: 'g1',
        name: 'Backend',
        stopOnError: true,
        collapsed: false,
        commands: [
          {
            id: 'c1',
            name: 'Nest dev',
            command: 'npm run start:dev',
            cwd: '~/api',
            wait: false,
          },
        ],
      },
      {
        id: 'g2',
        name: 'Stack',
        stopOnError: true,
        collapsed: false,
        commands: [
          {
            id: 'c2',
            name: '',
            command: '',
            cwd: '',
            wait: true,
            packageId: 'g1',
          },
        ],
      },
    ],
  },
  http: {
    ...emptyState(),
    collections: [
      newCollection({
        name: 'Auth',
        requests: [
          newRequest({
            id: 'r1',
            name: 'Login',
            method: 'POST',
            url: '{{host}}/auth/login',
          }),
        ],
      }),
    ],
  },
};

describe('search', () => {
  it('needs every word, and ranks titles over content', () => {
    expect(matchScore('dock sheet', 'Docker cheatsheet')).toBeGreaterThan(0);
    expect(matchScore('dock nope', 'Docker cheatsheet')).toBe(0);
    expect(matchScore('docker', 'Docker')).toBeGreaterThan(
      matchScore('docker', 'x', 'docker'),
    );
  });

  it('finds notes, packages, commands, requests and tools', () => {
    const r = searchAll('docker', src);
    expect(r.map((x) => `${x.kind}:${x.id}`)).toEqual([
      'tool:docker',
      'note:1',
      'note:2',
    ]);
    expect(searchAll('start:dev', src)[0]).toMatchObject({
      kind: 'command',
      id: 'g1',
      title: 'Nest dev',
    });
    expect(searchAll('login', src)[0]).toMatchObject({
      kind: 'request',
      id: 'r1',
    });
    expect(searchAll('backend', src).map((x) => x.kind)).toEqual([
      'package',
      'command',
    ]);
    expect(searchAll('#ops', src)[0]).toMatchObject({ kind: 'note', id: '1' });
  });

  it('lists the tools when nothing is typed', () => {
    expect(searchAll('', src).map((x) => x.kind)).toEqual(['tool', 'tool']);
  });
});
