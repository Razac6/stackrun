// Docker → "Compose up" (pure): a compose file → `docker compose` arguments. It runs in
// the file's folder, so its .env and relative paths work like in a terminal there.

export interface ComposeRun {
  id: string; // for the log
  file: string; // absolute path to docker-compose.yml / compose.yaml
  build: boolean; // --build: build the images again first
}

export const COMPOSE_FILE_RE = /(^|[\\/])(docker-)?compose(\.[\w-]+)?\.ya?ml$/i;

const base = (r: ComposeRun) => ['compose', '-f', r.file];

/** `docker compose -f … up -d`: started in the background (logs stay in Docker). */
export const composeUpArgs = (r: ComposeRun) => [
  ...base(r),
  'up',
  '-d',
  ...(r.build ? ['--build'] : []),
];

export const composeDownArgs = (r: ComposeRun) => [...base(r), 'down'];

/** The same for the old `docker-compose` binary (no `compose` subcommand). */
export const legacyArgs = (args: string[]) =>
  args[0] === 'compose' ? args.slice(1) : args;

/** Docker without the compose plugin answers like this. */
export const noComposePlugin = (stderr: string) =>
  /'compose' is not a docker command|unknown (shorthand )?flag: '?-f'?/i.test(
    stderr,
  );
