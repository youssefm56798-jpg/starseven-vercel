'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { redactUrl, redactEvent } from '../../lib/analytics-url.js';
import { CONSENT_KEY, readConsent, saveConsent, clearAnalyticsCookies, privateAnalyticsUrl } from '../../lib/consent.js';

function GoogleAnalytics({ id }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const first = useRef(true);
  const report = () => {
    if (typeof window.gtag !== 'function') return;
    const params = { page_location: redactUrl(window.location.href) };
    if (first.current) {
      first.current = false;
      params.page_referrer = redactUrl(document.referrer);
    }
    try { window.gtag('event', 'page_view', params); } catch { /* Optional service. */ }
  };
  useEffect(() => { report(); }, [pathname, search]);
  return <>
    <Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`} strategy="afterInteractive" />
    <Script id="ga4-init" strategy="afterInteractive" onReady={report}>
      {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}`
        + `gtag('js',new Date());`
        + `gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});`
        + `gtag('config',${JSON.stringify(id)},{send_page_view:false});`}
    </Script>
  </>;
}

function Clarity({ id }) {
  return <Script id="clarity-init" strategy="afterInteractive">
    {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};`
      + `c[a]('consentv2',{analytics_Storage:'granted',ad_Storage:'denied'});`
      + `t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;`
      + `y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})`
      + `(window,document,"clarity","script",${JSON.stringify(id)});`}
  </Script>;
}

/** No optional analytics before consent, or anywhere in the back office/order tree. */
export default function Telemetry() {
  const pathname = usePathname();
  const search = useSearchParams();
  const ar = !/^\/en(?:\/|$)/.test(pathname || '');
  const [choice, setChoice] = useState(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const gaId = (process.env.NEXT_PUBLIC_GA_ID || '').trim();
  const clarityId = (process.env.NEXT_PUBLIC_CLARITY_ID || '').trim();
  const privatePage = privateAnalyticsUrl(`${pathname}?${search || ''}`);

  useEffect(() => {
    const saved = readConsent();
    setChoice(saved);
    const url = new URL(window.location.href);
    if (url.searchParams.has('privacy-settings')) {
      setOpen(true);
      url.searchParams.delete('privacy-settings');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
    setReady(true);
    if (saved !== 'accepted') clearAnalyticsCookies();
    const settings = e => {
      if (e.defaultPrevented || !e.target.closest?.('[data-cookie-settings]')) return;
      e.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => document.getElementById('cookie-reject')?.focus());
    };
    const changed = e => {
      if (e.key === CONSENT_KEY || e.key === null) window.location.reload();
    };
    document.addEventListener('click', settings, true);
    window.addEventListener('storage', changed);
    return () => {
      document.removeEventListener('click', settings, true);
      window.removeEventListener('storage', changed);
    };
  }, []);

  function decide(value) {
    saveConsent(value);
    if (value === 'rejected') clearAnalyticsCookies();
    // Removing a script tag cannot unload a recorder. A fresh document can.
    if (choice === 'accepted' && value !== 'accepted') {
      window.location.reload();
      return;
    }
    setChoice(value);
    setOpen(false);
    window.setTimeout(() => window.dispatchEvent(new Event('s7consent')), 0);
    if (open) document.querySelector('[data-cookie-settings]')?.focus();
  }

  if (!ready || privatePage) return null;
  return <>
    {choice === 'accepted' && <>
      <Analytics beforeSend={redactEvent} />
      <SpeedInsights beforeSend={redactEvent} />
      {gaId ? <GoogleAnalytics id={gaId} /> : null}
      {clarityId ? <Clarity id={clarityId} /> : null}
    </>}
    {(!choice || open) && <section className="cookie-banner" role="dialog" aria-labelledby="cookie-title"
      lang={ar ? 'ar' : 'en'} dir={ar ? 'rtl' : 'ltr'}>
      <div>
        <h2 id="cookie-title">{ar ? 'اختيارات الخصوصية' : 'Your privacy choices'}</h2>
        <p>{ar
          ? 'السلة والطلب بيشتغلوا من غير تحليلات. بموافقتك بس، بنستخدم تحليلات وMicrosoft Clarity لفهم استخدام الموقع وتسجيل تفاعلات التصفح بعد إخفاء بيانات النموذج. تقدر ترفض أو تغيّر اختيارك من «إعدادات الخصوصية» في أي وقت.'
          : 'Your cart and checkout work without analytics. Only with your permission, we use analytics and Microsoft Clarity to understand browsing and record interactions with form details masked. Reject or change your choice anytime through Privacy settings.'}</p>
        <a href={ar ? '/privacy' : '/en/privacy'} data-no-transition="">{ar ? 'سياسة الخصوصية والكوكيز' : 'Privacy and cookies policy'}</a>
      </div>
      <div className="cookie-actions">
        <button id="cookie-reject" type="button" className="btn btn-line" onClick={() => decide('rejected')}>
          {ar ? 'رفض التحليلات' : 'Reject analytics'}</button>
        <button type="button" className="btn btn-line" onClick={() => decide('accepted')}>
          {ar ? 'قبول التحليلات' : 'Accept analytics'}</button>
        {open && choice && <button type="button" className="cookie-close" onClick={() => {
          setOpen(false); document.querySelector('[data-cookie-settings]')?.focus();
        }}>{ar ? 'رجوع' : 'Back'}</button>}
      </div>
    </section>}
  </>;
}
