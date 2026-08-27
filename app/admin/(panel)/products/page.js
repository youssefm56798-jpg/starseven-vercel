import { redirect } from 'next/navigation';
import { csrfOk, csrfToken } from '../../../../lib/auth.js';
import { sql } from '../../../../lib/db.js';
import { bySlug, HAIR_TYPES } from '../../../../lib/hairtypes.js';
import { normaliseLines, normaliseLongText } from '../../../../lib/product-copy.js';
import { requireAdmin } from '../../_lib/guard.js';
import { Flash, imgSrc } from '../../_lib/ui.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Products — Star Seven admin' };

const VALID = new Set(HAIR_TYPES.map(t => t.slug));

/** Splits the CSV, keeps the typed order, drops unknown slugs and repeats. */
function cleanHairTypes(raw) {
  const seen = new Set();
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const slug = part.trim().toLowerCase();
    if (VALID.has(slug) && !seen.has(slug)) {
      seen.add(slug);
      out.push(slug);
    }
  }
  return out;
}

async function saveProduct(formData) {
  'use server';
  await requireAdmin();

  if (!(await csrfOk(formData.get('_csrf')))) redirect('/admin/products?m=csrf');

  const id = Number(formData.get('id'));
  const act = String(formData.get('act') || 'save');
  if (!Number.isInteger(id) || id <= 0) redirect('/admin/products?m=bad_input');

  if (act === 'toggle') {
    await sql`UPDATE products SET active = NOT active WHERE id = ${id}`;
    redirect('/admin/products?m=product_toggled');
  }

  // The home page shows a shortlist, not the catalogue. This is what picks it.
  if (act === 'feature') {
    await sql`UPDATE products SET featured = NOT featured WHERE id = ${id}`;
    redirect('/admin/products?m=product_featured');
  }

  const price = Math.max(0, Number(formData.get('price')) || 0);
  const rawCompare = String(formData.get('compare_at') || '').trim();
  const compareAt = rawCompare === '' ? null : Math.max(0, Number(rawCompare) || 0);
  const stock = Math.max(0, Math.trunc(Number(formData.get('stock')) || 0));
  const hold = Math.max(1, Math.min(5, Math.trunc(Number(formData.get('hold_level')) || 3)));
  const sort = Math.trunc(Number(formData.get('sort')) || 0);

  // Order is the priority, so keep exactly what was typed minus the nonsense.
  const hair = cleanHairTypes(formData.get('hair_types')).join(',');

  // Product-page copy. The columns are NOT NULL DEFAULT '', so every field is
  // normalised to a string — an untouched textarea saves an empty string, never
  // null. See lib/product-copy.js for the trimming and the length caps.
  const longAr = normaliseLongText(formData.get('long_ar'));
  const longEn = normaliseLongText(formData.get('long_en'));
  const howtoAr = normaliseLines(formData.get('howto_ar'));
  const howtoEn = normaliseLines(formData.get('howto_en'));
  const highlightsAr = normaliseLines(formData.get('highlights_ar'));
  const highlightsEn = normaliseLines(formData.get('highlights_en'));

  await sql`
    UPDATE products
       SET price = ${price}, compare_at = ${compareAt}, stock = ${stock},
           hold_level = ${hold}, hair_types = ${hair}, sort = ${sort},
           long_ar = ${longAr}, long_en = ${longEn},
           howto_ar = ${howtoAr}, howto_en = ${howtoEn},
           highlights_ar = ${highlightsAr}, highlights_en = ${highlightsEn}
     WHERE id = ${id}`;

  redirect('/admin/products?m=product_saved');
}

