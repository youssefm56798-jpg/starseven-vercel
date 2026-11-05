'use client';
import { AdminText } from '../_lib/locale.js';


import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The tab strip.
 *
 * Each tab carries the permission its screen needs, and the layout passes down
 * the set the signed-in admin actually has. Hiding a tab is a courtesy and
 * never a control: every screen behind these links calls requirePermission()
 * for itself, and so does every Server Action on it. What this stops is a staff
 * member walking into a page full of buttons that all refuse — which is a worse
 * experience than not offering it, and teaches nobody anything.
 */
const TABS = [
  ['/admin', 'Dashboard', 'orders:read'],
  ['/admin/orders', 'Orders', 'orders:read'],
  ['/admin/subscribers', 'Subscribers', 'subscribers:read'],
  ['/admin/offers', 'Offers', 'offers:write'],
  ['/admin/products', 'Products', 'products:read'],
  ['/admin/accounts', 'Accounts', 'accounts:manage'],
  ['/admin/security', 'Security', null],
  ['/admin/reports', 'Reports', 'accounts:manage'],
  ['/admin/customers', 'Customers', 'orders:read'],
  ['/admin/returns', 'Returns', 'accounts:manage'],
  ['/admin/stock', 'Stock', 'accounts:manage'],
  ['/admin/shipping', 'Shipping', 'accounts:manage'],
  ['/admin/settlements', 'Settlements', 'accounts:manage'],
  ['/admin/audit', 'Audit history', 'accounts:manage'],
];

/** Client-side only because it needs the current pathname. */
export default function Tabs({ allowed = [] }) {
  const path = usePathname();
  const have = new Set(allowed);

  return (
    <>
      {TABS.filter(([, , need]) => need === null || have.has(need)).map(([href, label]) => {
        const on = href === '/admin' ? path === '/admin' : path.startsWith(href);
        return (
          <Link key={href} href={href} className={on ? 'on' : ''}>{<AdminText text={label} />}</Link>
        );
      })}
    </>
  );
}
