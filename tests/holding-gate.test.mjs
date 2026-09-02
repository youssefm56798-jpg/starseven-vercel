/**
 * The holding gate — SITE_PASSWORD closes the site while it is unfinished.
 *
 * This is the only thing standing between an unfinished shop and the open
 * internet once newstarseven.com is attached, so it is worth more than a
 * glance. The gate has to fail in exactly one direction: a wrong password gets
 * a prompt, and a missing variable gets no gate at all. Both halves are here,
 * because a gate that is always on breaks every preview and a gate that is
 * always off is decoration.
 *
 * The cron exemption is the subtle one and gets its own tests. Vercel Cron
 * authenticates with a Bearer token and cannot answer a Basic challenge, so a
 * gate over /api/cron would not lock anything an attacker wanted — it would
 * quietly stop the nightly sweep returning reserved stock to the shelf, and
 * that failure is invisible until someone notices the catalogue is empty.
 *
 * Loaded the same way tests/middleware.test.mjs loads it: next/server resolved
 * to its .js entry through a module hook, and skipped rather than failed on a
 * Node too old to have registerHooks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';

const ORIGIN = 'https://newstarseven.com';
const PASSWORD = 'a-test-password';

let middleware = null;
let NextRequest = null;
let unavailable = false;

if (typeof nodeModule.registerHooks !== 'function') {
  unavailable = 'node:module registerHooks is unavailable - needs Node 22.15 or newer';
} else {
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      return nextResolve(specifier === 'next/server' ? 'next/server.js' : specifier, context);
    },
  });
  try {
    ({ NextRequest } = await import('next/server.js'));
    ({ middleware } = await import('../middleware.js'));
  } catch (err) {
    unavailable = `middleware.js could not be loaded: ${err.message}`;
  }
}

const SKIP = unavailable;

/** Runs the middleware with an optional Authorization header. */
function run(path, auth) {
  const headers = auth ? { authorization: auth } : {};
  return middleware(new NextRequest(new Request(ORIGIN + path, { headers })));
}

/** The header a browser needs in order to show a password prompt. */
const basic = (user, pass) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

/** Sets SITE_PASSWORD for one test and always puts it back. */
function withPassword(value, fn) {
  const had = Object.hasOwn(process.env, 'SITE_PASSWORD');
  const previous = process.env.SITE_PASSWORD;
  if (value === undefined) delete process.env.SITE_PASSWORD;
  else process.env.SITE_PASSWORD = value;
  try {
    fn();
  } finally {
    if (had) process.env.SITE_PASSWORD = previous;
    else delete process.env.SITE_PASSWORD;
  }
}

/* --------------------------------------------------------------- gate off */

test('with no SITE_PASSWORD there is no gate', { skip: SKIP }, () => {
  withPassword(undefined, () => {
    for (const path of ['/', '/shop', '/en', '/checkout', '/admin', '/api/order']) {
      assert.notEqual(run(path).status, 401,
        `${path} demanded a password with SITE_PASSWORD unset — every preview and `
        + 'local checkout would be locked out');
    }
  });
});

test('an empty SITE_PASSWORD is treated as unset, not as an empty password', { skip: SKIP }, () => {
  // A blank variable in a dashboard is how somebody turns the gate off. If that
  // were read as a real password, the site would lock behind a value nobody can
  // type and the fix would look like the bug.
  withPassword('', () => {
    assert.notEqual(run('/').status, 401);
  });
});

/* ---------------------------------------------------------------- gate on */

test('with SITE_PASSWORD set the storefront asks for it', { skip: SKIP }, () => {
  withPassword(PASSWORD, () => {
    for (const path of ['/', '/shop', '/en', '/en/shop', '/checkout', '/product/premium-wax-pro-x']) {
      assert.equal(run(path).status, 401, `${path} was reachable with the gate on`);
    }
  });
});

test('the gate covers /api and /admin, which PASS_THROUGH would otherwise skip', { skip: SKIP }, () => {
  // These return before the redirect table, so a gate written after it would
  // miss them — and they are the two that matter most.
  withPassword(PASSWORD, () => {
    for (const path of ['/api/order', '/api/subscribe', '/admin', '/admin/login']) {
      assert.equal(run(path).status, 401, `${path} bypassed the gate`);
    }
  });
});

test('the challenge is a Basic one a browser will prompt for', { skip: SKIP }, () => {
  withPassword(PASSWORD, () => {
    const res = run('/');
    assert.match(res.headers.get('www-authenticate') || '', /^Basic realm=/,
      'without a Basic challenge the browser shows a bare 401 and no password box');
    assert.equal(res.headers.get('cache-control'), 'no-store',
      'a cached 401 would outlive the gate being turned off');
  });
});

test('the right password opens it, whatever username is typed', { skip: SKIP }, () => {
  withPassword(PASSWORD, () => {
    for (const user of ['', 'admin', 'anything at all']) {
      assert.notEqual(run('/', basic(user, PASSWORD)).status, 401,
        `the correct password was refused for username "${user}"`);
    }
  });
});

test('a wrong password does not', { skip: SKIP }, () => {
  withPassword(PASSWORD, () => {
    for (const attempt of ['', 'wrong', PASSWORD.slice(0, -1), `${PASSWORD}x`, PASSWORD.toUpperCase()]) {
      assert.equal(run('/', basic('admin', attempt)).status, 401,
        `"${attempt}" was accepted as the password`);
    }
  });
});

test('a malformed Authorization header is refused rather than throwing', { skip: SKIP }, () => {
  withPassword(PASSWORD, () => {
    for (const header of ['Basic', 'Basic !!!not-base64!!!', 'Bearer something', 'Basic ' + 'x'.repeat(9)]) {
      const res = run('/', header);
      assert.equal(res.status, 401, `"${header}" got through`);
    }
  });
});

/* ------------------------------------------------------- the cron exemption */

test('the cron routes stay reachable with the gate on', { skip: SKIP }, () => {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>. It cannot answer a
  // Basic challenge, so a 401 here stops stock ever being released — silently.
  withPassword(PASSWORD, () => {
    for (const path of ['/api/cron/release', '/api/cron/prune']) {
      assert.notEqual(run(path).status, 401,
        `${path} was gated — the nightly sweep would 401 and reserved stock would never return`);
    }
  });
});

test('the cron exemption does not extend to anything else under /api', { skip: SKIP }, () => {
  // A prefix written /api/cron without the boundary would also exempt
  // /api/cronies, and more usefully to an attacker, /api/cron-anything.
  withPassword(PASSWORD, () => {
    for (const path of ['/api/cronies', '/api/cron-order', '/api/order']) {
      assert.equal(run(path).status, 401, `${path} was wrongly treated as a cron route`);
    }
  });
});
