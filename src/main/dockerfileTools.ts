// "From Dockerfile" (pure): a saved recipe → `docker build` + `docker run` arguments, and
// the ports a Dockerfile EXPOSEs as a starting point.

export interface PortMap {
  host: string; // "8080" or "127.0.0.1:8080"
  container: string; // "80" or "80/udp"
}

export interface DockerfileRecipe {
  id: string;
  name: string; // shown in the list
  dockerfile: string; // absolute path to the Dockerfile
  context: string; // build context folder ('' = the Dockerfile's folder)
  image: string; // tag, e.g. "orders-api:dev"
  container: string; // --name
  ports: PortMap[];
  env: { key: string; value: string }[];
  volumes: { host: string; container: string }[];
  buildArgs: { key: string; value: string }[];
  target: string; // multi-stage --target ('' = last stage)
  network: string; // --network ('' = default)
  extraRun: string; // more `docker run` flags, as typed
  noCache: boolean;
}

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
export const isSafeName = (s: string) => NAME_RE.test(s);

/** Docker image tags are lowercase: "Orders API" → "orders-api". */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60) || 'app';

/** Ports from `EXPOSE 80 443/tcp 5432` lines (ARG / ENV substitutions are skipped). */
export const exposedPorts = (dockerfile: string): string[] => {
  const out: string[] = [];
  dockerfile.split(/\r?\n/).forEach((line) => {
    const m = /^\s*EXPOSE\s+(.+)$/i.exec(line);
    if (!m) return;
    m[1]
      .split(/\s+/)
      .filter((p) => /^\d+(\/(tcp|udp))?$/i.test(p))
      .forEach((p) => {
        if (!out.includes(p)) out.push(p);
      });
  });
  return out;
};

/** A first recipe for a Dockerfile: names from its folder, ports from EXPOSE. */
export const recipeFor = (
  id: string,
  dockerfilePath: string,
  dockerfileText: string,
): DockerfileRecipe => {
  const parts = dockerfilePath.split(/[\\/]/).filter(Boolean);
  const folder = parts.length > 1 ? parts[parts.length - 2] : 'app';
  const name = slug(folder);
  return {
    id,
    name: folder,
    dockerfile: dockerfilePath,
    context: '',
    image: `${name}:dev`,
    container: name,
    ports: exposedPorts(dockerfileText).map((p) => ({
      host: p.replace(/\/(tcp|udp)$/i, ''),
      container: p,
    })),
    env: [],
    volumes: [],
    buildArgs: [],
    target: '',
    network: '',
    extraRun: '',
    noCache: false,
  };
};

const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '') || '.';

/** Splits typed flags like a shell would (quotes, no expansion). */
export const splitArgs = (text: string): string[] => {
  const out: string[] = [];
  const re = /"((?:\\.|[^"])*)"|'([^']*)'|(\S+)/g;
  let m = re.exec(text);
  while (m) {
    out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] ?? m[3]);
    m = re.exec(text);
  }
  return out;
};

export const buildArgs = (r: DockerfileRecipe): string[] => [
  'build',
  '-t',
  r.image,
  '-f',
  r.dockerfile,
  ...(r.target ? ['--target', r.target] : []),
  ...(r.noCache ? ['--no-cache'] : []),
  ...r.buildArgs
    .filter((a) => a.key.trim())
    .flatMap((a) => ['--build-arg', `${a.key.trim()}=${a.value}`]),
  r.context.trim() || dirOf(r.dockerfile),
];

export const runArgs = (r: DockerfileRecipe): string[] => [
  'run',
  '-d',
  '--name',
  r.container,
  ...(r.network ? ['--network', r.network] : []),
  ...r.ports
    .filter((p) => p.host.trim() && p.container.trim())
    .flatMap((p) => ['-p', `${p.host.trim()}:${p.container.trim()}`]),
  ...r.env
    .filter((e) => e.key.trim())
    .flatMap((e) => ['-e', `${e.key.trim()}=${e.value}`]),
  ...r.volumes
    .filter((v) => v.host.trim() && v.container.trim())
    .flatMap((v) => ['-v', `${v.host.trim()}:${v.container.trim()}`]),
  ...splitArgs(r.extraRun),
  r.image,
];

/** What is wrong with a recipe before anything runs; null when it can go. */
export const recipeProblem = (r: DockerfileRecipe): string | null => {
  if (!r.dockerfile.trim()) return 'Pick a Dockerfile';
  if (!/^[a-z0-9][a-z0-9_./:-]*$/.test(r.image))
    return 'Image: lowercase letters, digits, - _ . / : (e.g. orders-api:dev)';
  if (!isSafeName(r.container))
    return 'Container name: letters, digits, - _ . (no spaces)';
  if (r.network && !isSafeName(r.network))
    return 'Network: letters, digits, - _ .';
  const bad = r.ports.find(
    (p) =>
      (p.host || p.container) &&
      !(
        /^((\d{1,3}\.){3}\d{1,3}:)?\d{1,5}$/.test(p.host.trim()) &&
        /^\d{1,5}(\/(tcp|udp))?$/i.test(p.container.trim())
      ),
  );
  if (bad)
    return `Port "${bad.host}:${bad.container}": host 8080, container 80 or 80/udp`;
  return null;
};
