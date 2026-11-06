import type { ReadyCheck, ReadyType } from '../../../main/readyCheck';
import { RunCondition, normalizeCondition } from '../../../main/stepOptions';

// Saved CLI commands, grouped into packages that run top to bottom. Stored as JSON in the
// app settings (key `cli_commands`), so they live in the app DB with everything else.
// A package can contain other packages: such an entry is a link (`packageId`) to the
// whole package - it runs that package's current steps in its place, and edits to it
// show up everywhere it's used.

export interface CliCommand {
  id: string;
  name: string;
  command: string;
  cwd: string; // '' = home folder
  wait: boolean; // false = start and go on (dev servers, watchers) - only inside a package
  ready?: ReadyCheck | null; // what the next step waits for (container ready, port...)
  timeout?: number | null; // s it may take (waited-for steps), killed after; 0 = no limit
  when?: RunCondition | null; // run it only if… (deps changed, .env missing...)
  packageId?: string; // set = this entry is another package, run in its place
}

export interface CommandGroup {
  id: string;
  name: string;
  stopOnError: boolean;
  collapsed: boolean;
  color?: PackageColor | null; // to tell packages apart at a glance
  icon?: PackageIcon | null; // database, frontend, functions...
  notify?: boolean; // desktop notification when it's done / failed / ready (default off)
  parallel?: boolean; // async: every entry starts at once (default: one after another)
  commands: CliCommand[];
}

export interface CommandsState {
  groups: CommandGroup[];
}

export const SETTINGS_KEY = 'cli_commands';

export const PACKAGE_COLORS = [
  'blue',
  'teal',
  'green',
  'amber',
  'orange',
  'red',
  'pink',
  'purple',
  'slate',
] as const;
export type PackageColor = (typeof PACKAGE_COLORS)[number];

export const PACKAGE_ICONS = [
  'folder',
  'database',
  'server',
  'web',
  'mobile',
  'api',
  'functions',
  'cloud',
  'stack',
  'services',
  'terminal',
  'code',
  'build',
  'tests',
  'debug',
  'sync',
  'deploy',
  'auth',
  'mail',
  'jobs',
] as const;
export type PackageIcon = (typeof PACKAGE_ICONS)[number];

/** Swatch values - mid tones that read on both the light and the dark theme. */
export const PACKAGE_COLOR_HEX: Record<PackageColor, string> = {
  blue: '#3b82f6',
  teal: '#14b8a6',
  green: '#22c55e',
  amber: '#f59e0b',
  orange: '#f97316',
  red: '#ef4444',
  pink: '#ec4899',
  purple: '#8b5cf6',
  slate: '#64748b',
};

let seq = 0;
export const newId = (prefix: string) => {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
};

export const emptyGroup = (name = 'New package'): CommandGroup => ({
  id: newId('g'),
  name,
  stopOnError: true,
  collapsed: false,
  color: null,
  commands: [],
});

export const emptyCommand = (): CliCommand => ({
  id: newId('c'),
  name: '',
  command: '',
  cwd: '',
  wait: true,
});

export const defaultState = (): CommandsState => ({
  groups: [{ ...emptyGroup('Commands'), id: 'g-default' }],
});

const READY_TYPES: ReadyType[] = [
  'container',
  'port',
  'url',
  'output',
  'quiet',
];

const parseReady = (raw: any): ReadyCheck | null => {
  if (!raw || !READY_TYPES.includes(raw.type)) return null;
  const timeout = Number(raw.timeout);
  return {
    type: raw.type,
    target: String(raw.target || ''),
    timeout: Number.isFinite(timeout) && timeout >= 0 ? timeout : 120,
  };
};

