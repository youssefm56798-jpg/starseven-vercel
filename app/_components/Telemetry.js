'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { redactUrl, redactEvent } from '../../lib/analytics-url.js';

/**
 * Every script on this site that reports where a visitor is, in one place.
 *
 * It is one component rather than three tags in the layout because all three
 * have the same defect and it has to be fixed the same way in all three: each
 * reports a page view as a full `location.href`, and this site puts an order's
 * access token in the query string. lib/analytics-url.js is the whole argument;
 * this file is the three call sites.
 *
 * A client component, and it has to be. `beforeSend` is a function prop on a
 * client component, and a function cannot be handed from a Server Component to
 * a client one — the layout that used to render <Analytics /> directly is a
 * server component, so there was nowhere to put the redaction until this file
 * existed.
 */

/**
 * Google Analytics 4, and nothing at all when it is not configured.
 *
 * NEXT_PUBLIC_GA_ID gates it, and the same variable gates the Google hosts in
 * the CSP in next.config.mjs. That pairing is the point: with no ID there is no
 * script AND no allowance, so the policy never carries a hole for a third party
 * the site does not call. Set the variable in Vercel and redeploy — both halves
 * are read at build time.
 *
 * ---------------------------------------------------------------------------
 * send_page_view is false, and the page view is fired below instead
 *
 * The default configuration sends a page view from inside gtag.js, reading
 * `location.href` itself, and there is no hook to change what it reads. On an
 * order page that is the access token, posted to Google. The only way to
 * control the value is to turn the automatic one off and send the event from
 * code — which is what the effect below does, through redactUrl().
 *
 * That is the security reason and it is sufficient on its own. There is a
 * second benefit worth naming so nobody "simplifies" this back: the automatic
 * page view fires once, when gtag.js loads. This is an App Router site where
 * almost every navigation is client-side, so GA4 as it was configured would
 * have reported the landing page and then nothing for the rest of the visit.
 * The effect below fires on every route change, which is what a funnel needs.
 *
 * afterInteractive rather than beforeInteractive: nothing on the page waits on
 * analytics, and this is a storefront where the Largest Contentful Paint is a
 * product photograph.
 */
function GoogleAnalytics({ id }) {
  const pathname = usePathname();
  const search = useSearchParams();

  /*
   * The referrer belongs to the page that was left, not to the one being
   * entered, so it is only true for the FIRST view of a visit. Sending
   * document.referrer on every client-side navigation would report the site
   * that started the session as the source of every page in it.
   */
  const first = useRef(true);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;

    const params = { page_location: redactUrl(window.location.href) };
    if (first.current) {
      first.current = false;
      const ref = redactUrl(document.referrer);
      if (ref) params.page_referrer = ref;
    }

    window.gtag('event', 'page_view', params);
    // `search` is read so that /shop?sort=price is a different view from /shop.
    // It is in the dependency list rather than the body for that reason alone.
  }, [pathname, search]);

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}`
          + `gtag('js',new Date());`
          + `gtag('config',${JSON.stringify(id)},{send_page_view:false});`}
      </Script>
    </>
  );
}

/**
 * Vercel Web Analytics and Speed Insights.
 *
 * Both are on unconditionally — they need no key and no consent banner, and
 * Web Analytics is cookieless — so both have been reporting order URLs since
 * the day they were added. `beforeSend` is the documented hook for exactly
 * this, and redactEvent is shared between them because the two SDKs take the
 * identical `{ type, url }` shape.
 *
 * Returning the event rather than null keeps the page view: what is dropped is
 * the token, not the visit.
 */
export default function Telemetry() {
  const gaId = (process.env.NEXT_PUBLIC_GA_ID || '').trim();

  return (
    <>
      <Analytics beforeSend={redactEvent} />
      <SpeedInsights beforeSend={redactEvent} />
      {gaId ? <GoogleAnalytics id={gaId} /> : null}
    </>
  );
}
