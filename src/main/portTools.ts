// "Port in use": which process listens on a port (pure parsing of netstat / tasklist /
// lsof output, and finding the port in an error message).

export interface PortOwner {
  pid: number;
  name: string; // process name ("node", "java.exe")
  command: string; // full command line when known
  address: string; // 127.0.0.1:3000, [::]:3000
}

/** The port an EADDRINUSE / "port is already in use" message is about. */
export const portFromError = (text: string): number | null => {
  const patterns = [
    /EADDRINUSE[^\n]*?:(\d{2,5})\b/i,
    /address already in use[^\n]*?:(\d{2,5})\b/i,
    /bind(?:ing)?[^\n]*?(?:port|:)\s*(\d{2,5})[^\n]*already in use/i,
    /port\s+(\d{2,5})\s+is\s+(?:already\s+)?in use/i,
    /port\s+(\d{2,5})\s+(?:is\s+)?(?:already\s+)?(?:taken|occupied|busy)/i,
    /listen\s+EACCES[^\n]*?:(\d{2,5})\b/i,
    /Ports? are not available:[^\n]*?:(\d{2,5})\b/i, // docker
    /Bind for [\d.:\][]*:(\d{2,5}) failed: port is already allocated/i, // docker
    /Web server failed to start\. Port (\d{2,5}) was already in use/i, // spring
    /Port (\d{2,5}) is unavailable/i, // Azure Functions (func start)
  ];
  // eslint-disable-next-line no-restricted-syntax
  for (const re of patterns) {
    const m = re.exec(text);
    const port = m ? Number(m[1]) : 0;
    if (port > 0 && port < 65536) return port;
  }
  return null;
};

/** `netstat -ano -p tcp` (Windows): PIDs listening on the port. */
export const parseNetstat = (
  output: string,
  port: number,
): { pid: number; address: string }[] => {
  const out: { pid: number; address: string }[] = [];
  output.split(/\r?\n/).forEach((line) => {
    const cols = line.trim().split(/\s+/);
    // Proto  Local Address  Foreign Address  State  PID
    if (cols.length < 5 || !/^TCP/i.test(cols[0])) return;
    if (!/LISTEN/i.test(cols[3])) return;
    const local = cols[1];
    if (Number(local.slice(local.lastIndexOf(':') + 1)) !== port) return;
    const pid = Number(cols[4]);
    if (pid > 0 && !out.some((o) => o.pid === pid))
      out.push({ pid, address: local });
  });
  return out;
};

/** `tasklist /FO CSV /NH` → name by PID. */
export const parseTasklist = (output: string): Map<number, string> => {
  const map = new Map<number, string>();
  output.split(/\r?\n/).forEach((line) => {
    const m = /^"([^"]*)","(\d+)"/.exec(line.trim());
    if (m) map.set(Number(m[2]), m[1]);
  });
  return map;
};

/** `lsof -nP -iTCP:<port> -sTCP:LISTEN -F pcn` (macOS / Linux). */
export const parseLsof = (output: string): PortOwner[] => {
  const out: PortOwner[] = [];
  let cur: PortOwner | null = null;
  output.split(/\r?\n/).forEach((line) => {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === 'p') {
      cur = { pid: Number(value), name: '', command: '', address: '' };
      out.push(cur);
    } else if (cur && tag === 'c') cur.name = value;
    else if (cur && tag === 'n' && !cur.address) cur.address = value;
  });
  return out.filter((o) => o.pid > 0);
};
