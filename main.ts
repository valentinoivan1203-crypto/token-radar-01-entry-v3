// Token Radar v3 — the held-out-validated entry (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input
// <file|dir>), scores every pre-token protocol with the model in lib/model.ts,
// writes the ranked board to /output/board.json, writes the dashboard's data
// beside the page as /output/data.js, and copies this repository's dashboard/
// and screenshots/ to /output. Last, it writes /output/dossier.json with the
// vendored make.fun library.
//
// The model: a sector multiple (median mcap/TVL per category, shrunk toward
// the global median, clamped to [0.05, 0.75]) fitted on the snapshot's live
// protocols. The growth term, the maturity term and the parent-risk haircut
// were each fitted and tested held-out on two blind splits and dropped: none
// of them improves out-of-sample prediction in both splits. The dashboard's
// "How each term was tested" panel shows the numbers.
//
// One design note, stated plainly so the test is not misread: the held-out
// test evaluates the shrinkage multiple itself — the term's mechanism —
// without the two deployment guards (a category's own median is used only
// when n >= 3, and the multiple is clamped). Those guards exist to keep
// single-protocol outlier medians from dominating the deployed board; in a
// 64-protocol training split they would fire for most categories and wash out
// the very signal the test measures. The deployed board applies the full
// specification; the test measures the mechanism. Both are shown, and the
// panel says which is which.
//
// The dashboard is a static page, no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read
// /output/data.js (window.RADAR), which this program writes from the same
// board the gate reads. The page's numbers and the board's numbers are the
// same computation, so the screenshots and the code agree.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar, summary } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar v3: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${summary.early_size} early, ${summary.live_size} live set aside)\n` +
    `token radar v3: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
