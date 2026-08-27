import { site } from '../lib/config.js';

/** robots.txt — generated so the sitemap URL always matches the deployment. */
export default function robots() {
  return {
    rules: [{
      userAgent: '*',
      allow: '/',
      // '/en/checkout' is spelled out: English lives under a path prefix, so
      // disallowing '/checkout' alone leaves the English cart crawlable.
      // '/order' is a customer looking at their own order through a token in
      // an email. Nothing there is public and nothing there is rankable.
      disallow: ['/admin/', '/api/', '/checkout', '/en/checkout',
                 '/order', '/en/order'],
    }],
    // Trailing slash tolerated on NEXT_PUBLIC_SITE_URL, so the sitemap URL
    // never comes out as "https://host//sitemap.xml".
    sitemap: `${site.url.replace(/\/$/, '')}/sitemap.xml`,
  };
}
