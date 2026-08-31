import { HAIR_TYPES } from './hairtypes.js';
import { normaliseLines, normaliseLongText } from './product-copy.js';
import { validateImageRef } from './product-image.js';

/**
 * Turning the product form into a row.
 *
 * Every column the storefront reads is editable from the admin now, which is
 * twenty-three fields arriving as strings from a browser. The parsing, the
 * clamping and the refusals live here rather than in the page for two reasons:
 * the create form and the edit form must not disagree about what a valid
 * product is, and none of this can be tested with a database in the room —
 * tests/ runs with no server, so the rules have to be reachable as a pure
 * function.
 *
 * ---------------------------------------------------------------------------
 * Clamping, and why it is not paranoia
 *
 * The columns are narrow in ways that a number typed into a form is not:
 *
 *   price, compare_at   NUMERIC(10,2). A number with more than eight digits in
 *                       front of the point is not a big price, it is error
 *                       22003 and a 500 on the screen the owner was using.
 *   hold_level          SMALLINT with a CHECK of 1 to 5.
 *   sort                SMALLINT. 40000 is a legal thing to type and an
 *                       out-of-range value to store.
 *   size_ml             INT.
 *
 * The old edit action clamped three of these and passed the rest through, so
 * `sort` = 99999 was a crash. Clamping every one of them is what makes the
 * form incapable of producing a statement Postgres will refuse — which matters
 * more than it sounds, because a refused statement in a Server Action is an
 * unhandled exception, and an unhandled exception is a screen with nothing on
 * it and twenty other fields of typing gone.
 *
 * ---------------------------------------------------------------------------
 * What is refused rather than clamped
 *
 * A missing name, an unknown kind, a malformed SKU or slug, a colour that is
 * not a colour and an image reference that is neither of the two legal shapes
 * are all errors, not values to be repaired. The difference is whether
 * guessing is honest: a price of 1e12 clearly means "the largest price", while
 * a colour of `red; background: url(x)` does not mean anything anybody typed
 * on purpose. products.color is interpolated into the `--c` custom property on
 * the storefront, so it is checked against six hex digits and nothing else.
 */

/**
 * The `kind` values the CHECK constraint allows.
 *
 * A copy of what is in db/schema.sql, and tests/product-form.test.mjs reads
 * both and asserts they are the same list — the same arrangement
 * tests/shop-pages.test.mjs already uses for the category pages. A select that
 * offers a value the constraint refuses is a 500 the owner triggers by picking
 * the wrong item from a menu we drew for them.
 */
export const KINDS = ['wax', 'gel', 'gelwax', 'cream', 'clay', 'pomade', 'spray', 'cologne', 'shampoo', 'depilatory'];

/** How the shop names each kind on the admin screen. English only, like the panel. */
export const KIND_LABELS = {
  wax: 'Wax',
  gel: 'Gel',
  gelwax: 'Gel wax',
  cream: 'Cream gel',
  clay: 'Clay wax',
  pomade: 'Pomade',
  spray: 'Hair spray',
  cologne: 'Cologne',
  shampoo: 'Shampoo',
  depilatory: 'Depilatory',
};

/** The most hair-type slots a product can be given. One per tile. */
export const HAIR_SLOTS = HAIR_TYPES.length;

const VALID_HAIR = new Set(HAIR_TYPES.map(t => t.slug));

/** NUMERIC(10,2) would take more; a price above this is a typing accident. */
export const MONEY_MAX = 1000000;

/** SMALLINT. */
const SORT_MIN = -32768;
const SORT_MAX = 32767;

const SKU_RE = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Reads a field whether it came from a FormData or from a plain object. */
const field = (form, name) => (typeof form?.get === 'function' ? form.get(name) : form?.[name]);

const clampInt = (v, lo, hi, fallback = 0) => {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

/** Money, to two places, never negative and never past the column. */
const clampMoney = v => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(Math.min(n, MONEY_MAX) * 100) / 100;
};

/** A checkbox is present or absent; anything else is a value we did not send. */
const checked = v => v === 'on' || v === 'true' || v === '1';

/**
 * The hair-type list, in the order the owner put it in.
 *
 * Order IS the meaning — the first slug is the primary recommendation and the
 * hair-type pages lead with it — so this keeps what it was given, minus the
 * blanks, the repeats and anything that is not one of the six tiles.
 */
export function cleanHairTypes(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const slug = String(raw ?? '').trim().toLowerCase();
    if (VALID_HAIR.has(slug) && !seen.has(slug)) {
      seen.add(slug);
      out.push(slug);
    }
  }
  return out;
}

/** The same, from the comma-separated shape the column stores. */
export const hairTypesFromCsv = csv => cleanHairTypes(String(csv ?? '').split(','));

/**
 * The hair types out of a form.
 *
 * The control is one select per priority slot, so the slot order is the
 * priority order and there is no free text to mistype. A form that carries no
 * slots at all falls back to the old comma-separated input, which keeps this
 * function usable from either shape and keeps the fallback honest rather than
 * silently returning nothing.
 */
export function hairTypesFromForm(form) {
  const slots = [];
  let sawSlot = false;
  for (let i = 1; i <= HAIR_SLOTS; i++) {
    const v = field(form, `hair_${i}`);
    if (v === null || v === undefined) continue;
    sawSlot = true;
    slots.push(v);
  }
  return sawSlot ? cleanHairTypes(slots) : hairTypesFromCsv(field(form, 'hair_types'));
}