export default async function ProductsPage({ searchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const token = await csrfToken();

  const products = await sql`SELECT * FROM products ORDER BY sort ASC, id ASC`;

  return (
    <>
      <h1>Products</h1>
      <p className="sub">
        Hair types drive the finder on the site. <b>Order matters</b> — the first hair type listed is
        the primary recommendation, the rest are backups. The reasoning behind the current mapping is
        in <code>/docs/hair-type-research.md</code>.
      </p>

      <Flash code={sp?.m} />

      {products.length === 0 ? (
        <div className="panel"><div className="empty">No products yet — run the database seed.</div></div>
      ) : products.map(p => {
        const picked = cleanHairTypes(p.hair_types);
        return (
          <div className="panel" key={p.id}>
            <h2>
              <span dir="rtl">{p.name_ar}</span>
              <span className="muted" style={{ fontWeight: 600 }}>· {p.name_en} · {p.sku}</span>
              <span className={p.active ? 'pill active' : 'pill cancelled'}>{p.active ? 'live' : 'hidden'}</span>
              {p.featured && <span className="pill active" title="Shown on the home page">home</span>}
              <span className="right">
                <form action={saveProduct}>
                  <input type="hidden" name="_csrf" value={token} />
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="act" value="toggle" />
                  <button className="btn sm ghost" type="submit">{p.active ? 'Hide' : 'Show'}</button>
                </form>
                <form action={save}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="act" value="feature" />
                  <button className="btn sm ghost" type="submit"
                          title="Show this product on the home page">
                    {p.featured ? 'Unfeature' : 'Feature'}
                  </button>
                </form>
              </span>
            </h2>

            <div className="pad">
              <form action={saveProduct}>
                <input type="hidden" name="_csrf" value={token} />
                <input type="hidden" name="id" value={p.id} />

                <div className="prod-grid">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imgSrc(p.image)} alt="" />
                  <div>
                    <div className="grid2">
                      <div className="field">
                        <label htmlFor={`price-${p.id}`}>Price (EGP)</label>
                        <input id={`price-${p.id}`} type="number" name="price" step="0.01" min="0"
                               defaultValue={String(p.price)} />
                      </div>
                      <div className="field">
                        <label htmlFor={`compare-${p.id}`}>Was-price (blank = none)</label>
                        <input id={`compare-${p.id}`} type="number" name="compare_at" step="0.01" min="0"
                               defaultValue={p.compare_at === null ? '' : String(p.compare_at)} />
                      </div>
                    </div>
                    <div className="grid2">
                      <div className="field">
                        <label htmlFor={`stock-${p.id}`}>Stock</label>
                        <input id={`stock-${p.id}`} type="number" name="stock" min="0" defaultValue={Number(p.stock)} />
                      </div>
                      <div className="field">
                        <label htmlFor={`hold-${p.id}`}>Hold level (1–5)</label>
                        <input id={`hold-${p.id}`} type="number" name="hold_level" min="1" max="5"
                               defaultValue={Number(p.hold_level)} />
                      </div>
                    </div>
                    <div className="field" style={{ maxWidth: '200px' }}>
                      <label htmlFor={`sort-${p.id}`}>Sort order</label>
                      <input id={`sort-${p.id}`} type="number" name="sort" defaultValue={Number(p.sort)} />
                    </div>

                    <div className="field">
                      <label htmlFor={`hair-${p.id}`}>Recommended for hair types — first = primary match</label>
                      <input id={`hair-${p.id}`} name="hair_types" defaultValue={p.hair_types || ''}
                             placeholder="wavy,thick" spellCheck={false} dir="ltr" />
                      <div className="muted" style={{ marginTop: '7px', fontSize: '12.5px' }}>
                        Comma separated, in priority order. Allowed:{' '}
                        {HAIR_TYPES.map((t, i) => (
                          <span key={t.slug}>
                            <code>{t.slug}</code> ({t.en.name}){i < HAIR_TYPES.length - 1 ? ' · ' : ''}
                          </span>
                        ))}
                      </div>
                      {picked.length > 0 && (
                        <div style={{ marginTop: '9px' }} className="bar-row">
                          {picked.map((slug, i) => (
                            <span className={i === 0 ? 'pill new' : 'pill'} key={slug}>
                              {i === 0 ? '1st · ' : ''}{bySlug(slug)?.en.name || slug}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <h3 style={{ fontSize: '14px', fontWeight: 900, margin: '22px 0 12px' }}>
                      Product page copy
                    </h3>

                    <div className="grid2">
                      <div className="field">
                        <label htmlFor={`long-ar-${p.id}`}>Full description (Arabic)</label>
                        <textarea id={`long-ar-${p.id}`} name="long_ar" rows={5} dir="rtl"
                                  defaultValue={p.long_ar || ''} />
                      </div>
                      <div className="field">
                        <label htmlFor={`long-en-${p.id}`}>Full description (English)</label>
                        <textarea id={`long-en-${p.id}`} name="long_en" rows={5}
                                  defaultValue={p.long_en || ''} />
                      </div>
                    </div>
                    <div className="muted" style={{ margin: '-8px 0 15px', fontSize: '12.5px' }}>
                      Leave a blank line between paragraphs. <code>**bold**</code>, <code>## heading</code>{' '}
                      and <code>- bullet</code> work. Up to 4000 characters each.
                    </div>

                    <div className="grid2">
                      <div className="field">
                        <label htmlFor={`howto-ar-${p.id}`}>How to use (Arabic)</label>
                        <textarea id={`howto-ar-${p.id}`} name="howto_ar" rows={3} dir="rtl"
                                  defaultValue={p.howto_ar || ''} />
                      </div>
                      <div className="field">
                        <label htmlFor={`howto-en-${p.id}`}>How to use (English)</label>
                        <textarea id={`howto-en-${p.id}`} name="howto_en" rows={3}
                                  defaultValue={p.howto_en || ''} />
                      </div>
                    </div>
                    <div className="muted" style={{ margin: '-8px 0 15px', fontSize: '12.5px' }}>
                      One step per line — the page numbers them, so do not type numbers or dashes.
                      Up to 1200 characters each.
                    </div>

                    <div className="grid2">
                      <div className="field">
                        <label htmlFor={`highlights-ar-${p.id}`}>Highlights (Arabic)</label>
                        <textarea id={`highlights-ar-${p.id}`} name="highlights_ar" rows={3} dir="rtl"
                                  defaultValue={p.highlights_ar || ''} />
                      </div>
                      <div className="field">
                        <label htmlFor={`highlights-en-${p.id}`}>Highlights (English)</label>
                        <textarea id={`highlights-en-${p.id}`} name="highlights_en" rows={3}
                                  defaultValue={p.highlights_en || ''} />
                      </div>
                    </div>
                    <div className="muted" style={{ margin: '-8px 0 18px', fontSize: '12.5px' }}>
                      One point per line — the page draws the tick, so do not type bullets.
                      Up to 1200 characters each.
                    </div>

                    <button className="btn" type="submit">Save</button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        );
      })}
    </>
  );
}
