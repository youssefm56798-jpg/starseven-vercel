import { renderMarkdown } from '../../lib/markdown.js';
import { LEGAL } from './legalCopy.js';
import { Dir, Nav, Footer, Crumb } from './Chrome.js';

/** Shared renderer for /privacy and /terms. */
export default function LegalPage({ doc, lang }) {
  const ar = lang === 'ar';
  const page = LEGAL[doc][lang];

  return (
    <Dir lang={lang}>
      <Nav lang={lang} path={doc} />
      <div className="wrap">
        <article className="article legal">
          <div style={{ marginTop: '34px' }}>
            <Crumb lang={lang} trail={[{ label: page.title }]} />
          </div>
          <h1 className="phead" style={{ padding: 0, fontSize: 'clamp(28px,5vw,40px)' }}>
            {page.title}
          </h1>
          <div style={{ height: 18 }} />
          <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(page.body) }} />
        </article>
      </div>
      <Footer lang={lang} />
    </Dir>
  );
}

export function legalMetadata(doc, lang) {
  const page = LEGAL[doc][lang];
  return {
    title: page.title,
    description: page.title,
    alternates: { canonical: `/${doc}`, languages: { ar: `/${doc}`, en: `/${doc}?lang=en` } },
  };
}
