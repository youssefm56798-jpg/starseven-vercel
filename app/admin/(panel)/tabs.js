'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  ['/admin', 'Dashboard'],
  ['/admin/orders', 'Orders'],
  ['/admin/subscribers', 'Subscribers'],
  ['/admin/offers', 'Offers'],
  ['/admin/products', 'Products'],
  ['/admin/security', 'Security'],
];

/** The tab strip. Client-side only because it needs the current pathname. */
export default function Tabs() {
  const path = usePathname();
  return (
    <>
      {TABS.map(([href, label]) => {
        const on = href === '/admin' ? path === '/admin' : path.startsWith(href);
        return (
          <Link key={href} href={href} className={on ? 'on' : ''}>{label}</Link>
        );
      })}
    </>
  );
}
