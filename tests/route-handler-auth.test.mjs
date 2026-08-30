/**
 * Every route handler, and whether it is allowed to answer a stranger.
 *
 * tests/admin-actions.test.mjs polices Server Actions. It finds them by looking
 * for 'use server', which means a route.js is invisible to it — and a route
 * handler is the other kind of POST endpoint this app exposes. Nothing has been
 * checking them.
 *
 * That matters most for the ones under app/admin. A route handler does NOT run
 * the layouts above it: the (panel) layout that redirects a stranger to the
 * login screen never executes for a GET on a route.js sitting inside the same
 * folder. The URL is reachable by anyone who types it. app/admin/(panel)/
 * subscribers/export/route.js gets this right and says so in a comment, which
 * is the whole problem — being right in a comment is not a property the next
 * file inherits. That route hands over the entire customer list as a CSV.
 *
 * So: the admin ones must prove they check the session, and everything else has
 * to be named here with a reason. The allow-list is the point. A new file at
 * app/api/orders/export/route.js fails this suite until somebody writes down
 * why it may answer an anonymous request, and "it needed to be in the list" is
 * a much easier moment to think about it than a code review six months later.
 *
 * Text, not imports: these modules pull in next/server, next/headers and the
 * database, and none of that survives being loaded under node:test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === 'route.js') out.push(full);
  }
  return out;
}

const ROUTES = walk(join(ROOT, 'app')).map(full => ({
  file: relative(ROOT, full).split('\\').join('/'),
  src: readFileSync(full, 'utf8'),
}));

/**
 * The routes that may answer somebody with no session, and why each one may.
 *
 * A reason rather than a bare list, because the list is only worth having if
 * adding to it costs a sentence. Three shapes appear here and they are not the
 * same strength:
 *
 *   open        genuinely public data or a public write with its own limits.
 *   token       the credential is in the URL or the body and is verified
 *               server-side against a stored digest - see lib/order-access.js.
 *               These are not unauthenticated, they are authenticated by
 *               something other than a session.
 */
const PUBLIC = {
  'app/api/products/route.js': 'open: the catalogue that the storefront renders',
  'app/api/quiz/route.js': 'open: hair-type quiz, rate limited, writes only quiz_results',
  'app/api/coupon/route.js': 'open: prices a code against a client-supplied subtotal and writes nothing - the real discount is recomputed from the database in app/api/order/route.js',
  'app/api/subscribe/route.js': 'open: the mailing-list sign-up, rate limited and double opt-in',
  'app/api/order/route.js': 'open: guest checkout, the shop takes no accounts - prices and stock come from the products table, never from the request',
  'app/api/confirm/route.js': 'token: the 40-hex opt-in token from the confirmation email',
  'app/api/unsubscribe/route.js': 'token: the 40-hex token from the mail footer',
  'app/api/order/find/route.js': 'token: mints one, and answers identically whether or not the pair matched',
  'app/api/order/cancel/route.js': 'token: orderFor(ref, t) re-checks the access token against the reference',
  'app/api/order/refund/route.js': 'token: orderFor(ref, t) re-checks the access token against the reference',
};

/**
 * What counts as proof a handler asked who is calling. Same list as
 * tests/admin-actions.test.mjs, and that file pins that each of these really
 * does read the session, so widening one of them cannot quietly widen this.
 */
const SESSION_GUARD = /currentAdmin\s*\(\)|requireAdmin\s*\(\)|requirePermission\s*\(|requireOwner\s*\(\)/;

test('the walk actually finds the route handlers it is meant to police', () => {
  // A scan that silently matches nothing is a test that passes for ever.
  assert.ok(ROUTES.length >= 11, `only found ${ROUTES.length} route handlers`);
  const files = ROUTES.map(r => r.file);
  for (const expected of [
    'app/admin/(panel)/subscribers/export/route.js',
    'app/api/order/route.js',
  ]) {
    assert.ok(files.includes(expected), `${expected} was not found by the scan`);
  }
});

test('every route handler under app/admin checks the session itself', () => {
  const admin = ROUTES.filter(r => r.file.startsWith('app/admin/'));
  assert.ok(admin.length >= 1, 'no admin route handlers found - has the scan broken?');

  const missing = admin.filter(r => !SESSION_GUARD.test(r.src)).map(r => r.file);
  assert.deepEqual(missing, [], `admin route handlers with no session check - a layout does not guard a route handler:\n${missing.join('\n')}`);
});

test('every route handler outside app/admin is on the public list, with a reason', () => {
  const unlisted = ROUTES
    .filter(r => !r.file.startsWith('app/admin/'))
    .filter(r => !PUBLIC[r.file])
    .map(r => r.file);

  assert.deepEqual(unlisted, [], `these route handlers answer anyone and nobody has said why they may.\nAdd each to PUBLIC in this file with a reason, or give it a session check:\n${unlisted.join('\n')}`);
});

test('the public list has no entries for routes that no longer exist', () => {
  // Otherwise a route deleted today leaves permission behind for a route
  // created at the same path tomorrow.
  const files = new Set(ROUTES.map(r => r.file));
  const stale = Object.keys(PUBLIC).filter(f => !files.has(f));
  assert.deepEqual(stale, [], `PUBLIC names route handlers that are not there: ${stale.join(', ')}`);
});

test('an admin route handler checks the session before it touches the database', () => {
  // A handler that read rows and then asked who was calling would be a leak
  // with a tidy-looking guard underneath it.
  for (const r of ROUTES.filter(r => r.file.startsWith('app/admin/'))) {
    const guard = r.src.search(SESSION_GUARD);
    const read = r.src.search(/\bsql`/);
    if (read < 0) continue;
    assert.ok(guard >= 0 && guard < read,
      `${r.file} queries the database before it checks who is calling`);
  }
});

test('the CSV export is behind a permission, not merely behind a session', () => {
  /*
   * Named on its own rather than left to the general rule above, because this
   * is the single most valuable thing that can leave the panel: the whole
   * customer list, in one file, in one request.
   *
   * Staff can already read subscribers a row at a time, which is what answering
   * a phone needs. The bulk copy is different in kind, so lib/admin-roles.js
   * gives subscribers:export to the owner alone - and a session check on its
   * own would hand the file to every member of staff.
   */
  const file = 'app/admin/(panel)/subscribers/export/route.js';
  const route = ROUTES.find(r => r.file === file);
  assert.ok(route, `${file} has moved - this test needs updating, not deleting`);
  assert.match(route.src, /can\s*\(\s*admin\.role\s*,\s*'subscribers:export'\s*\)/,
    'the subscriber export no longer checks the subscribers:export permission');
});
