import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * One-click unsubscribe, on the mail that is a subscription.
 *
 * ---------------------------------------------------------------------------
 * What this is about
 *
 * Every marketing mail this shop sends has always carried an unsubscribe LINK
 * in its footer, and honoured it permanently. What it did not carry was the
 * `List-Unsubscribe` and `List-Unsubscribe-Post` headers, and those are what a
 * mailbox provider reads — Gmail and Yahoo have required one-click unsubscribe
 * from bulk senders since February 2024. Mail without them is throttled and
 * then filed as spam, which means the failure is invisible: nothing errors, the
 * send log says 'sent', and the offers simply stop arriving.
 *
 * The other half is the endpoint. `List-Unsubscribe-Post: List=One-Click` is a
 * promise that a POST to that URL unsubscribes, and RFC 8058 is specific that
 * it must not be a GET: link scanners follow GETs, so a GET is not evidence
 * that a person chose anything.
 *
 * ---------------------------------------------------------------------------
 * And only on the mail that IS a subscription
 *
 * An order confirmation is not something a customer may unsubscribe from — they
 * asked for the order. Putting a list header on a transactional message tells
 * the provider it belongs to a bulk stream, which is both untrue and the way a
 * sending domain's reputation gets mixed up between the two. So the direction
 * this file checks is both ways: the bulk sends must carry a token, and the
 * transactional ones must not.
 *
 * Text, not imports: lib/mail.js reaches Resend and the database, and neither
 * survives being loaded under node:test.
 */

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = p => readFileSync(join(ROOT, p), 'utf8');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Every sendMail() call in the app, with the text of its argument object.
 *
 * Braces are counted rather than matched with a regex, because the argument
 * spans lines and contains its own braces — a lazy `\{.*?\}` would stop at the
 * first template placeholder and silently examine half a call.
 */
function sendMailCalls() {
  const calls = [];
  for (const file of [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'lib'))]) {
    const src = readFileSync(file, 'utf8');
    const name = relative(ROOT, file).split('\\').join('/');
    if (name === 'lib/mail.js') continue; // the definition, not a call

    for (const m of src.matchAll(/sendMail\(\{/g)) {
      let depth = 0;
      let i = m.index + m[0].length - 1;
      for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) break;
      }
      calls.push({ file: name, text: src.slice(m.index, i + 1) });
    }
  }
  return calls;
}

/** The kinds that are a subscription, and so may be unsubscribed from. */
const BULK = ['offer', 'welcome'];

test('the headers exist, and say one-click', () => {
  const mail = read('lib/mail.js');

  assert.match(mail, /'List-Unsubscribe':/, 'lib/mail.js sets no List-Unsubscribe header');
  assert.match(mail, /'List-Unsubscribe-Post': 'List=One-Click'/,
    'lib/mail.js does not declare RFC 8058 one-click, so no provider will draw the button');

  // The URL form matters: the header value is an angle-bracketed URI, and a
  // bare URL is ignored rather than rejected — the quietest possible failure.
  assert.match(mail, /`<\$\{url\}>`/, 'the List-Unsubscribe value is not an angle-bracketed URI');
});

test('the headers go on only when there is a token to unsubscribe', () => {
  const mail = read('lib/mail.js');
  assert.match(mail, /\.\.\.\(unsubToken \? \{ headers: listHeaders\(unsubToken\) \} : \{\}\)/,
    'lib/mail.js no longer makes the list headers conditional on a subscription token');
});

test('every bulk send passes the subscriber token', () => {
  const calls = sendMailCalls();
  assert.ok(calls.length >= 5, `only found ${calls.length} sendMail calls — has the scan broken?`);

  const bulk = calls.filter(c => BULK.some(k => c.text.includes(`kind: '${k}'`)));
  assert.equal(bulk.length, BULK.length,
    `expected one send per bulk kind (${BULK.join(', ')}), found ${bulk.length}`);

  for (const call of bulk) {
    assert.match(call.text, /unsubToken:/,
      `${call.file} sends bulk mail with no unsubToken, so it carries no one-click header`);
  }
});

test('no transactional send carries a list header', () => {
  const offenders = sendMailCalls()
    .filter(c => !BULK.some(k => c.text.includes(`kind: '${k}'`)))
    .filter(c => c.text.includes('unsubToken:'))
    .map(c => c.file);

  assert.deepEqual(offenders, [],
    `these send transactional mail with an unsubscribe header on it: ${offenders.join(', ')}`);
});

test('the unsubscribe endpoint answers the POST the header promises', () => {
  const route = read('app/api/unsubscribe/route.js');

  assert.match(route, /export async function POST\(/,
    'List-Unsubscribe-Post promises a POST endpoint that does not exist — the provider button will fail');
  assert.match(route, /export async function GET\(/,
    'the footer link in the mail body needs the GET');

  // Both verbs must go through the same writer. Two copies of "what
  // unsubscribing means" is how one of them ends up forgetting to persist it.
  const writer = /async function unsubscribe\(req\)/;
  assert.match(route, writer, 'the shared unsubscribe writer is gone');
  const updates = route.match(/UPDATE subscribers SET status = 'unsubscribed'/g) || [];
  assert.equal(updates.length, 1,
    `the unsubscribe write appears ${updates.length} times; GET and POST are meant to share one`);
});
