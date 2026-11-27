// One command to bring the demo up for testing on a phone:
//
//   KAABIL_EDGE_URL=https://kaabil.<account>.workers.dev npm run up --workspace @kaabil/edge
//
// It (1) starts the backend with `docker compose`, telling it the public address people will open,
// (2) starts a Cloudflare quick tunnel to this machine, (3) tells the Worker where the tunnel is
// (the KV key `origin`), (4) checks the whole path from the public address, and (5) keeps running,
// because the tunnel dies when this does. Press Ctrl-C to stop the tunnel.
//
// Needs: Docker running; `cloudflared` (KAABIL_CLOUDFLARED=<path to the exe>, or on the PATH);
// `npx wrangler login` done once; the Worker deployed (`npx wrangler deploy` in packages/edge).
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const edge = process.env.KAABIL_EDGE_URL?.replace(/\/$/, '');
if (!edge || !/^https:\/\/[a-z0-9.-]+$/.test(edge)) {
  console.log('Set KAABIL_EDGE_URL to the address of the deployed Worker, for example https://kaabil.<account>.workers.dev');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const edgeDir = join(here, '..');
const root = join(edgeDir, '..', '..');
const cloudflared = process.env.KAABIL_CLOUDFLARED ?? 'cloudflared';
const win = process.platform === 'win32';

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: 'inherit', shell: win, ...opts });
}

console.log('1. Starting the backend (docker compose)...');
if (run('docker', ['compose', 'up', '-d', '--build'], { cwd: root, env: { ...process.env, KAABIL_BASE_URL: edge } }).status !== 0) {
  console.log('The backend did not start.');
  process.exit(1);
}

console.log('2. Starting the Cloudflare quick tunnel...');
const tunnel = spawn(cloudflared, ['tunnel', '--url', 'http://localhost:8080', '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
tunnel.on('error', (e) => {
  console.log(`Could not start cloudflared (${cloudflared}): ${e.message}\nSet KAABIL_CLOUDFLARED to the path of cloudflared.exe.`);
  process.exit(2);
});
const origin = await new Promise((resolve) => {
  let buf = '';
  const onData = (d) => {
    buf += d.toString();
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buf);
    if (m) resolve(m[0]);
  };
  tunnel.stdout.on('data', onData);
  tunnel.stderr.on('data', onData);
  setTimeout(() => resolve(null), 60_000);
});
if (!origin) {
  console.log('The tunnel did not give an address within a minute.');
  tunnel.kill();
  process.exit(1);
}
console.log(`   tunnel: ${origin}`);

console.log('3. Telling the Worker where the backend is...');
if (run('npx', ['--yes', 'wrangler@4', 'kv', 'key', 'put', 'origin', origin, '--binding', 'CONFIG', '--remote'], { cwd: edgeDir }).status !== 0) {
  console.log('Could not set the backend address. Run `npx wrangler login` once, and deploy the Worker.');
  tunnel.kill();
  process.exit(1);
}

console.log('4. Checking the whole path from the public address...');
let ok = false;
for (let i = 0; i < 20 && !ok; i++) {
  ok = await fetch(`${edge}/api/health`).then((r) => r.ok).catch(() => false);
  if (!ok) await new Promise((r) => setTimeout(r, 3000));
}
if (!ok) {
  console.log(`The Worker could not reach the backend through the tunnel. Check ${edge}/api/health`);
  tunnel.kill();
  process.exit(1);
}
console.log(`\nReady. Open on the phone:\n\n  ${edge}/test/\n\nKeep this window and this computer awake. Ctrl-C stops the tunnel.`);
const stop = () => {
  tunnel.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
tunnel.on('exit', () => {
  console.log('The tunnel stopped. Run this again for a new address.');
  process.exit(1);
});
