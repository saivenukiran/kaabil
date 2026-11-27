// Runs after `npm ci` / `npm install`. Best effort: never fails the install
// (for example in Docker, where there is no .git folder).
import { execSync } from 'node:child_process';

const quiet = { stdio: 'ignore' };
try { execSync('git config core.hooksPath scripts/hooks', quiet); } catch { /* not a git checkout */ }
// Turbo sends anonymous usage data unless told not to. We switch it off.
try { execSync('npx --no-install turbo telemetry disable', quiet); } catch { /* turbo not installed yet */ }
