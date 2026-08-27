/**
 * Line endings and encoding, across every text file in the repository.
 *
 * .gitattributes declares `* text=auto eol=lf`, and db/seed.sql genuinely
 * cannot survive a carriage return: scripts/sql-split.mjs tracks quote state
 * character by character, and a stray CR lands inside the Arabic article
 * bodies. That much was already tested.
 *
 * What was not tested is everything else. Several editors and every naive
 * Python `open(path, 'w')` on Windows rewrite a whole file to CRLF on save,
 * silently, and the diff then shows every line as changed. That has happened
 * to this repo more than once, and only the seed noticed. So the check is the
 * whole tree now, and it is one test per file so a failure names the file
 * rather than making someone bisect a list.
 *
 * Binary assets are excluded by extension rather than by sniffing: a .webp
 * containing the bytes 0D 0A is not a line ending, and the exclusion list is
 * short enough to read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BINARY = /\.(png|jpe?g|webp|gif|ico|pdf|woff2?|ttf|otf|mp4|zip)$/i;

/**
 * Tracked text files, from git rather than a directory walk, so node_modules,
 * .next and anything else ignored is out by construction.
 *
 * If git is not available the whole suite skips rather than fails: a tarball
 * of the source is a legitimate way to receive this code, and it is not the
 * place to start refusing to run.
 */
function trackedTextFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
    return out.split('\0').filter(Boolean).filter(f => !BINARY.test(f));
  } catch {
    return null;
  }
}

const files = trackedTextFiles();

test('the repository is a git checkout with tracked files', {
  skip: files ? false : 'git not available - not a checkout, so there is nothing to enumerate',
}, () => {
  assert.ok(files.length > 0, 'git ls-files returned nothing');
});

for (const rel of files ?? []) {
  test(`${rel} is LF, UTF-8 and has no BOM`, {
    // A file listed by git but absent on disk is a deletion the developer has
    // not staged yet, which is their business and not a line-ending fault.
    skip: existsSync(`${ROOT}${rel}`) ? false : 'not on disk',
  }, () => {
    const buf = readFileSync(`${ROOT}${rel}`);

    assert.ok(!buf.includes(0x0d), 'contains a carriage return - saved as CRLF');
    assert.ok(
      !(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf),
      'starts with a UTF-8 BOM'
    );

    // Round-tripping is the cheapest honest test for "is this really UTF-8":
    // Node substitutes U+FFFD for any byte sequence it cannot decode, so a
    // file that survives the trip byte-for-byte held no invalid sequences.
    const text = buf.toString('utf8');
    assert.ok(
      Buffer.from(text, 'utf8').equals(buf),
      'is not valid UTF-8 - most likely saved as windows-1256 or latin-1'
    );
  });
}
