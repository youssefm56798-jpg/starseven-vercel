import { renderMarkdown } from '../../lib/markdown.js';
import { alternatesForLang } from '../../lib/urls.js';
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
            <Crumb lang={lang} schema trail={[{ label: page.title }]} />
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

/**
 * The search-result blurb for each legal page.
 *
 * These used to be `description: page.title`, which meant the four legal pages
 * shipped a fourteen-character meta description - "Privacy Policy" describing
 * the page titled "Privacy Policy". Google discards a description that short and
 * writes its own from the body, and the body of a privacy policy makes a poor
 * snippet. Written out here rather than derived, because a description is copy
 * and there is nothing in the document to derive it from.
 *
 * Each is 145-160 characters, and says what the reader actually wants to know
 * before clicking: what is collected, why, and what they can ask for.
 */
const LEGAL_BLURB = {
  privacy: {
    ar: 'سياسة الخصوصية لنيو ستار سفن: إيه البيانات اللي بناخدها وقت الأوردر، ليه بناخدها، مين بيشوفها، وقد إيه بنحتفظ بيها — وإزاي تطلب نسخة منها أو تمسحها.',
    en: 'How New Star Seven handles your data: what we collect at checkout, why we need it, who processes it, how long we keep it, and how to request a copy or deletion.',
  },
  terms: {
    ar: 'شروط وأحكام الشراء من نيو ستار سفن: الدفع عند الاستلام، مواعيد وتكلفة التوصيل، الأسعار، وسياسة الإرجاع والاستبدال لو المنتج وصلك غلط أو تالف.',
    en: 'Terms for buying from New Star Seven: cash on delivery, delivery times and cost, pricing, and the returns policy if an order arrives wrong, damaged or incomplete.',
  },
};

export function legalMetadata(doc, lang) {
  const page = LEGAL[doc][lang];
  return {
    title: page.title,
    description: LEGAL_BLURB[doc][lang],
    alternates: alternatesForLang(`/${doc}`, lang),
  };
}
