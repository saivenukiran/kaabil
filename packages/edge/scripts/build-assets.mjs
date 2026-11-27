// Builds the screens and puts them where the Worker serves them from:
//   the app (apps/web)        -> packages/edge/public/
//   the test page (testpage)  -> packages/edge/public/test/
// Run from the repository root:  npm run build:assets --workspace @kaabil/edge
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const out = join(root, 'packages', 'edge', 'public');

for (const ws of ['@kaabil/web', '@kaabil/testpage']) {
  const r = spawnSync('npm', ['run', 'build', '--workspace', ws], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.log(`Build of ${ws} failed.`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'apps', 'web', 'dist'), out, { recursive: true });
cpSync(join(root, 'apps', 'testpage', 'dist'), join(out, 'test'), { recursive: true });
// the security headers for the screens (Cloudflare reads this file from the assets folder)
cpSync(join(root, 'packages', 'edge', '_headers'), join(out, '_headers'));
if (!existsSync(join(out, 'index.html')) || !existsSync(join(out, 'test', 'index.html'))) {
  console.log('The assets are incomplete.');
  process.exit(1);
}
console.log(`Assets ready in ${out}`);
