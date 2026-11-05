import {
  parseLsof,
  parseNetstat,
  parseTasklist,
  portFromError,
} from './portTools';

describe('port in use', () => {
  it('finds the port in the usual error messages', () => {
    expect(
      portFromError('Error: listen EADDRINUSE: address already in use :::3000'),
    ).toBe(3000);
    expect(portFromError('Port 4200 is already in use.')).toBe(4200);
    expect(
      portFromError('Bind for 0.0.0.0:5432 failed: port is already allocated'),
    ).toBe(5432);
    expect(
      portFromError(
        'Web server failed to start. Port 8080 was already in use.',
      ),
    ).toBe(8080);
    expect(portFromError('Port 7071 is unavailable. Close the process')).toBe(
      7071,
    );
    expect(portFromError('all good')).toBeNull();
  });

  it('reads netstat + tasklist (Windows)', () => {
    const netstat = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1100
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4242
  TCP    [::]:3000              [::]:0                 LISTENING       4242
  TCP    127.0.0.1:3000         127.0.0.1:51000        ESTABLISHED     4242
  TCP    127.0.0.1:30001        0.0.0.0:0              LISTENING       77
`;
    expect(parseNetstat(netstat, 3000)).toEqual([
      { pid: 4242, address: '0.0.0.0:3000' },
    ]);
    expect(
      parseTasklist('"node.exe","4242","Console","1","80,000 K"\n').get(4242),
    ).toBe('node.exe');
  });

  it('reads lsof (macOS / Linux)', () => {
    expect(
      parseLsof('p812\ncnode\nf23\nn*:3000\np900\ncjava\nn127.0.0.1:3000\n'),
    ).toEqual([
      { pid: 812, name: 'node', command: '', address: '*:3000' },
      { pid: 900, name: 'java', command: '', address: '127.0.0.1:3000' },
    ]);
  });
});
