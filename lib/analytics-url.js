/**
 * The URL a telemetry provider is allowed to be told about.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 *
 * A customer reaches their own order at
 *
 *     /order/S7-2708-12345?t=<32 random bytes, base64url>
 *
 * and that `t` is not a tracking parameter. It is the entire credential for
 * that order: it opens the name, the phone number, the delivery address, the
 * basket and the Cancel button, it never expires, and lib/order-access.js is
 * built around the promise that it lives in exactly one email and nowhere
 * else. See the header of that file.
 *
 * Three separate scripts on this site disagreed with that promise. Vercel Web
 * Analytics, Vercel Speed Insights and — the day NEXT_PUBLIC_GA_ID is set —
 * Google Analytics 4 each report a page view as a full `location.href`, query
 * string included. So every visit to an order page handed the token to a third
 * party, where it lands in a dashboard that more people can read than can read
 * the shop's inbox, and stays there. Vercel Analytics needed no configuration
 * to do it; it has been on since the component was added.
 *
 * The fix is one function and three callers, all in app/_components/Telemetry.js.
 * There is no second copy of this rule anywhere — in particular the GA4 init
 * script is deliberately configured with `send_page_view: false` so that the
 * page view is fired from JavaScript that can import this, rather than from an
 * inline string that would have to reimplement it.
 *
 * ---------------------------------------------------------------------------
 * Redacted, not stripped
 *
 * The parameter is kept and its value replaced. Dropping the key altogether
 * would make an order page look like a bare `/order/S7-2708-12345` in the
 * dashboard, which is indistinguishable from somebody arriving without a token
 * at all — and those two are worth telling apart when reading a funnel. What is
 * removed is the secret, not the fact that there was one.
 *
 * ---------------------------------------------------------------------------
 * Fail closed
 *
 * Anything that cannot be parsed is reported as `redacted` and nothing else. A
 * URL this function does not understand is a URL it cannot promise is clean,
 * and one page view lost from a chart is worth less than one token that should
 * not have left the browser. In practice the branch is unreachable: every input
 * is parsed against a base, so even a bare path resolves.
 */

/** What a secret's value is replaced with. */
export const REDACTED = 'redacted';

/**
 * Query parameters whose value is a credential.
 *
 * `t` is the whole list today and covers every one of them, because this app
 * spells every token the same way: the order link in lib/order-access.js, the
 * newsletter opt-in at /api/confirm and the unsubscribe link all use `?t=`.
 * That consistency is the reason one entry is enough, and the reason a fourth
 * kind of link must be spelled `t` as well rather than inventing its own name.
 */
export const SECRET_PARAMS = ['t'];

/**
 * Parameters that are not credentials but do name one customer's order.
 *
 * The order reference is not a key - it opens nothing without the token or the
 * email - so this is not a second leak, and it is redacted for the same two
 * reasons as the path: an order number belongs to a customer and has no
 * business in a third party's logs, and a chart of unique references is a
 * chart of nothing.
 *
 * `ref` reaches analytics from one place, /order/thanks?ref=..., which is the
 * page the checkout redirects to and therefore one of the most visited URLs on
 * the site.
 */
export const ID_PARAMS = ['ref'];

/**
 * Path segments that name one customer's order.
 *
 * The token is the credential and dropping it is most of the job, but the
 * reference left behind in /order/S7-2708-12345 is still a real customer's
 * order number sitting in a third party's logs, and it is the reference the
 * finder at /order/find asks for. It is not sufficient on its own - the finder
 * wants the email too - which is why this is tidiness about identifiers rather
 * than a second leak.
 *
 * It also makes the chart better. Twelve hundred distinct order URLs each seen
 * once say nothing; /order/redacted seen twelve hundred times is the number
 * anybody actually wanted.
 *
 * Anchored at the start, after an optional /en, so it matches the route and not
 * a product that happens to be called "order". /order/find and /order/thanks
 * are static siblings of the [ref] route rather than references, and are the
 * two page names on this path worth keeping in a chart.
 */
const ORDER_PATH = /^(\/en)?\/order\/(?!(?:find|thanks)(?:$|[/?]))[^/]+/;

/**
 * A base for parsing, so a relative URL is handled as readily as an absolute
 * one — the analytics SDKs are not consistent about which they hand over.
 * `.invalid` is reserved by RFC 2606 and can never be a real host, so a URL
 * resolving to this origin is always one that arrived without an origin.
 */
const RELATIVE_BASE = 'https://redacted.invalid';

/** The same URL with every credential in it replaced. */
export function redactUrl(raw) {
  try {
    // Inside the try, not above it. String() runs the argument's own toString,
    // which is arbitrary code — so the coercion is one of the things that can
    // throw, and a version of this that coerced first had a path out of the
    // function that skipped the redaction entirely. Nothing a browser hands
    // over gets near it; the point is that there is no input at all for which
    // this function returns something it has not inspected.
    const s = String(raw ?? '');

    // An empty referrer is not a URL and is not a leak. Passed through so a
    // caller can hand `document.referrer` straight in.
    if (!s) return s;

    const url = new URL(s, RELATIVE_BASE);

    let found = false;
    for (const key of [...SECRET_PARAMS, ...ID_PARAMS]) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, REDACTED);
        found = true;
      }
    }

    if (ORDER_PATH.test(url.pathname)) {
      url.pathname = url.pathname.replace(ORDER_PATH, (m, en) => `${en || ''}/order/${REDACTED}`);
      found = true;
    }

    // Nothing sensitive: return the caller's own string rather than a
    // normalised rebuild of it, so an ordinary page view is reported exactly as
    // the browser spelled it.
    if (!found) return s;

    return url.origin === RELATIVE_BASE
      ? `${url.pathname}${url.search}${url.hash}`
      : url.toString();
  } catch {
    return REDACTED;
  }
}

/**
 * A `beforeSend` for the Vercel SDKs, which both hand over `{ type, url }` and
 * both accept the event back with a different `url`. Written once here because
 * Web Analytics and Speed Insights take the identical shape.
 */
export const redactEvent = event =>
  (event && typeof event.url === 'string' ? { ...event, url: redactUrl(event.url) } : event);
