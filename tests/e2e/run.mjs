// Runs the end-to-end scripts against a running copy of the app with TestSutra.
//
//   docker compose up -d --build
//   npm run e2e                          # http://localhost:8080
//   npm run e2e -- http://localhost:8080 # another address
//
// KAABIL_E2E_ATTACH=<DevTools address> drives a browser that is already running (for example one started with a fake microphone) and runs only the
// scripts that need a microphone; without it those are skipped and the rest run in fresh browsers.
// TestSutra is found as `testsutra` on the PATH, or through KAABIL_TESTSUTRA=<path to the exe>.
// It drives a browser you already have (Chrome, Edge or Firefox). Exit codes: 0 every script
// passed, 1 a script failed, 2 it could not run (no TestSutra, or nothing at the address).
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SCRIPTS } from './scripts.mjs';

const base = (process.argv.slice(2).find((a) => /^https?:\/\//.test(a)) ?? 'http://localhost:8080').replace(/\/$/, '');
const exe = process.env.KAABIL_TESTSUTRA ?? 'testsutra';
const attach = process.env.KAABIL_E2E_ATTACH ?? '';
const work = join(tmpdir(), `kaabil-e2e-${Date.now()}`);
const results = 'test-results';
mkdirSync(work, { recursive: true });

/** A 1.6 second test "recording": quiet room, a voice-like tone with a rise and fall, quiet room. 16 kHz mono 16-bit. */
function toneWav() {
  const rate = 16_000;
  const total = Math.round(rate * 1.6);
  const pcm = Buffer.alloc(44 + total * 2);
  pcm.write('RIFF', 0);
  pcm.writeUInt32LE(36 + total * 2, 4);
  pcm.write('WAVEfmt ', 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(rate, 24);
  pcm.writeUInt32LE(rate * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write('data', 36);
  pcm.writeUInt32LE(total * 2, 40);
  for (let i = 0; i < total; i++) {
    const t = i / rate;
    const inside = t > 0.3 && t < 1.3;
    const envelope = inside ? Math.sin((Math.PI * (t - 0.3)) / 1.0) : 0;
    const v = 0.15 * envelope * (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 440 * t));
    pcm.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return pcm;
}

const tone = join(work, 'tone.wav');
writeFileSync(tone, toneWav());

const health = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
if (!health) {
  console.log(`Nothing answers at ${base}/api/health. Start the app first: docker compose up -d --build`);
  process.exit(2);
}

let failed = 0;
// An attached browser keeps its cookies and storage between scripts, so it runs only the scripts that need its microphone; the rest run in fresh browsers.
const scripts = SCRIPTS.filter((s) => Boolean(s.needsMicrophone) === Boolean(attach));
if (!attach && scripts.length < SCRIPTS.length) console.log(`Skipping ${SCRIPTS.length - scripts.length} script(s) that need a microphone (set KAABIL_E2E_ATTACH, see tests/e2e/scripts.mjs).`);
for (const [i, s] of scripts.entries()) {
  const script = {
    id: randomUUID(),
    name: s.name,
    url: `${base}/test/`,
    created_at: new Date().toISOString(),
    requirements: s.requirements,
    version: 1,
    steps: JSON.parse(JSON.stringify(s.steps).replaceAll('${TONE}', tone.replaceAll('\\', '/')).replaceAll('http://localhost:8080', base)),
  };
  const file = join(work, `${String(i + 1).padStart(2, '0')}.json`);
  writeFileSync(file, JSON.stringify(script, null, 2));
  console.log(`\n== ${i + 1}. ${s.name}`);
  const r = spawnSync(exe, ['run', '--script', file, '--url', base, '--output', join(results, String(i + 1)), '--report', 'md,json', ...(attach ? ['--attach', attach] : [])], { stdio: 'inherit' });
  if (r.error) {
    console.log(`Could not start TestSutra (${exe}): ${r.error.message}\nSet KAABIL_TESTSUTRA to the path of testsutra-windows-x64.exe.`);
    rmSync(work, { recursive: true, force: true });
    process.exit(2);
  }
  if (r.status !== 0) failed += 1;
}
rmSync(work, { recursive: true, force: true });
console.log(failed === 0 ? `\nAll ${scripts.length} end-to-end scripts passed. Reports are in ${results}/.` : `\n${failed} of ${scripts.length} end-to-end scripts failed. See ${results}/.`);
process.exit(failed === 0 ? 0 : 1);