/** Reads the stored JSON, dropping anything malformed. */
export const parseState = (json: string | null | undefined): CommandsState => {
  try {
    const raw = JSON.parse(json || '');
    if (!raw || !Array.isArray(raw.groups)) return defaultState();
    const groups = raw.groups
      .filter((g: any) => g && typeof g.id === 'string')
      .map(
        (g: any): CommandGroup => ({
          id: g.id,
          name: String(g.name || 'Package'),
          stopOnError: g.stopOnError !== false,
          collapsed: !!g.collapsed,
          color: PACKAGE_COLORS.includes(g.color) ? g.color : null,
          icon: PACKAGE_ICONS.includes(g.icon) ? g.icon : null,
          notify: g.notify === true,
          parallel: g.parallel === true,
          commands: (Array.isArray(g.commands) ? g.commands : [])
            .filter((c: any) => c && typeof c.id === 'string')
            .map(
              (c: any): CliCommand => ({
                id: c.id,
                name: String(c.name || ''),
                command: String(c.command || ''),
                cwd: String(c.cwd || ''),
                wait: c.wait !== false,
                ready: parseReady(c.ready),
                timeout: Math.max(0, Number(c.timeout) || 0) || null,
                when: normalizeCondition(c.when),
                ...(typeof c.packageId === 'string' && {
                  packageId: c.packageId,
                }),
              }),
            ),
        }),
      );
    if (!groups.length) return defaultState();
    // drop links to packages that no longer exist
    const ids = new Set(groups.map((g: CommandGroup) => g.id));
    return {
      groups: groups.map((g: CommandGroup) => ({
        ...g,
        commands: g.commands.filter(
          (c) => !c.packageId || (ids.has(c.packageId) && c.packageId !== g.id),
        ),
      })),
    };
  } catch (e) {
    return defaultState();
  }
};

/** Display name: the given name or the first line of the command. */
export const commandLabel = (c: CliCommand) =>
  c.name.trim() || c.command.trim().split('\n')[0].slice(0, 60) || 'Untitled';

/**
 * Moves a command to `toGroupId` at `toIndex` (index in the target group *before* the
 * move). Works within one group and across groups.
 */
export const moveCommand = (
  state: CommandsState,
  commandId: string,
  toGroupId: string,
  toIndex: number,
): CommandsState => {
  const from = state.groups.find((g) =>
    g.commands.some((c) => c.id === commandId),
  );
  const target = state.groups.find((g) => g.id === toGroupId);
  if (!from || !target) return state;
  const fromIndex = from.commands.findIndex((c) => c.id === commandId);
  const command = from.commands[fromIndex];
  if (
    command.packageId &&
    from.id !== target.id &&
    !canNest(state, command.packageId, target.id)
  ) {
    return state;
  }
  let index = Math.max(0, Math.min(toIndex, target.commands.length));
  if (from.id === target.id && fromIndex < index) index -= 1;
  if (from.id === target.id && fromIndex === index) return state;
  const groups = state.groups.map((g) => ({
    ...g,
    commands: g.commands.filter((c) => c.id !== commandId),
  }));
  const dest = groups.find((g) => g.id === toGroupId)!;
  dest.commands.splice(index, 0, command);
  return { groups };
};

export const isPackageLink = (c: CliCommand) => !!c.packageId;

const findGroup = (state: CommandsState, id?: string) =>
  state.groups.find((g) => g.id === id);

/** Does package `outerId` contain `innerId` (directly or deeper)? */
export const containsPackage = (
  state: CommandsState,
  outerId: string,
  innerId: string,
  seen = new Set<string>(),
): boolean => {
  if (seen.has(outerId)) return false;
  seen.add(outerId);
  const outer = findGroup(state, outerId);
  if (!outer) return false;
  return outer.commands.some(
    (c) =>
      !!c.packageId &&
      (c.packageId === innerId ||
        containsPackage(state, c.packageId, innerId, seen)),
  );
};

/** Can package `sourceId` go into `targetId` without running itself in a loop? */
export const canNest = (
  state: CommandsState,
  sourceId: string,
  targetId: string,
) =>
  sourceId !== targetId &&
  !!findGroup(state, sourceId) &&
  !!findGroup(state, targetId) &&
  !containsPackage(state, sourceId, targetId);

