/**
 * Every Server Action in this app, and the two checks each one has to carry.
 *
 * A Server Action is a POST endpoint. Next gives it an unguessable id and no
 * gate whatsoever: anything that can reach the site can invoke it, from any
 * origin that can make the browser send the session cookie. The two lines that
 * stand between that and the panel are
 *
 *     await requireAdmin();                              // who
 *     if (!(await csrfOk(formData.get('_csrf')))) ...    // and did they mean to
 *
 * and they are copied by hand into every action, which is exactly the kind of
 * thing that gets forgotten on the eighth one. The products page already lost
 * this once — its Feature button shipped without the `_csrf` input its two
 * sibling forms carried, and the action rejected every press.
 *
 * So this walks the source, finds the actions rather than being told where
 * they are, and fails if any of them is missing either check. Text, not
 * imports: these modules pull in next/navigation, next/headers and the
 * database, and none of that survives being loaded under node:test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, walk, serverActions } from './_lib/server-actions.mjs';

/*
 * The scanner that finds the actions lives in tests/_lib/server-actions.mjs,
 * because tests/action-permissions.test.mjs needs the same one and a second
 * copy would drift. The test below still asserts that it found the actions this
 * file knows about, so an extraction that broke it fails here.
 */

const ALL = serverActions();

test('the walk actually finds the actions it is meant to police', () => {
  // A scan that silently matches nothing is a test that passes for ever.
  assert.ok(ALL.length >= 12, `only found ${ALL.length} server actions`);
  const names = ALL.map(a => `${a.file}:${a.name}`);
  for (const expected of [
    'app/admin/(panel)/products/page.js:newProduct',
    'app/admin/(panel)/products/page.js:saveProduct',
    'app/admin/(panel)/offers/page.js:createOffer',
    'app/admin/_lib/security-actions.js:changeAdminPassword',
  ]) {
    assert.ok(names.includes(expected), `${expected} was not found by the scan`);
  }
});

/*
 * What counts as proof that an action checked who is calling.
 *
 * requireAdmin and currentAdmin read the session cookie. requirePermission and
 * requireOwner arrived with roles and are accepted because they call
 * requireAdmin themselves — which is asserted below rather than assumed, so
 * this list cannot quietly grow into a way of passing without checking.
 */
const SESSION_GUARD = /requireAdmin\s*\(\)|currentAdmin\s*\(\)|requirePermission\s*\(|requireOwner\s*\(\)/;

test('every server action checks the CSRF token', () => {
  // Without this an ordinary cross-site form post carries the admin session
  // cookie and the action runs. SameSite=lax on the cookie is not enough on
  // its own: it is a browser default, not a guarantee, and a top-level POST
  // from a page the admin was tricked into opening is precisely the case it
  // does not cover in every browser.
  const missing = ALL.filter(a => !/csrfOk\s*\(/.test(a.body)).map(a => `${a.file}:${a.name}`);
  assert.deepEqual(missing, [], `server actions with no CSRF check:\n${missing.join('\n')}`);
});

test('every server action in the panel also re-checks the session', () => {
  // The (panel) layout guards the group, but a layout is not an authorisation
  // boundary for an endpoint: the action is reachable directly, whatever the
  // page around it did or did not render. The (auth) group is exempt by
  // definition — logging in is what you do before you have a session.
  const panel = ALL.filter(a => a.file.includes('/(panel)/') || a.file.includes('/_lib/'));
  assert.ok(panel.length >= 8, `only ${panel.length} panel actions found`);

  const missing = panel
    .filter(a => a.name !== 'logout')     // ending a session cannot require one
    .filter(a => !SESSION_GUARD.test(a.body))
    .map(a => `${a.file}:${a.name}`);
  assert.deepEqual(missing, [], `panel actions with no session check:\n${missing.join('\n')}`);
});

test('the guards this file accepts all actually check the session', () => {
  /*
   * The regex above grew when roles arrived: an action that says
   * requirePermission('products:write') has checked the session, but only
   * because that helper calls requireAdmin() itself. Widening the pattern
   * without pinning that is how a test stops testing — the next helper added
   * to guard.js would be accepted on the strength of its name.
   *
   * So the names are checked against the source of the module that defines
   * them. requireAdmin is the root and reads the cookie directly; every other
   * accepted name has to reach it.
   */
  const guard = readFileSync(join(ROOT, 'app/admin/_lib/guard.js'), 'utf8');

  assert.match(guard, /export async function requireAdmin\s*\(\)[\s\S]*?currentAdmin\s*\(\)/,
    'requireAdmin no longer reads the session itself');

  for (const name of ['requirePermission', 'requireOwner']) {
    const at = guard.indexOf(`export async function ${name}`);
    assert.ok(at >= 0, `${name} is not exported from guard.js`);

    /*
     * From after the opening brace, not from the declaration.
     *
     * The first version of this sliced from `export async function ...`, and
     * the declaration of requirePermission(permission) matches the very
     * pattern being searched for — so the test found the function's own name
     * and passed no matter what the body did. Gutting requireAdmin out of it
     * did not fail this test, which is how the mistake was caught. A guard
     * test that cannot fail is worse than no guard test, because it is counted.
     */
    const open = guard.indexOf('{', guard.indexOf('(', at));
    const end = guard.indexOf('\n}', open);
    const body = guard.slice(open + 1, end > 0 ? end : open + 600);

    assert.match(body, /\brequireAdmin\s*\(\)|\brequirePermission\s*\(/,
      `${name} is accepted as a session check but its body never performs one`);
  }
});

test('the session check comes before anything is written', () => {
  // An action that validated its input, wrote a row and then asked who was
  // calling would be a hole with a tidy-looking guard in it.
  for (const a of ALL) {
    const guard = a.body.search(new RegExp(`${SESSION_GUARD.source}|csrfOk\\s*\\(`));
    const write = a.body.search(/\bsql`\s*(?:UPDATE|INSERT|DELETE)|createProduct|updateProduct|archiveProduct|discardProduct|restoreProduct|toggleActive|toggleFeatured|transition\s*\(/);
    if (write < 0) continue;
    assert.ok(guard >= 0 && guard < write,
      `${a.file}:${a.name} writes before it checks who is calling`);
  }
});

test('every form in the panel posts the token its action demands', () => {
  // The other half of the same check. An action that verifies a token nobody
  // sends is not secure, it is broken — which is what happened to the Feature
  // button when its hidden input went missing.
  for (const full of walk(join(ROOT, 'app/admin'))) {
    const src = readFileSync(full, 'utf8');
    const file = relative(ROOT, full).split('\\').join('/');
    const forms = src.match(/<form[\s\S]*?>/g) ?? [];
    if (!forms.length) continue;
    // Count the forms whose action is a server action, then the tokens.
    const withAction = forms.filter(f => /action=\{/.test(f)).length;
    const tokens = (src.match(/name="_csrf"/g) ?? []).length;
    assert.ok(tokens >= withAction,
      `${file} has ${withAction} form(s) posting to an action but only ${tokens} _csrf input(s)`);
  }
});
