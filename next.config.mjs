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
  // Product photographs uploaded from the admin panel live on Vercel Blob,
  // which serves them from one subdomain per store. Named as a wildcard
  // subdomain of that one host rather than pinned to this project's store:
  // the store id is only derivable by parsing an undocumented part of
  // BLOB_READ_WRITE_TOKEN, and a CSP that silently stops rendering the shop's
  // own product images the day Vercel changes that token format is a worse
  // failure than the one being avoided. What the wildcard admits is images -
  // not scripts, not frames, not styles - from a host Vercel controls, and it
  // only matters at all to somebody who can already inject HTML into these
  // pages. The rest of the policy is what stops that.
  "img-src 'self' data: https://*.public.blob.vercel-storage.com",
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
  experimental: {
    serverActions: {
      /*
       * A product photograph is posted to a Server Action, in the same form as
       * the twenty text fields beside it. The default ceiling on that body is
       * one megabyte, which a phone camera clears without trying, and the
       * refusal happens in the framework before any of our code runs - so the
       * owner gets a generic error rather than the sentence explaining that
       * three megabytes is the limit.
       *
       * Four here against a three-megabyte cap in lib/image-file.js, so the
       * message the owner reads is always ours. The extra megabyte is the text
       * fields and the multipart overhead travelling with the file.
       */
      bodySizeLimit: '4mb',
    },
  },
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
        /*
         * Powerful browser features this site does not use, switched off rather
         * than left available.
         *
         * A shop that takes cash at the door has no business asking for a
         * camera, a microphone, a location or a payment sheet, and none of the
         * code does. Declaring that is not protection against our own pages -
         * it is what stops an injected script, or anything that ever gets to
         * run in this origin, from reaching for a permission prompt the visitor
         * would reasonably associate with the shop. payment=() is the pointed
         * one: this site never takes card details, so a payment sheet appearing
         * on it is by definition not ours.
         */
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        },
        /*
         * Sever the link between this page and anything it opens, and anything
         * that opens it.
         *
         * The storefront links out to wa.me on almost every screen. Without
         * this, each of those tabs gets a live window.opener back into the page
         * that opened it, which is the tabnabbing shape: the opened page
         * rewrites the shop tab to a copy of itself while the customer is
         * looking at WhatsApp. Nothing here opens a popup it needs to talk to -
         * there is no OAuth flow and no payment window - so same-origin costs
         * nothing and closes that.
         */
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
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
    }, {
      /*
       * The two /api routes that are not JSON.
       *
       * /api/confirm and /api/unsubscribe are opened by a person, from a link in
       * an email, and answer with a branded HTML page (app/api/_lib/shared.js
       * brandPage). The rule above was written for JSON and says default-src
       * 'none', which is right for JSON and wrong for a document: it refused the
       * page's own inline <style> and its favicon, so every subscriber who
       * confirmed or unsubscribed got the unstyled fallback. Verified on
       * production before this rule existed - the response carried
       * `default-src 'none'` and a <style> block that the browser then dropped.
       *
       * So they get a policy shaped for what they are. It is still tighter than
       * the storefront's: no script-src at all, so default-src 'none' governs
       * script and NOTHING can execute on these pages - which is easy to promise
       * because they are static markup with no behaviour. style-src allows only
       * inline, not 'self', because the page carries no stylesheet file either.
       *
       * Must sit after the /api rule, for the same reason that one sits after
       * the catch-all: later matches replace earlier ones.
       */
      source: '/api/:path(confirm|unsubscribe)',
      headers: [
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'none'",
            "style-src 'unsafe-inline'",
            "img-src 'self' data:",
            "base-uri 'none'",
            "form-action 'none'",
            "frame-ancestors 'none'",
          ].join('; '),
        },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ],
    }];
  },
};
export default nextConfig;
