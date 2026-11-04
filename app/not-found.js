'use client';

import { usePathname } from 'next/navigation';
import NotFoundView from './_views/not-found.js';

// Matched Arabic/resource fallback. Explicit app/en/not-found.js selects English
// for matched English resources; global-not-found.js handles unmatched URLs
// server-side. Keep pathname selection here for client route transitions.
export default function NotFound() {
  const path = usePathname() || '';
  const en = path === '/en' || path.startsWith('/en/');
  return <NotFoundView lang={en ? 'en' : 'ar'} />;
}
