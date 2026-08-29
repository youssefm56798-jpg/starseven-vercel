/**
 * The properties that belong to every route rather than to any one of them:
 * the headers a response carries, and what happens when a method or a path
 * nobody wrote a handler for is asked for.
 *
 * Two header sets meet on an /api response and it matters which wins.
 * next.config.mjs applies a site-wide Content-Security-Policy built for HTML
 * pages — it has to allow inline scripts, because that is how a prerendered
 * Next page hydrates. lib/http.js sets a far tighter one on JSON:
 * `default-src 'none'; frame-ancestors 'none'`, which is right for a document
 * that is never rendered. Only one of them arrives, and until this file nothing
 * had ever looked at which.
 */

export default async function headers({ api, ip, check, checkThat, section, note }) {
  section('cross-cutting: headers, methods and unknown paths');

  /* -------------------------------------------------- the JSON header set */

  // One of each shape: a 200 from ok(), a 4xx from fail(), and a route that
  // does its own Response.json. They must not disagree about any of this.
  const samples = [
    ['POST /api/quiz (200)', await api('/api/quiz', { method: 'POST', ip: ip('hdr-a'), json: { hair_type: 'straight' } })],
    ['POST /api/coupon (422)', await api('/api/coupon', { method: 'POST', ip: ip('hdr-b'), json: {} })],
    ['POST /api/order (422)', await api('/api/order', { method: 'POST', ip: ip('hdr-c'), json: {} })],
  ];

  for (const [label, res] of samples) {
    check(`${label} — content-type is JSON`,
      String(res.header('content-type') || '').split(';')[0], 'application/json');
    check(`${label} — never cached`, res.header('cache-control'), 'no-store');
    check(`${label} — nosniff`, res.header('x-content-type-options'), 'nosniff');
  }

  /* ------------------------------------------------ which policy arrives */

  /**
   * It is the page one, and that is a finding rather than a preference.
   *
   * lib/http.js puts `default-src 'none'; frame-ancestors 'none'` on every JSON
   * response it builds, and that header never reaches the client: the
   * `/:path*` rule in next.config.mjs matches /api too, and a header set by the
   * config replaces the one the route set. So the strictest policy in the
   * codebase is dead code, and what actually ships on an API response is the
   * policy written for HTML pages — including `frame-ancestors 'self'` where
   * the route asked for 'none'.
   *
   * The practical exposure is small: a JSON body with `nosniff` on it executes
   * nothing whatever the policy says. The reason to record it is that the
   * comment in lib/http.js and the header on the wire disagree, and a security
   * header nobody has ever read is exactly the kind that is quietly wrong.
   *
   * The assertions below are written against what is actually sent, so this
   * suite stays green and reports the truth. The day someone adds an
   * `/api/:path*` rule after the page rule, the first of them fails and points
   * straight at this comment.
   *
   * Matched loosely at the front because the page policy legitimately differs
   * between `next dev` and a production build — the dev one carries
   * 'unsafe-eval' for React Fast Refresh and the shipped one does not.
   */
  const policies = new Set(samples.map(([, r]) => r.header('content-security-policy')));
  check('every /api response agrees on one policy', policies.size, 1);

  const csp = samples[0][1].header('content-security-policy') || '';
  checkThat("the policy on /api is the page policy from next.config.mjs",
    csp.startsWith("default-src 'self'"), `got ${csp}`);
  checkThat("lib/http.js's default-src 'none' does not reach the client",
    !csp.includes("default-src 'none'"), `got ${csp}`);
  checkThat('whichever policy wins still forbids plugins and off-origin forms',
    csp.includes("object-src 'none'") && csp.includes("form-action 'self'"), `got ${csp}`);
  checkThat('and names no third-party host',
    !/https?:\/\//.test(csp), `got ${csp}`);

  note("FINDING: the tight JSON CSP in lib/http.js is overridden site-wide by next.config.mjs.");
  note("         Fix is an `/api/:path*` rule placed after the `/:path*` one.");

  /* ------------------------------------------- the site-wide header block */

  // These come from next.config.mjs and are meant to be on everything. An API
  // response is a response, so it gets them too.
  const one = samples[0][1];
  check('X-Frame-Options is set site-wide', one.header('x-frame-options'), 'SAMEORIGIN');
  check('Referrer-Policy is set site-wide',
    one.header('referrer-policy'), 'strict-origin-when-cross-origin');
  check('HSTS is set site-wide',
    one.header('strict-transport-security'), 'max-age=63072000; includeSubDomains');
  check('poweredByHeader:false — nothing announces the framework',
    one.header('x-powered-by'), null);

  /* ----------------------------------------------------- the one exception */

  // /api/products is the only route that wants to be cached, and it says so
  // itself rather than inheriting no-store. That is the whole reason it builds
  // its response by hand instead of going through ok().
  const cat = await api('/api/products', { ip: ip('hdr-d') });
  checkThat('/api/products is cacheable, unlike every other route',
    /public/.test(cat.header('cache-control') || ''),
    `cache-control was ${cat.header('cache-control')}`);
  check('/api/products still refuses sniffing', cat.header('x-content-type-options'), 'nosniff');

  /* ------------------------------------------------------------- methods */

  // A route file that exports only POST must answer 405 to a GET, not 200 with
  // something, and not 500. This is the cheapest way to notice that a handler
  // was renamed or exported under the wrong name.
  const wrongMethod = [
    ['GET', '/api/order'],
    ['GET', '/api/subscribe'],
    ['GET', '/api/coupon'],
    ['GET', '/api/quiz'],
    ['GET', '/api/order/refund'],
    ['POST', '/api/products'],
    ['POST', '/api/confirm'],
    ['POST', '/api/unsubscribe'],
    ['DELETE', '/api/order'],
    ['PUT', '/api/subscribe'],
  ];
  for (const [method, path] of wrongMethod) {
    const res = await api(path, { method, ip: ip('hdr-methods') });
    check(`${method} ${path} is refused`, res.status, 405);
  }

  /* -------------------------------------------------------- unknown paths */

  for (const path of ['/api/nope', '/api/order/cancel', '/api/v1/orders', '/api/order/refund/extra']) {
    const res = await api(path, { method: 'POST', ip: ip('hdr-404'), json: {} });
    check(`POST ${path} is a 404`, res.status, 404);
  }

  // Worth stating out loud because the plan this suite was written against
  // referred to it as if it existed: cancellation is not its own endpoint. It
  // is /api/order/refund, which records "the customer wants out" for a human to
  // action, and never moves the order's status by itself.
  note('there is no /api/order/cancel — cancellation is a refund request');
}
