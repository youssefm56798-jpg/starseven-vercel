import { privateAnalyticsUrl, readConsent } from './consent.js';

/** Tracking failures must never interrupt a basket or a confirmed order. No PII. */
export function track(name, params = {}) {
  if (typeof window === 'undefined' || readConsent() !== 'accepted'
    || privateAnalyticsUrl(window.location.href)) return;
  try { window.gtag?.('event', name, params); } catch { /* Optional service. */ }
  try {
    if (process.env.NEXT_PUBLIC_CLARITY_ID && !window.clarity) {
      window.clarity = function () { (window.clarity.q ||= []).push(arguments); };
    }
    window.clarity?.('event', name);
  } catch { /* Optional service. */ }
}
