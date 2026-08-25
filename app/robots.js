import { site } from '../lib/config.js';

/** robots.txt — generated so the sitemap URL always matches the deployment. */
export default function robots() {
  return {
    rules: [{
      userAgent: '*',
      allow: '/',
      disallow: ['/admin/', '/api/', '/checkout'],
    }],
    // Trailing slash tolerated on NEXT_PUBLIC_SITE_URL, so the sitemap URL
    // never comes out as "https://host//sitemap.xml".
    sitemap: `${site.url.replace(/\/$/, '')}/sitemap.xml`,
  };
}
