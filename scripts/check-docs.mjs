// Fails when a number written in the docs no longer matches the code, so PRD, SPECS, the FSD
// and the README cannot drift apart from what the tests say. Run by the pre-push guard and
// by `npm run docs:check`.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const problems = [];
const ok = [];
const read = (p) => readFileSync(p, 'utf8');

// 1. What the tests say. Vitest is run directly with Node (no shell), and writes its report to a file.
const require = createRequire(join(process.cwd(), 'packages/core/package.json'));
const vitestBin = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const outFile = join(mkdtempSync(join(tmpdir(), 'kaabil-docs-')), 'report.json');
const run = spawnSync(process.execPath, [vitestBin, 'run', '--reporter=json', `--outputFile=${outFile}`], {
  cwd: 'packages/core', encoding: 'utf8', maxBuffer: 100 * 1024 * 1024,
});
let report;
try {
  report = JSON.parse(readFileSync(outFile, 'utf8'));
} catch {
  console.log('Could not read the test results: ' + ((run.stderr ?? '') + (run.stdout ?? '')).slice(0, 600));
  process.exit(1);
}
const tests = report.testResults.flatMap((f) => f.assertionResults);
const total = report.numTotalTests;
const scenarios = tests.filter((t) => t.ancestorTitles.includes('scripted dose scenarios')).length;
if (report.numFailedTests > 0) problems.push(`${report.numFailedTests} tests fail, so the docs cannot be compared. Fix the tests first.`);

// 2. Numbers claimed in the docs
function expectNumber(file, regex, actual, what) {
  const text = read(file);
  const matches = [...text.matchAll(new RegExp(regex, 'g'))];
  if (matches.length === 0) { problems.push(`${file}: no "${what}" found (the check expects one; update scripts/check-docs.mjs if the wording changed).`); return; }
  for (const m of matches) {
    const claimed = Number(m[1]);
    if (claimed !== actual) problems.push(`${file}: says ${claimed} ${what}, the code has ${actual}. Change it to ${actual}.`);
    else ok.push(`${file}: ${actual} ${what}`);
  }
}
expectNumber('docs/PRD.md', /(\d+) automated tests pass/, total, 'automated tests');
expectNumber('docs/SPECS.md', /(\d+) tests in packages\/core/, total, 'tests in packages/core');
expectNumber('docs/SPECS.md', /runs (\d+) tests/, total, 'tests (runs N)');
expectNumber('docs/fsd/12-non-functional.md', /\((\d+) tests\)/, total, 'tests (unit row)');

for (const f of ['README.md', 'docs/SPECS.md', 'docs/PRD.md']) {
  for (const m of read(f).matchAll(/\b(\d+) (?:scripted |dose )?scenarios\b/g)) {
    if (Number(m[1]) !== scenarios) problems.push(`${f}: says ${m[1]} scenarios, the code has ${scenarios}. Change it to ${scenarios}.`);
    else ok.push(`${f}: ${scenarios} scenarios`);
  }
}

// 3. FSD counts
const dir = 'docs/fsd';
const chapters = readdirSync(dir).filter((f) => /^\d\d-.*\.md$/.test(f));
const count = (f, re) => (read(join(dir, f)).match(re) ?? []).length;
const frs = chapters.reduce((n, f) => n + count(f, /^### FR-/gm), 0);
const acs = chapters.reduce((n, f) => n + count(f, /^\| AC-[A-Z]+-/gm), 0);
const fsdReadme = read(join(dir, 'README.md'));
const claimedFr = Number(/(\d+) functional requirements/.exec(fsdReadme)?.[1]);
if (claimedFr !== frs) problems.push(`docs/fsd/README.md: says ${claimedFr} functional requirements, the chapters have ${frs}.`);
else ok.push(`docs/fsd/README.md: ${frs} functional requirements`);
const claimedAc = Number(/about (\d+) acceptance criteria/.exec(fsdReadme)?.[1]);
if (!claimedAc || Math.abs(claimedAc - acs) / acs > 0.05) problems.push(`docs/fsd/README.md: says about ${claimedAc} acceptance criteria, the chapters have ${acs}.`);
else ok.push(`docs/fsd/README.md: about ${claimedAc} acceptance criteria (${acs} counted)`);
for (const m of fsdReadme.matchAll(/^\| \d+ \| \[[^\]]+\]\(([^)]+\.md)\) \| [^|]+ \| (\d+) \|$/gm)) {
  const actual = count(m[1], /^### FR-/gm);
  if (actual !== Number(m[2])) problems.push(`docs/fsd/README.md: chapter ${m[1]} listed with ${m[2]} requirements, it has ${actual}.`);
}

for (const line of ok) console.log('ok    ' + line);
for (const line of problems) console.log('FAIL  ' + line);
console.log(problems.length === 0 ? `\nDocs numbers match the code (${total} tests, ${scenarios} scenarios, ${frs} requirements).` : `\n${problems.length} number(s) in the docs are out of date.`);
process.exit(problems.length === 0 ? 0 : 1);
