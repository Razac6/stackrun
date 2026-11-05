import {
  CommandsState,
  COMMAND_PRESETS,
  addPackageLink,
  canNest,
  packageSteps,
  packageUsers,
  duplicateGroup,
  commandLabel,
  moveCommand,
  moveGroup,
  parseState,
  removeGroup,
  saveCommand,
  searchCommands,
} from './commandsModel';

const cmd = (id: string, command = `echo ${id}`) => ({
  id,
  name: id,
  command,
  cwd: '',
  wait: true,
});

const state = (): CommandsState => ({
  groups: [
    {
      id: 'g1',
      name: 'DB',
      stopOnError: true,
      collapsed: false,
      commands: [cmd('a'), cmd('b'), cmd('c')],
    },
    {
      id: 'g2',
      name: 'App',
      stopOnError: false,
      collapsed: false,
      commands: [cmd('d')],
    },
  ],
});

const ids = (s: CommandsState) =>
  s.groups.map((g) => g.commands.map((c) => c.id).join(''));

describe('commandsModel', () => {
  it('reorders inside a group (drop index = position before the move)', () => {
    expect(ids(moveCommand(state(), 'a', 'g1', 3))).toEqual(['bca', 'd']);
    expect(ids(moveCommand(state(), 'c', 'g1', 0))).toEqual(['cab', 'd']);
    expect(ids(moveCommand(state(), 'a', 'g1', 2))).toEqual(['bac', 'd']);
    const same = state();
    expect(moveCommand(same, 'b', 'g1', 1)).toBe(same);
    expect(moveCommand(same, 'b', 'g1', 2)).toBe(same);
  });

  it('moves between groups', () => {
    expect(ids(moveCommand(state(), 'b', 'g2', 0))).toEqual(['ac', 'bd']);
    expect(ids(moveCommand(state(), 'd', 'g1', 1))).toEqual(['adbc', '']);
  });

  it('reorders groups', () => {
    expect(moveGroup(state(), 'g1', 2).groups.map((g) => g.id)).toEqual([
      'g2',
      'g1',
    ]);
    expect(moveGroup(state(), 'g2', 0).groups.map((g) => g.id)).toEqual([
      'g2',
      'g1',
    ]);
  });

  it('saves (adds / edits / moves) commands', () => {
    expect(ids(saveCommand(state(), 'g2', cmd('e')))).toEqual(['abc', 'de']);
    const edited = saveCommand(state(), 'g1', { ...cmd('b'), command: 'ls' });
    expect(edited.groups[0].commands[1].command).toBe('ls');
    expect(ids(saveCommand(state(), 'g2', cmd('a')))).toEqual(['bc', 'da']);
  });

  it('parses stored JSON defensively', () => {
    expect(parseState('nope').groups).toHaveLength(1);
    const parsed = parseState(
      JSON.stringify({
        groups: [
          {
            id: 'x',
            name: 'X',
            commands: [{ id: 'c', command: 'ls', wait: false }, null],
          },
        ],
      }),
    );
    expect(parsed.groups[0]).toMatchObject({
      stopOnError: true,
      commands: [{ id: 'c', wait: false, cwd: '' }],
    });
    expect(removeGroup(parsed, 'x').groups).toHaveLength(1); // never empty
  });

  it('searches and labels', () => {
    expect(searchCommands(state(), 'echo d').map((g) => g.id)).toEqual(['g2']);
    expect(searchCommands(state(), 'db')[0].commands).toHaveLength(3); // group name match
    expect(commandLabel({ ...cmd('x', 'npm run dev\nmore'), name: ' ' })).toBe(
      'npm run dev',
    );
  });

  it('puts a whole package into another one as a link, not a copy', () => {
    const next = addPackageLink(state(), 'g1', 'g2', 0);
    const link = next.groups[1].commands[0];
    expect(link.packageId).toBe('g1');
    expect(next.groups[1].commands).toHaveLength(2); // one entry, not 3 copies
    expect(
      packageSteps(next, next.groups[1]).map((c) => [c.id, c.section]),
    ).toEqual([
      ['a', 'DB'],
      ['b', 'DB'],
      ['c', 'DB'],
      ['d', null],
    ]);
    // edits to the inner package show up where it's used
    const edited = saveCommand(next, 'g1', cmd('e'));
    expect(packageSteps(edited, edited.groups[1]).map((c) => c.id)).toEqual([
      'a',
      'b',
      'c',
      'e',
      'd',
    ]);
    expect(packageUsers(next, 'g1').map((g) => g.id)).toEqual(['g2']);
  });

  it('refuses loops and cleans links up', () => {
    const one = addPackageLink(state(), 'g1', 'g2');
    expect(canNest(one, 'g2', 'g1')).toBe(false); // g2 already contains g1
    expect(addPackageLink(one, 'g2', 'g1')).toBe(one);
    expect(canNest(one, 'g1', 'g1')).toBe(false);
    // deeper: g3 > g2 > g1 - g1 can't take g3
    const three: CommandsState = {
      groups: [
        ...one.groups,
        {
          id: 'g3',
          name: 'All',
          stopOnError: true,
          collapsed: false,
          commands: [],
        },
      ],
    };
    const nested = addPackageLink(three, 'g2', 'g3');
    expect(canNest(nested, 'g3', 'g1')).toBe(false);
    expect(
      packageSteps(nested, nested.groups[2]).map((c) => c.section),
    ).toEqual(['App', 'App › DB', 'App › DB', 'App › DB']);
    // deleting a package removes its links; stored links to nowhere are dropped
    expect(
      removeGroup(nested, 'g1').groups[0].commands.map((c) => c.id),
    ).toEqual(['d']);
    const parsed = parseState(
      JSON.stringify({
        groups: [
          {
            id: 'x',
            name: 'X',
            commands: [
              { id: 'l', packageId: 'gone' },
              { id: 'm', packageId: 'x' },
            ],
          },
        ],
      }),
    );
    expect(parsed.groups[0].commands).toEqual([]);
  });

  it('searches links by the package name', () => {
    const next = addPackageLink(state(), 'g1', 'g2');
    expect(
      searchCommands(next, 'db')
        .find((g) => g.id === 'g2')
        ?.commands.map((c) => c.packageId),
    ).toEqual(['g1']);
  });

  it('has presets with valid conditions', () => {
    const npm = COMMAND_PRESETS.find(
      (p) => p.command.command === 'npm install',
    );
    expect(npm?.command.when).toEqual({
      type: 'changed',
      target: 'package.json, package-lock.json, node_modules',
    });
    const parsed = parseState(
      JSON.stringify({
        groups: [
          {
            id: 'x',
            name: 'X',
            commands: [
              { id: 'c', command: 'npm i', ...npm?.command, timeout: '90' },
            ],
          },
        ],
      }),
    );
    expect(parsed.groups[0].commands[0]).toMatchObject({
      when: npm?.command.when,
      timeout: 90,
    });
  });

  it('duplicates a package right after itself', () => {
    const next = duplicateGroup(state(), 'g1');
    expect(next.groups.map((g) => g.name)).toEqual(['DB', 'DB copy', 'App']);
    expect(next.groups[1].commands[0].id).not.toBe('a');
  });

  it('keeps a valid package color and drops unknown ones', () => {
    const parsed = parseState(
      JSON.stringify({
        groups: [
          { id: 'a', name: 'A', color: 'teal', commands: [] },
          { id: 'b', name: 'B', color: 'chartreuse', commands: [] },
        ],
      }),
    );
    expect(parsed.groups.map((g) => g.color)).toEqual(['teal', null]);
    const withIcons = parseState(
      JSON.stringify({
        groups: [
          { id: 'a', name: 'A', icon: 'database', commands: [] },
          { id: 'b', name: 'B', icon: 'unicorn', commands: [] },
        ],
      }),
    );
    expect(withIcons.groups.map((g) => g.icon)).toEqual(['database', null]);
    expect(duplicateGroup(withIcons, 'a').groups[1].icon).toBe('database');
    expect(duplicateGroup(parsed, 'a').groups[1].color).toBe('teal');
  });
});
