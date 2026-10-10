export const CONSENT_KEY = 's7_analytics_consent';
export const CONSENT_VERSION = 1;
export const CONSENT_MS = 180 * 24 * 60 * 60 * 1000;

export function readConsent() {
  try {
    const choice = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
    return choice?.version === CONSENT_VERSION && choice.expires > Date.now()
      && ['accepted', 'rejected'].includes(choice.value) ? choice.value : null;
  } catch { return null; }
}

export function saveConsent(value) {
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({
      version: CONSENT_VERSION, value, expires: Date.now() + CONSENT_MS,
    }));
  } catch { /* Storage unavailable: this visit can still reject tracking. */ }
}

/** Keep credentials and the back office out of every optional tracker. */
export function privateAnalyticsUrl(raw) {
  try {
    const url = new URL(raw, 'https://newstarseven.com');
    return /^\/(?:en\/)?(?:admin|order)(?:\/|$)/.test(url.pathname)
      || url.searchParams.has('t') || url.searchParams.has('ref');
  } catch { return true; }
}

/** Remove only optional analytics cookies, including those from older deploys. */
export function clearAnalyticsCookies() {
  const host = window.location.hostname;
  const domains = ['', ...host.split('.').map((_, i) => host.split('.').slice(i).join('.'))];
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0].trim();
    if (!/^(_ga(?:_|$)|_gid$|_gat(?:_|$)|_clck$|_clsk$)/.test(name)) continue;
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; Path=/${domain ? `; Domain=${domain}` : ''}; SameSite=Lax`;
    }
  }
}