/** Adds package `sourceId` as one entry of package `targetId` (at `toIndex`). */
export const addPackageLink = (
  state: CommandsState,
  sourceId: string,
  targetId: string,
  toIndex?: number,
): CommandsState => {
  const target = findGroup(state, targetId);
  if (!target || !canNest(state, sourceId, targetId)) return state;
  const link: CliCommand = {
    id: newId('c'),
    name: '',
    command: '',
    cwd: '',
    wait: true,
    packageId: sourceId,
  };
  const index = Math.max(
    0,
    Math.min(toIndex ?? target.commands.length, target.commands.length),
  );
  return updateGroup(state, targetId, {
    commands: [
      ...target.commands.slice(0, index),
      link,
      ...target.commands.slice(index),
    ],
  });
};

/** Where a step sits: per package level, its entry and whether that package is async. */
export interface NestLevel {
  parallel: boolean;
  index: number;
}

export interface ExpandedStep extends CliCommand {
  section: string | null; // "Backend › Database" - the nested packages it comes from
  nest: NestLevel[]; // from the package that was run down to this step
}

/**
 * The real steps of a list of entries: linked packages replaced by their steps. `nest`
 * keeps the shape, so an async package runs its entries at once while a linked sync
 * package inside it still runs its own steps in order.
 */
export const expandSteps = (
  state: CommandsState,
  commands: CliCommand[],
  section: string | null = null,
  seen: Set<string> = new Set(),
  parallel = false,
  nest: NestLevel[] = [],
): ExpandedStep[] =>
  commands.flatMap((c, index): ExpandedStep[] => {
    const here = [...nest, { parallel, index }];
    if (!c.packageId) return [{ ...c, section, nest: here }];
    const inner = findGroup(state, c.packageId);
    if (!inner || seen.has(inner.id)) return [];
    return expandSteps(
      state,
      inner.commands,
      section ? `${section} › ${inner.name}` : inner.name,
      new Set([...seen, inner.id]),
      inner.parallel === true,
      here,
    );
  });

/** The steps a package runs (linked packages included). */
export const packageSteps = (state: CommandsState, group: CommandGroup) =>
  expandSteps(
    state,
    group.commands,
    null,
    new Set([group.id]),
    group.parallel === true,
  );

/** Packages that contain package `id`. */
export const packageUsers = (state: CommandsState, id: string) =>
  state.groups.filter((g) => g.commands.some((c) => c.packageId === id));

/** Copy of a package (new ids) added right after it. */
export const duplicateGroup = (
  state: CommandsState,
  groupId: string,
): CommandsState => {
  const index = state.groups.findIndex((g) => g.id === groupId);
  if (index < 0) return state;
  const source = state.groups[index];
  const copy: CommandGroup = {
    ...source,
    id: newId('g'),
    name: `${source.name} copy`,
    commands: source.commands.map((c) => ({ ...c, id: newId('c') })),
  };
  const groups = [...state.groups];
  groups.splice(index + 1, 0, copy);
  return { groups };
};

/** Moves a whole group to `toIndex` (index before the move). */
export const moveGroup = (
  state: CommandsState,
  groupId: string,
  toIndex: number,
): CommandsState => {
  const fromIndex = state.groups.findIndex((g) => g.id === groupId);
  if (fromIndex < 0) return state;
  let index = Math.max(0, Math.min(toIndex, state.groups.length));
  if (fromIndex < index) index -= 1;
  if (index === fromIndex) return state;
  const groups = [...state.groups];
  const [group] = groups.splice(fromIndex, 1);
  groups.splice(index, 0, group);
  return { groups };
};

export const updateGroup = (
  state: CommandsState,
  groupId: string,
  patch: Partial<CommandGroup>,
): CommandsState => ({
  groups: state.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)),
});

/** Adds or replaces a command (by id) in a group; moves it there if it lived elsewhere. */
export const saveCommand = (
  state: CommandsState,
  groupId: string,
  command: CliCommand,
): CommandsState => {
  const existing = state.groups.find((g) =>
    g.commands.some((c) => c.id === command.id),
  );
  if (existing && existing.id === groupId) {
    return updateGroup(state, groupId, {
      commands: existing.commands.map((c) =>
        c.id === command.id ? command : c,
      ),
    });
  }
  const groups = state.groups.map((g) => ({
    ...g,
    commands: g.commands.filter((c) => c.id !== command.id),
  }));
  return {
    groups: groups.map((g) =>
      g.id === groupId ? { ...g, commands: [...g.commands, command] } : g,
    ),
  };
};

