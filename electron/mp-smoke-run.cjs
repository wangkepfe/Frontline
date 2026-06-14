// Orchestrates the live two-process multiplayer smoke test: spawn a HOST Electron
// instance, give it a moment to start listening, spawn a JOIN instance pointed at
// 127.0.0.1, collect each one's MP_REPORT, and decide PASS/FAIL. PASS means both
// reached a live netted game whose ticks advanced together with no desync — i.e.
// the full DOM→preload→IPC→TCP→peer lockstep path works end to end.
const { spawn } = require('node:child_process');
const electron = require('electron'); // path to the electron executable
const path = require('node:path');

function runRole(role, delayMs) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const child = spawn(electron, [path.join(__dirname, 'mp-smoke.cjs')], {
        env: { ...process.env, MP_ROLE: role, MP_SMOKE_PORT: '47615' },
        cwd: path.join(__dirname, '..')
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d.toString()));
      child.stderr.on('data', () => {});
      const kill = setTimeout(() => child.kill(), 25000);
      child.on('exit', () => {
        clearTimeout(kill);
        const line = out.split('\n').find((l) => l.startsWith('MP_REPORT '));
        resolve(line ? JSON.parse(line.slice('MP_REPORT '.length)) : { role, error: 'no report' });
      });
    }, delayMs);
  });
}

(async () => {
  const [host, join] = await Promise.all([runRole('host', 0), runRole('join', 3000)]);
  console.log('HOST', JSON.stringify(host));
  console.log('JOIN', JSON.stringify(join));

  const ok =
    host.started && join.started &&
    host.last && join.last &&
    host.last.localTeam === 0 && join.last.localTeam === 1 &&
    host.last.tick > 40 && join.last.tick > 40 &&
    !host.last.netwait.includes('DESYNC') && !join.last.netwait.includes('DESYNC') &&
    !host.last.modal.includes('DESYNC') && !join.last.modal.includes('DESYNC') &&
    // both commanders see the same HQ healths (state agrees across the wire)
    host.last.hq0 === join.last.hq0 && host.last.hq1 === join.last.hq1;

  console.log(ok ? 'SMOKE_PASS' : 'SMOKE_FAIL');
  process.exit(ok ? 0 : 1);
})();
