import { headers } from 'next/headers';
import { anton, cairo, tajawal } from '../lib/fonts.js';
import './globals.css';
import NotFoundView from './_views/not-found.js';

// Routing-level, unmatched URLs only. The normal root layout is bypassed.
// This experimental Next 15.4+ boundary is dynamic without making shop pages dynamic.
// It does not replace segment not-found boundaries for matched resource routes.
export default async function GlobalNotFound() {
  const lang = (await headers()).get('x-s7-lang') === 'en' ? 'en' : 'ar';
  return (
    <html lang={lang} className={`${anton.variable} ${cairo.variable} ${tajawal.variable}`}>
      <head>
        <title>{lang === 'en' ? 'Page not found — New Star Seven' : 'الصفحة مش موجودة — نيو ستار سفن'}</title>
        <meta name="robots" content="noindex" />
      </head>
      <body><NotFoundView lang={lang} /></body>
    </html>
  );
}