export const removeCommand = (
  state: CommandsState,
  commandId: string,
): CommandsState => ({
  groups: state.groups.map((g) => ({
    ...g,
    commands: g.commands.filter((c) => c.id !== commandId),
  })),
});

export const removeGroup = (
  state: CommandsState,
  groupId: string,
): CommandsState => {
  // also take it out of the packages that contain it
  const groups = state.groups
    .filter((g) => g.id !== groupId)
    .map((g) => ({
      ...g,
      commands: g.commands.filter((c) => c.packageId !== groupId),
    }));
  return groups.length ? { groups } : defaultState();
};

/** Commands matching a search (name, command, folder); groups with no match are dropped. */
export const searchCommands = (
  state: CommandsState,
  query: string,
): CommandGroup[] => {
  const q = query.trim().toLowerCase();
  if (!q) return state.groups;
  return state.groups
    .map((g) =>
      g.name.toLowerCase().includes(q)
        ? g
        : {
            ...g,
            commands: g.commands.filter((c) =>
              (c.packageId
                ? findGroup(state, c.packageId)?.name || ''
                : [c.name, c.command, c.cwd].join(' ')
              )
                .toLowerCase()
                .includes(q),
            ),
          },
    )
    .filter((g) => g.commands.length || g.name.toLowerCase().includes(q));
};

export interface CommandPreset {
  label: string;
  hint: string;
  command: Partial<CliCommand>;
}

/** Common steps to start from - the folder stays whatever you picked. */
export const COMMAND_PRESETS: CommandPreset[] = [
  {
    label: 'Git pull',
    hint: 'Fast-forward only: stops instead of making a merge when the branch diverged.',
    command: { name: 'Git pull', command: 'git pull --ff-only' },
  },
  {
    label: 'npm install (when needed)',
    hint: 'Only when package.json / package-lock.json changed since it last ran, or node_modules is missing.',
    command: {
      name: 'npm install',
      command: 'npm install',
      when: {
        type: 'changed',
        target: 'package.json, package-lock.json, node_modules',
      },
    },
  },
  {
    label: 'pnpm install (when needed)',
    hint: 'Only when package.json / pnpm-lock.yaml changed, or node_modules is missing.',
    command: {
      name: 'pnpm install',
      command: 'pnpm install',
      when: {
        type: 'changed',
        target: 'package.json, pnpm-lock.yaml, node_modules',
      },
    },
  },
  {
    label: 'yarn install (when needed)',
    hint: 'Only when package.json / yarn.lock changed, or node_modules is missing.',
    command: {
      name: 'yarn install',
      command: 'yarn install',
      when: {
        type: 'changed',
        target: 'package.json, yarn.lock, node_modules',
      },
    },
  },
  {
    label: 'Maven install (when pom changed)',
    hint: 'Builds without tests, only when pom.xml changed since it last ran.',
    command: {
      name: 'Maven install',
      command: 'mvn -q -DskipTests install',
      when: { type: 'changed', target: 'pom.xml' },
    },
  },
  {
    label: '.env from example',
    hint: 'Copies .env.example to .env - only when .env is missing.',
    command: {
      name: 'Create .env',
      command: 'cp .env.example .env',
      when: { type: 'missing', target: '.env' },
    },
  },
  {
    label: 'docker compose up',
    hint: 'Starts the stack in the background and goes on.',
    command: { name: 'Compose up', command: 'docker compose up -d' },
  },
  {
    label: 'Flyway migrate',
    hint: 'Runs the pending migrations.',
    command: { name: 'Flyway migrate', command: 'flyway migrate' },
  },
  {
    label: 'Nest dev server',
    hint: 'Keeps running; the package goes on once Nest says it started.',
    command: {
      name: 'Nest dev',
      command: 'npm run start:dev',
      wait: false,
      ready: {
        type: 'output',
        target: 'Nest application successfully started',
        timeout: 180,
      },
    },
  },
  {
    label: 'Angular dev server',
    hint: 'ng serve keeps running; the package goes on once the first build is served.',
    command: {
      name: 'Angular dev',
      command: 'npm start',
      wait: false,
      ready: {
        type: 'output',
        target:
          '/Local:\\s+https?:\\/\\/|Compiled successfully|bundle generation complete/i',
        timeout: 300,
      },
    },
  },
  {
    label: 'Azure Functions (func start)',
    hint: 'Functions host keeps running; the package goes on once the worker is up and the functions are listed.',
    command: {
      name: 'Function app',
      command: 'func start',
      wait: false,
      ready: {
        type: 'output',
        target:
          '/Worker process started and initialized|Host lock lease acquired|Job host started/i',
        timeout: 240,
      },
    },
  },
  {
    label: 'Vite dev server',
    hint: 'Keeps running; the package goes on once Vite is ready.',
    command: {
      name: 'Vite dev',
      command: 'npm run dev',
      wait: false,
      ready: { type: 'output', target: '/ready in \\d+/i', timeout: 120 },
    },
  },
];

