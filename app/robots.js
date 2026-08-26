import { site } from '../lib/config.js';

/** robots.txt — generated so the sitemap URL always matches the deployment. */
export default function robots() {
  return {
    rules: [{
      userAgent: '*',
      allow: '/',
      // '/en/checkout' is spelled out: English lives under a path prefix, so
      // disallowing '/checkout' alone leaves the English cart crawlable.
      disallow: ['/admin/', '/api/', '/checkout', '/en/checkout'],
    }],
    // Trailing slash tolerated on NEXT_PUBLIC_SITE_URL, so the sitemap URL
    // never comes out as "https://host//sitemap.xml".
    sitemap: `${site.url.replace(/\/$/, '')}/sitemap.xml`,
  };
}
