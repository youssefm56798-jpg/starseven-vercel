#!/usr/bin/env node
/**
 * Post-build gate: did the pages that are supposed to be static actually get
 * prerendered?
 *
 * WHY THIS EXISTS, and why it is a script and not a test.
 *
 * Every other check in tests/ reads source files or calls pure functions, and
 * every one of them can be green on a build that caches absolutely nothing.
 * That is not hypothetical — it is what happened the first time this was
 * attempted. `export const revalidate = 60` was written on the shop pages, the
 * suite passed, the deploy went out, and not a single page was prerendered.
 * Next had silently overwritten the window with 0, because the page awaited
 * `searchParams` on the way in.
 *
 * That failure mode is invisible by construction. A dynamic API in a legacy
 * (non-PPR) prerender does not fail the build and does not warn. It opts the
 * route out of static generation, zeroes the revalidate on the way out, and the
 * build succeeds. The only two places it shows are the build output, which
 * nobody reads line by line, and .next/prerender-manifest.json, which nobody
 * opens at all. So the declaration in the source and the behaviour in
 * production can disagree indefinitely, and a unit test that reads the source
 * will keep agreeing with the declaration.
 *
 * This script reads what Next actually wrote. It refuses a build where a page
 * that must be static is missing from the manifest, where its revalidate window
 * is zero or false, where a route that must stay dynamic has been frozen into
 * HTML instead, or where the prerendered HTML is not on disk. It is the only
 * check in the repository that can tell the difference between the migration
 * having worked and the migration having compiled.
 *
 * Run it after the build:
 *     node scripts/check-prerender.mjs
 * and wire it in so it cannot be forgotten (this script does not edit
 * package.json itself):
 *     "build": "next build && node scripts/check-prerender.mjs"
 *
 * It exits 0 on success and 1 with a list of what is wrong on failure.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Windows-safe repo root the tests use: URL pathnames arrive as /C:/... on
// win32, and the leading slash has to come off before fs sees it.
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const MANIFEST = join(ROOT, '.next/prerender-manifest.json');

/**
 * Pages that must be prerendered with a live revalidate window, in both
 * languages. These are the storefront's crawlable entry points: the ones a
 * search result or a WhatsApp link lands on, where time to first byte is the
 * whole argument for doing this migration at all.
 */
const MUST_BE_STATIC = [
  '/', '/en',
  '/shop', '/en/shop',
  '/hair-types', '/en/hair-types',
  '/hair-styles', '/en/hair-styles',
  '/blog', '/en/blog',
  '/brand', '/en/brand',
  '/privacy', '/en/privacy',
  '/terms', '/en/terms',
];

/**
 * Routes that must NOT be prerendered. The checkout reads the cart and the
 * coupon out of the request and the order page is a live status lookup; a
 * cached copy of either is a wrong answer served confidently, which is worse
 * than a slow one.
 */
const MUST_BE_DYNAMIC = ['/checkout', '/en/checkout', '/order/[ref]'];

/**
 * One prerendered HTML file, checked on disk rather than in the manifest.
 * The manifest is Next describing its intentions; this is the artefact. If
 * /shop is listed as static and shop.html is not there, the manifest is wrong
 * and everything else in this script is reading a fiction.
 */
const MUST_EXIST_ON_DISK = '.next/server/app/shop.html';

const problems = [];

if (!existsSync(MANIFEST)) {
  console.error(
    'check-prerender: .next/prerender-manifest.json is missing.\n' +
    '  Run `next build` first — this script checks the output of a build, not the source.'
  );
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
} catch (err) {
  console.error(`check-prerender: could not parse .next/prerender-manifest.json — ${err.message}`);
  process.exit(1);
}

const routes = manifest.routes ?? {};
const dynamicRoutes = manifest.dynamicRoutes ?? {};

for (const route of MUST_BE_STATIC) {
  const entry = routes[route];
  if (!entry) {
    problems.push(
      `${route} is not prerendered. It is missing from "routes" in the manifest, which ` +
      'means the route read a dynamic API (searchParams, headers, cookies) or sits under ' +
      'a layout that did, and Next opted it out of static generation.'
    );
    continue;
  }
  const seconds = entry.initialRevalidateSeconds;
  if (typeof seconds !== 'number' || !(seconds > 0)) {
    problems.push(
      `${route} is prerendered but its revalidate window is ${JSON.stringify(seconds)}. ` +
      'Zero or false is the value Next writes when the declared window was discarded, so ' +
      'the page is built once and never refreshed — a price change would never appear.'
    );
  }
}

for (const route of MUST_BE_DYNAMIC) {
  if (routes[route]) {
    problems.push(
      `${route} has been prerendered into static HTML. This route has to read the request ` +
      'on every visit; a cached copy is a stale cart or someone else\'s order status.'
    );
  }
  if (dynamicRoutes[route]) {
    problems.push(
      `${route} is listed under "dynamicRoutes", which is Next's ISR table, not its ` +
      'dynamic-rendering table. It is being cached and revalidated on a timer, and it ' +
      'must not be cached at all — check for a stray `export const revalidate`.'
    );
  }
}

if (!existsSync(join(ROOT, MUST_EXIST_ON_DISK))) {
  problems.push(
    `${MUST_EXIST_ON_DISK} does not exist. The manifest may claim /shop is static, but ` +
    'no HTML was written for it, so nothing can be served from the cache.'
  );
}

if (problems.length > 0) {
  console.error('\ncheck-prerender: the build is not caching what it is supposed to cache.\n');
  for (const problem of problems) console.error(`  - ${problem}\n`);
  console.error(
    `${problems.length} problem${problems.length === 1 ? '' : 's'}. ` +
    'The usual cause is a single `await searchParams`, `headers()` or `cookies()` left in a ' +
    'route file or in a layout above it. Neither fails the build, so this is where it shows.\n'
  );
  process.exit(1);
}

console.log(
  `check-prerender: ${MUST_BE_STATIC.length} pages prerendered with a live revalidate ` +
  `window, ${MUST_BE_DYNAMIC.length} routes correctly left dynamic.`
);
