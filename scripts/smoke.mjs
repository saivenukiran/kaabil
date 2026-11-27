// Smoke test: does the built app really start and serve what we claim?
//
//   npm run smoke                      builds and starts the Docker image, checks it, stops it
//   npm run smoke -- http://host:port  checks a server that is already running
//   add --no-headers                   skip the security-header checks (for a plain dev server;
//                                      the headers come from nginx.conf inside the image)
//   add --no-api                       skip the API checks (for a static server with no backend)
//
// Exit codes: 0 all checks passed, 1 a check failed, 2 could not run (no Docker, no server).
import { spawnSync } from 'node:child_process';
import { apiChecks, closedPorts } from './smoke-api.mjs';

const args = process.argv.slice(2);
const skipHeaders = args.includes('--no-headers');
const skipApi = args.includes('--no-api');
const given = args.find((a) => /^https?:\/\//.test(a));
const DEFAULT_URL = 'http://localhost:8080';

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

function run(cmd, cmdArgs) {
  return spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
}
function hasDocker() {
  return spawnSync('docker', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;
}

async function waitFor(url, seconds) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status > 0) return true;
    } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 1000));
  }
  return false;
}

const SECRET_RE = /ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY/;

async function checks(base) {
  const home = await fetch(base + '/');
  const html = await home.text();
  check('GET / returns 200', home.status === 200, `status ${home.status}`);
  check('GET / is HTML', (home.headers.get('content-type') ?? '').includes('text/html'), home.headers.get('content-type') ?? 'no content-type');
  check('the page has the app root', html.includes('id="root"'));

  const deep = await fetch(base + '/some/deep/link');
  check('an unknown path falls back to the app (200)', deep.status === 200, `status ${deep.status}`);

  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith(base));
  check('the page loads nothing from another origin', external.length === 0, external.join(', '));

  const asset = /(?:src|href)="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  check('the page references a script bundle', Boolean(asset));
  if (asset) {
    const js = await fetch(base + asset);
    const text = await js.text();
    check('the bundle is served (200)', js.status === 200, `status ${js.status}`);
    check('the bundle holds no key-like string', !SECRET_RE.test(text));
  }

  if (!skipHeaders) {
    const h = home.headers;
    check('header X-Content-Type-Options: nosniff', h.get('x-content-type-options') === 'nosniff', h.get('x-content-type-options') ?? 'missing');
    check('header Referrer-Policy: no-referrer', h.get('referrer-policy') === 'no-referrer', h.get('referrer-policy') ?? 'missing');
    check('header X-Frame-Options: DENY', h.get('x-frame-options') === 'DENY', h.get('x-frame-options') ?? 'missing');
    const csp = h.get('content-security-policy') ?? '';
    check("header Content-Security-Policy has default-src 'self'", csp.includes("default-src 'self'"), csp || 'missing');
    check('CSP exists and has no unsafe-inline or unsafe-eval', csp !== '' && !/unsafe-(inline|eval)/.test(csp), csp || 'missing');
    check('header Permissions-Policy limits the microphone', (h.get('permissions-policy') ?? '').includes('microphone=(self)'), h.get('permissions-policy') ?? 'missing');
  }

  if (!skipApi) {
    const apiUp = await fetch(base + '/api/health').then((r) => r.ok).catch(() => false);
    if (apiUp) await apiChecks(base, check);
    else check('the API answers through the proxy', false, 'no answer at /api/health (use --no-api for a static server)');
    if (startedHere) await closedPorts(check);
  }
}

let base = given?.replace(/\/$/, '');
let startedHere = false;

if (!base) {
  if (!hasDocker()) {
    console.log('SKIPPED: Docker is not installed on this machine, so the image was not started.');
    console.log('Install Docker, or run this on a machine that has it, or start the app yourself and run:');
    console.log('  npm run smoke -- http://localhost:8080');
    process.exit(2);
  }
  console.log('Building and starting the image (docker compose up -d --build)...');
  if (run('docker', ['compose', 'up', '-d', '--build']).status !== 0) {
    console.log('FAILED: the image did not build or start.');
    process.exit(1);
  }
  startedHere = true;
  base = DEFAULT_URL;
}

let exit = 0;
try {
  if (!(await waitFor(base + '/', 90))) {
    console.log(`FAILED: nothing answered at ${base} within 90 seconds.`);
    exit = startedHere ? 1 : 2;
  } else {
    await checks(base);
    const width = Math.max(...results.map((r) => r.name.length));
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}${r.ok || !r.detail ? '' : `  (${r.detail})`}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed === 0 ? `\nAll ${results.length} checks passed at ${base}.` : `\n${failed} of ${results.length} checks failed at ${base}.`);
    exit = failed === 0 ? 0 : 1;
  }
} catch (e) {
  console.log(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  exit = 1;
} finally {
  if (startedHere) run('docker', ['compose', 'down']);
}
process.exit(exit);