// ---------------- export / import ----------------
// A file with packages (and the packages they run, so links keep working):
// { "stackrun": "commands", "version": 1, "groups": [...] }
export const EXPORT_KIND = 'commands';

/** Packages to save: the chosen ones (default: all) plus every package they run. */
export const exportPackages = (
  state: CommandsState,
  groupIds?: string[],
): string => {
  const wanted = new Set(
    groupIds?.length ? groupIds : state.groups.map((g) => g.id),
  );
  // follow links so an exported "Stack" still has its "Backend" and "Frontend"
  const queue = [...wanted];
  while (queue.length) {
    const id = queue.shift();
    const g = state.groups.find((x) => x.id === id);
    g?.commands.forEach((c) => {
      if (c.packageId && !wanted.has(c.packageId)) {
        wanted.add(c.packageId);
        queue.push(c.packageId);
      }
    });
  }
  const groups = state.groups
    .filter((g) => wanted.has(g.id))
    .map((g) => ({ ...g, collapsed: false }));
  return `${JSON.stringify(
    { stackrun: EXPORT_KIND, version: 1, groups },
    null,
    2,
  )}\n`;
};

/**
 * Adds the packages of an exported file. Everything gets new ids (links inside the file
 * follow), so importing twice or into another machine never clashes.
 */
export const importPackages = (
  state: CommandsState,
  text: string,
): { state: CommandsState; added: string[] } => {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error('Not a JSON file');
  }
  const list = Array.isArray(raw) ? raw : raw?.groups;
  if (!Array.isArray(list) || (raw?.stackrun && raw.stackrun !== EXPORT_KIND))
    throw new Error('No command packages in it');
  const parsed = parseState(JSON.stringify({ groups: list }));
  // parseState falls back to a default package for an empty / broken list
  if (
    !list.length ||
    (parsed.groups.length === 1 && parsed.groups[0].id === 'g-default')
  )
    throw new Error('No command packages in it');
  const ids = new Map(parsed.groups.map((g) => [g.id, newId('g')]));
  const taken = new Set(state.groups.map((g) => g.name));
  const added = parsed.groups.map((g) => ({
    ...g,
    id: ids.get(g.id)!,
    name: taken.has(g.name) ? `${g.name} (imported)` : g.name,
    commands: g.commands.map((c) => ({
      ...c,
      id: newId('c'),
      ...(c.packageId && { packageId: ids.get(c.packageId) || c.packageId }),
    })),
  }));
  // a fresh, still empty default package makes way for what is imported
  const keep = state.groups.filter(
    (g) => !(g.id === 'g-default' && g.commands.length === 0),
  );
  return {
    state: { groups: [...keep, ...added] },
    added: added.map((g) => g.name),
  };
};
