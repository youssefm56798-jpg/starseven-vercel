import Link from 'next/link';
import { localePath } from '../../lib/urls.js';
import './not-found.css';

/** Original N7 pixel 404. Presentation only: no database or auth dependencies. */
export default function NotFoundView({ lang = 'ar' }) {
  const ar = lang !== 'en';
  const L = path => localePath(path, ar ? 'ar' : 'en');
  return (
    <div className="s7-notfound" lang={ar ? 'ar' : 'en'} dir={ar ? 'rtl' : 'ltr'}>
      <header className="nf-header">
        <Link className="nf-brand" href={L('/')} aria-label={ar ? 'نيو ستار سفن، الرئيسية' : 'New Star Seven, home'}>
          <img className="nf-logo" src="/assets/logo-s7.png" alt="New Star Seven" width="140" height="34" />
          <span className="nf-header-note" aria-hidden="true">HOLD<br />YOUR STYLE.</span>
        </Link>
        <div className="nf-lang"><span>{ar ? 'AR' : 'EN'}</span>
          <Link href={ar ? '/en/404' : '/404'} lang={ar ? 'en' : 'ar'} aria-label={ar ? 'View this page in English' : 'اعرض الصفحة بالعربية'}>{ar ? 'English' : 'العربية'}</Link>
        </div>
      </header>
      <main className="nf-main" id="content">
        <p className="nf-kicker">{ar ? '404 / الصفحة مش موجودة' : 'ERROR 404 / PAGE NOT FOUND'}</p>
        <svg className="nf-art" viewBox="0 0 720 264" fill="none" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
<g fill="currentColor" shapeRendering="crispEdges">
  <path d="M112 18h48v144h26v40h-26v44h-45v-44H14v-59h20v-25h20V93h20V68h19V43h19V18Zm3 62H98v24H80v24H61v34h54V80Z"/>
  <path d="M642 18h48v144h26v40h-26v44h-45v-44H544v-59h20v-25h20V93h20V68h19V43h19V18Zm3 62h-17v24h-18v24h-19v34h54V80Z"/>
</g>
<g className="nf-file" shapeRendering="crispEdges">
  <path d="M290 34h112v16h16v16h16v16h16v154H290V34Z" fill="#e8362a"/>
  <path d="M276 20h112v16h16v16h16v16h16v154H276V20Z" fill="#12100b"/>
  <path d="M388 20v48h48v-16h-16V36h-16V20h-16Z" fill="#e8362a"/>
  <path d="M388 20v48h48" stroke="#fffdf8" strokeWidth="8"/>
  <path d="M297 91h27v7h-27zm83 0h27v7h-27z" fill="#fffdf8"/>
  <path d="M305 110h17v23h-17z" fill="#fffdf8"/>
  <path d="M389 105h8v9h9v8h-9v9h-8v-9h-9v-8h9z" fill="#e8362a"/>
  <path d="M324 161h20v-8h26v8h20v8h-20v-8h-26v8h-20z" fill="#fffdf8"/>
  <path d="M267 138h-18v8h-18v8h-12v9h30v-9h18zm178 0h18v8h18v8h12v9h-30v-9h-18z" fill="#12100b"/>
  <path d="M302 201h54v4h-54zm63 0h16v4h-16zm24 0h18v4h-18z" fill="#fffdf8" opacity=".22"/>
  <path d="M293 236h40v10h-40zm89 0h40v10h-40z" fill="#12100b"/>
</g>
<g className="nf-spark" fill="#e8362a" shapeRendering="crispEdges">
  <path d="M491 15h9v14h14v9h-14v14h-9V38h-14v-9h14z"/>
  <path d="M219 48h7v7h7v7h-7v7h-7v-7h-7v-7h7z" opacity=".7"/>
</g>
<g className="nf-pixels" fill="#12100b" opacity=".3" shapeRendering="crispEdges">
  <path d="M208 218h9v9h-9zm-10 22h5v5h-5zm309-47h7v7h-7zm13 20h10v10h-10z"/>
</g>
</svg>
        <h1 className="nf-title"><span className="nf-sr">{ar ? 'خطأ 404. ' : 'Error 404. '}</span>{ar ? 'الصفحة مش هنا. ستايلك لسه هنا.' : 'Wrong page. Still your style.'}</h1>
        <p className="nf-copy">{ar ? 'يمكن اللينك قديم أو الصفحة اتنقلت. نرجّعك للحاجات اللي بتدور عليها.' : 'This link may have moved or never existed. Let’s get you back to the good stuff.'}</p>
        <nav className="nf-actions" aria-label={ar ? 'ارجع للموقع' : 'Return to the website'}>
          <Link className="nf-button nf-button-primary" href={L('/shop')}>{ar ? 'شوف كل المنتجات' : 'Shop the range'}<svg className="nf-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13 3h3v3h3v3h3v6h-3v3h-3v3h-3v-6H2V9h11V3Z"/></svg></Link>
          <Link className="nf-button" href={L('/')}>{ar ? 'ارجع للرئيسية' : 'Back to home'}</Link>
        </nav>
      </main>
      <footer className="nf-footer"><p>{ar ? 'نيو ستار سفن. امسك ستايلك.' : 'New Star Seven. Hold your style.'}</p><span className="nf-footer-mark" aria-hidden="true">N7 / 404</span></footer>
    </div>
  );
}
