/** @type {import('next').NextConfig} */

// Content-Security-Policy for the HTML responses.
//
// script-src has to allow 'unsafe-inline'. A statically prerendered Next app
// hydrates from inline bootstrap scripts, and the pages also carry inline
// application/ld+json - the honest, nonce-based alternative means reading a
// per-request nonce, which is a dynamic API and would opt every page back out
// of static rendering, undoing the whole reason this site was migrated. So the
// trade is deliberate: scripts stay inline-permitted, and everything else is
// closed. That still buys real ground - no third-party script host can load, no
// one can frame the site or inject a <base>, forms cannot post off-origin, and
// there is a backstop under any future HTML-injection slip (the markdown that
// LegalPage renders is app-authored today, but this is what guards it if that
// ever changes).
//
// style-src allows 'unsafe-inline' because Next injects inline styles; fonts and
// assets are all self-hosted so 'self' and data: cover them. connect-src is
// 'self' - the storefront calls only its own /api. schema.org and wa.me are
// href targets, not resource loads, so they need no allowance here.
const csp = [
  "default-src 'self'",
  // 'unsafe-eval' only in development: Next's dev server hydrates HMR and React
  // Fast Refresh through eval, and a production build does not - so the deployed
  // policy never carries it. Guarding on NODE_ENV keeps the shipped CSP tight
  // while letting the dev server run.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    // Applied at the edge to every response. frame-ancestors 'self' is kept in
    // step with X-Frame-Options SAMEORIGIN on purpose - the two say the same
    // thing to old and new browsers, and disagreeing is how one silently wins.
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: csp },
        // HTTPS-only, for two years, subdomains included. Vercel already sends
        // this on its own *.vercel.app domains; declaring it here means the apex
        // custom domain (ovanzacosmetics.com) is covered the day it is pointed
        // at this app, rather than being remembered separately at cutover. No
        // preload directive - that is a listing commitment for the owner to
        // make deliberately, not a default to ship.
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }, {
      /*
       * The JSON endpoints get their own, tighter policy.
       *
       * lib/http.js already attaches `default-src 'none'; frame-ancestors
       * 'none'` to every API response, and until now that header never reached
       * a client. The rule above matches `/:path*`, which matches `/api/...`
       * too, and a header declared in this config REPLACES one set by the
       * route rather than deferring to it — so every JSON response shipped the
       * page policy, which permits inline script and allows framing from the
       * same origin. The comment in lib/http.js and the bytes on the wire have
       * been disagreeing since the day it was written.
       *
       * Later rules win, so this one has to sit after the catch-all. Nothing in
       * an API response is a document: no scripts, no styles, no fonts, and
       * nothing that should ever be put in a frame, so the policy says exactly
       * that. The rest of the security headers are repeated because replacing
       * is replacing — omitting them here would strip nosniff and HSTS from
       * /api, which is worse than the problem being fixed.
       */
      source: '/api/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ],
    }];
  },
};
export default nextConfig;
