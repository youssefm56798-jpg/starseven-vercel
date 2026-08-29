/**
 * The bits every route case file needs: an assertion that prints the same way
 * verify-order-status.mjs prints, an HTTP client that speaks to the dev server
 * the way a browser does, and a rate-limit-bucket allocator.
 *
 * Kept apart from scripts/verify-routes.mjs so the orchestration — throwaway
 * database, schema, server lifecycle — reads as one page, and so a case file
 * imports assertions without importing the machinery that creates databases.
 */

/* ------------------------------------------------------------- assertions */

/**
 * A results sink rather than module-level counters.
 *
 * Two reasons. The orchestrator needs the failure count as a return value to
 * set an exit code with, and a module-level `let failures` would make that a
 * hidden global that a second run in the same process would inherit. And every
 * case file gets the same object passed in, so a case cannot accidentally
 * assert into a different tally than the one that is checked at the end.
 */
export function makeReport() {
  const state = { checks: 0, failures: 0 };

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /** Deep-equality assertion. Prints got/want on failure, like the order script. */
  const check = (name, got, want) => {
    state.checks++;
    if (same(got, want)) return console.log(`    ok    ${name}`);
    state.failures++;
    console.log(`    FAIL  ${name}`);
    console.log(`          got  ${JSON.stringify(got)}`);
    console.log(`          want ${JSON.stringify(want)}`);
  };

  /** For properties that read better as a sentence than as an equality. */
  const checkThat = (name, condition, detail = '') => {
    state.checks++;
    if (condition) return console.log(`    ok    ${name}`);
    state.failures++;
    console.log(`    FAIL  ${name}`);
    if (detail) console.log(`          ${detail}`);
  };

  const section = title => console.log(`\n  ${title}`);
  const sub = title => console.log(`\n    ${title}`);

  /**
   * Something true and worth printing that is not a pass/fail — an observation
   * a reader of the output should have, such as a measured timing that the
   * assertion above it only bounds loosely.
   */
  const note = text => console.log(`    ..    ${text}`);

  return { state, check, checkThat, section, sub, note };
}

/* ------------------------------------------------------------------ http */

/**
 * Headers that differ between two otherwise identical responses for reasons
 * that carry no information about the request. Compared responses have these
 * removed before they are compared, so a one-second clock tick between two
 * samples is not read as a distinguishable answer.
 */
const VOLATILE = new Set([
  'date', 'connection', 'keep-alive', 'transfer-encoding',
  'x-nextjs-cache', 'x-nextjs-prerender', 'x-nextjs-stale-time',
]);

/** Header map, lower-cased and sorted, with the volatile ones dropped. */
export function stableHeaders(headers) {
  const out = {};
  for (const [k, v] of [...headers.entries()].sort()) {
    if (!VOLATILE.has(k)) out[k] = v;
  }
  return out;
}

/**
 * One request against the running dev server.
 *
 * `ip` becomes an x-real-ip header, which is one of the two sources
 * lib/db.js#clientIp trusts. That is how a case file gets its own rate-limit
 * bucket: the limiter keys on the /24 the address belongs to, so two cases with
 * addresses in different /24s cannot spend each other's budget. It is also the
 * only way to exercise the limiter at all from one machine.
 *
 * The body is stringified here rather than by the caller so that content-type
 * is always set deliberately: undici picks `text/plain` for a bare string, and
 * lib/http.js#readJson treats a non-JSON content-type as an empty body — so a
 * forgotten header would silently turn every request in a case file into a
 * validation failure that still looked like a real test.
 */
export function makeClient(base) {
  return async function api(path, opts = {}) {
    const {
      method = 'GET',
      json,                 // object -> JSON body with the right content-type
      body,                 // raw string body, used verbatim
      contentType,          // override, including omitting it entirely (null)
      ip,
      headers = {},
    } = opts;

    const h = { ...headers };
    if (ip) h['x-real-ip'] = ip;

    let payload;
    if (json !== undefined) {
      payload = JSON.stringify(json);
      if (contentType !== null) h['content-type'] = contentType || 'application/json';
    } else if (body !== undefined) {
      payload = body;
      if (contentType) h['content-type'] = contentType;
    }

    const started = performance.now();
    const res = await fetch(`${base}${path}`, { method, headers: h, body: payload, redirect: 'manual' });
    const text = await res.text();
    const ms = performance.now() - started;

    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* HTML routes, and error pages */ }

    return {
      status: res.status,
      headers: stableHeaders(res.headers),
      header: name => res.headers.get(name),
      text,
      json: parsed,
      ms,
    };
  };
}

/* ------------------------------------------------- rate-limit bucket keys */

/**
 * A fresh /24 per label.
 *
 * lib/db.js#ipBucket deliberately coarsens an IPv4 address to its /24 before
 * using it as a limit key, because bucketing on the exact address is defeated
 * by anyone who owns a block. That means varying the last octet does NOT give a
 * fresh bucket — a mistake that would make every rate-limit assertion in this
 * suite pass for the wrong reason — so the counter moves the third octet and
 * the last one is a fixed 7.
 *
 * 10.0.0.0/8 is private space that no real client of this shop can present, so
 * a bucket created here can never collide with a row a real request left
 * behind. (It cannot anyway — the database is thrown away — but the addresses
 * are also written into the orders and subscribers audit columns, and a test
 * order that claims to come from a routable address is a lie in the fixture.)
 */
export function makeIps() {
  const seen = new Map();
  return function ip(label) {
    if (!seen.has(label)) {
      const n = seen.size;
      seen.set(label, `10.${Math.floor(n / 250) + 1}.${n % 250}.7`);
    }
    return seen.get(label);
  };
}

/* ------------------------------------------------------------ statistics */

export function median(xs) {
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * The probability that a randomly chosen sample from `a` is slower than one
 * from `b` — the Mann-Whitney statistic, ties counted as half.
 *
 * Used instead of comparing means because a mean is dragged around by the one
 * request that hit a cold lambda or a garbage collection, and a timing
 * side-channel test that flakes gets deleted rather than fixed. 0.5 is "no
 * information"; 1.0 is "every sample of a beat every sample of b", which is
 * what an oracle looks like.
 */
export function auc(a, b) {
  let wins = 0;
  for (const x of a) for (const y of b) wins += x > y ? 1 : x === y ? 0.5 : 0;
  return wins / (a.length * b.length);
}