/**
 * A slug from whatever the owner typed, or from the English name when they
 * typed nothing.
 *
 * Latin only, because this is a URL path segment that has to survive being
 * pasted into WhatsApp, printed on a flyer and typed back in by hand. The
 * Arabic name is not a candidate for the same reason: a percent-encoded
 * Arabic slug is forty characters of noise in a link. If the English name is
 * also non-Latin the result is empty, and an empty slug is refused rather than
 * invented.
 */
export function slugify(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

/** SKUs are shouted, hyphenated and Latin. Same reasoning as the slug. */
export function normaliseSku(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * The fields that exist on both forms.
 *
 * Returns { ok: true, values } or { ok: false, error }, where `error` is one
 * of the codes app/admin/_lib/ui.js knows how to render. Never throws.
 *
 * `mode` is 'create' or 'edit'. The only difference is sku and slug: they are
 * set once and never again, so the edit form does not send them and this does
 * not read them. That is not laziness — see lib/product-admin.js for why a
 * SKU that changes is a deploy that breaks and a slug that changes is a dead
 * link in somebody's WhatsApp thread.
 */
export function parseProductForm(form, { mode = 'edit' } = {}) {
  const nameAr = str(field(form, 'name_ar'), 120);
  const nameEn = str(field(form, 'name_en'), 120);
  if (!nameAr || !nameEn) return { ok: false, error: 'product_needs_name' };

  const kindRaw = String(field(form, 'kind') ?? '').trim();
  const kind = KINDS.includes(kindRaw) ? kindRaw : null;
  if (!kind) return { ok: false, error: 'product_bad_kind' };

  const colorRaw = String(field(form, 'color') ?? '').trim();
  if (!COLOR_RE.test(colorRaw)) return { ok: false, error: 'product_bad_colour' };

  const rawCompare = String(field(form, 'compare_at') ?? '').trim();
  const rawSize = String(field(form, 'size_ml') ?? '').trim();

  const values = {
    kind,
    name_ar: nameAr,
    name_en: nameEn,
    sub_ar: str(field(form, 'sub_ar'), 160),
    sub_en: str(field(form, 'sub_en'), 160),
    chip_ar: str(field(form, 'chip_ar'), 60),
    chip_en: str(field(form, 'chip_en'), 60),
    // Zero is a real, deliberate value: the storefront reads it as "ask us"
    // and shows a WhatsApp button instead of Add to cart. It is not a missing
    // price, so it is not an error.
    price: clampMoney(field(form, 'price')),
    compare_at: rawCompare === '' ? null : clampMoney(rawCompare),
    color: colorRaw.toUpperCase(),
    size_ml: rawSize === '' ? null : clampInt(rawSize, 1, 100000, 1),
    hold_level: clampInt(field(form, 'hold_level'), 1, 5, 3),
    hair_types: hairTypesFromForm(form).join(','),
    stock: clampInt(field(form, 'stock'), 0, 1000000, 0),
    active: checked(field(form, 'active')),
    featured: checked(field(form, 'featured')),
    sort: clampInt(field(form, 'sort'), SORT_MIN, SORT_MAX, 0),
    long_ar: normaliseLongText(field(form, 'long_ar')),
    long_en: normaliseLongText(field(form, 'long_en')),
    howto_ar: normaliseLines(field(form, 'howto_ar')),
    howto_en: normaliseLines(field(form, 'howto_en')),
    highlights_ar: normaliseLines(field(form, 'highlights_ar')),
    highlights_en: normaliseLines(field(form, 'highlights_en')),
    // One field rather than a bilingual pair, because INCI names are Latin and
    // read the same in both languages. Not run through normaliseLines: the
    // pack prints one run-on line and the page shows it verbatim.
    ingredients: String(field(form, 'ingredients') ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 2000),
  };

  // A was-price under the price is not a discount, it is a mistake that would
  // print a struck-through number smaller than the one beside it.
  if (values.compare_at !== null && values.compare_at <= values.price) values.compare_at = null;

  if (mode === 'create') {
    const sku = normaliseSku(field(form, 'sku'));
    if (!SKU_RE.test(sku)) return { ok: false, error: 'product_bad_sku' };

    const typed = String(field(form, 'slug') ?? '').trim();
    const slug = slugify(typed || nameEn);
    if (!SLUG_RE.test(slug) || slug.length < 2) return { ok: false, error: 'product_bad_slug' };

    values.sku = sku;
    values.slug = slug;
  }

  return { ok: true, values };
}

/**
 * The image reference for a save, given whatever the form carried and whatever
 * the upload produced.
 *
 * An upload wins when there is one; otherwise the typed path is used; and on
 * an edit with neither, the value already on the row stays. The result is
 * validated by lib/product-image.js in every branch — including the "already
 * on the row" one, which costs nothing and means a row that predates this
 * validation cannot re-save itself into a shape the storefront then renders.
 */
export function resolveImage({ uploadedUrl, typed, current }) {
  for (const candidate of [uploadedUrl, typed, current]) {
    if (candidate === null || candidate === undefined || String(candidate).trim() === '') continue;
    const ok = validateImageRef(candidate);
    if (ok) return ok;
    return null;
  }
  return null;
}
