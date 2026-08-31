/**
 * When the parcel arrives, and how the shop is allowed to say so.
 *
 * The order page used to show a four-step tracker with no dates on it at all,
 * which answers "where is my order" and not "when is it coming" — and the
 * second question is the one that ends up on WhatsApp. So an order that has
 * been confirmed by phone carries a window, written once at that moment and
 * never moved afterwards.
 *
 * Everything here is a pure function. No database, no request, no clock it did
 * not take as an argument, so tests/delivery-eta.test.mjs can exercise the SLA
 * table, the working-day arithmetic and both languages of the sentence without
 * a server — which matters because everything under tests/ runs with no
 * database on purpose.
 *
 * ---------------------------------------------------------------------------
 * Why the window is stored rather than computed on every render
 *
 * The obvious cheaper thing is to derive the dates from created_at each time
 * the page is drawn. It is wrong for one reason: the window would then move. A
 * customer told "Tue 2 – Thu 4" on Monday would be told "Wed 3 – Fri 5" on
 * Tuesday, and a promise that slides forward by a day every day is worse than
 * no promise at all. So it is written into orders.expected_from / expected_to
 * inside the same transaction that moves the order to confirmed, and it is a
 * fact about the order rather than a function of when somebody looked at it.
 */

/* --------------------------------------------------------------- the SLA */

/**
 * Working days from confirmation to the door, per zone, as [earliest, latest].
 *
 * The numbers are the published domestic tiers of the Egyptian
 * cash-on-delivery couriers a shop this size actually hands parcels to —
 * Bosta, Mylerz and Aramex domestic all sell the same four-tier shape: next
 * day inside Cairo and Giza, two to three days across the Delta and the canal
 * cities, three to five up the valley, and the best part of a week out to the
 * frontier governorates. Where two of them disagreed by a day the later number
 * is taken, because the cost of the two mistakes is not symmetric: a parcel
 * that beats its window is a good day, and one that misses it is a phone call.
 *
 * `unknown` is not a zone anyone ships to. It is what an unrecognised city
 * gets — see zoneFor — and it is deliberately the widest span in the table: it
 * opens at the Delta tier and closes at the Upper Egypt one, so it is a true
 * statement for every governorate outside the frontier five. Showing nothing
 * at all was the alternative, and the customer who typed their village rather
 * than their governorate is exactly the one who most wants a date.
 */
export const SLA = {
  metro: [1, 2],
  delta: [2, 3],
  upper: [3, 5],
  frontier: [5, 7],
  unknown: [2, 5],
};

/**
 * Every governorate, in both languages, and the zone it bills as.
 *
 * Written here in ordinary spelling and folded through normalise() at module
 * load, so a key and a customer typing the same place cannot be spelled
 * differently by accident. That is the whole reason the lookup can be a flat
 * object instead of a list of regular expressions nobody can read.
 *
 * Qalyubia is the one judgement call in the table. Shubra El Kheima is
 * physically continuous with Cairo and a courier will often deliver it next
 * day, but none of them price it as Cairo, so it takes the Delta tier rather
 * than the metro one. Promising a tier the shop is not paying for is how a
 * window stops being kept.
 */
const GOVERNORATE = {
  // Metro — Cairo and Giza, the two the couriers quote next day.
  'القاهرة': 'metro', 'Cairo': 'metro',
  'الجيزة': 'metro', 'Giza': 'metro',

  // The Delta, Alexandria and the canal cities.
  'الإسكندرية': 'delta', 'Alexandria': 'delta', 'Alex': 'delta',
  'البحيرة': 'delta', 'Beheira': 'delta', 'Behera': 'delta',
  'كفر الشيخ': 'delta', 'Kafr El Sheikh': 'delta', 'Kafr Elsheikh': 'delta',
  'الغربية': 'delta', 'Gharbia': 'delta', 'Gharbiya': 'delta',
  'المنوفية': 'delta', 'Menoufia': 'delta', 'Monufia': 'delta',
  'الدقهلية': 'delta', 'Dakahlia': 'delta', 'Daqahlia': 'delta',
  'دمياط': 'delta', 'Damietta': 'delta', 'Dumyat': 'delta',
  'الشرقية': 'delta', 'Sharqia': 'delta', 'Sharkia': 'delta',
  'القليوبية': 'delta', 'Qalyubia': 'delta', 'Kalyoubia': 'delta',
  'بورسعيد': 'delta', 'بور سعيد': 'delta', 'Port Said': 'delta', 'Portsaid': 'delta',
  'الإسماعيلية': 'delta', 'Ismailia': 'delta',
  'السويس': 'delta', 'Suez': 'delta',

  // Up the valley.
  'الفيوم': 'upper', 'Fayoum': 'upper', 'Faiyum': 'upper',
  'بني سويف': 'upper', 'Beni Suef': 'upper', 'Bani Sweif': 'upper',
  'المنيا': 'upper', 'Minya': 'upper', 'Menia': 'upper',
  'أسيوط': 'upper', 'Assiut': 'upper', 'Asyut': 'upper',
  'سوهاج': 'upper', 'Sohag': 'upper', 'Suhag': 'upper',
  'قنا': 'upper', 'Qena': 'upper', 'Kena': 'upper',
  'الأقصر': 'upper', 'Luxor': 'upper',
  'أسوان': 'upper', 'Aswan': 'upper',

  // The frontier governorates. Long roads, few runs a week.
  'البحر الأحمر': 'frontier', 'Red Sea': 'frontier',
  'الوادي الجديد': 'frontier', 'New Valley': 'frontier',
  'مطروح': 'frontier', 'Matrouh': 'frontier', 'مرسى مطروح': 'frontier', 'Marsa Matrouh': 'frontier',
  'شمال سيناء': 'frontier', 'North Sinai': 'frontier',
  'جنوب سيناء': 'frontier', 'South Sinai': 'frontier',
};

/**
 * The names customers actually type instead of their governorate.
 *
 * orders.city is a free-text box labelled "المحافظة / المدينة" and people fill
 * it in with where they live, not with an administrative division. "المعادي"
 * and "مدينة نصر" are Cairo, "٦ أكتوبر" and "الشيخ زايد" are Giza, and every
 * one of them would otherwise fall through to the unknown window and be quoted
 * two to five days for a next-day delivery. This list is the head of that
 * tail; it is not meant to be exhaustive, because the fallback is already
 * safe — it is meant to stop the shop under-selling the delivery it is buying
 * on the orders it gets most of.
 */
const NEIGHBOURHOOD = {
  'المعادي': 'metro', 'Maadi': 'metro',
  'مدينة نصر': 'metro', 'Nasr City': 'metro',
  'مصر الجديدة': 'metro', 'Heliopolis': 'metro',
  'القاهرة الجديدة': 'metro', 'New Cairo': 'metro',
  'التجمع الخامس': 'metro', 'Fifth Settlement': 'metro',
  'شبرا': 'metro', 'Shubra': 'metro',
  'حلوان': 'metro', 'Helwan': 'metro',
  'الزمالك': 'metro', 'Zamalek': 'metro',
  'أكتوبر': 'metro', '6 أكتوبر': 'metro', 'October': 'metro', '6 October': 'metro',
  'الشيخ زايد': 'metro', 'Sheikh Zayed': 'metro', 'Zayed': 'metro',
  'الهرم': 'metro', 'Haram': 'metro', 'Pyramids': 'metro',
  'الدقي': 'metro', 'Dokki': 'metro',
  'المهندسين': 'metro', 'Mohandessin': 'metro',
  'فيصل': 'metro', 'Faisal': 'metro',
  'إمبابة': 'metro', 'Imbaba': 'metro',
  'طنطا': 'delta', 'Tanta': 'delta',
  'المنصورة': 'delta', 'Mansoura': 'delta',
  'الزقازيق': 'delta', 'Zagazig': 'delta',
  'بنها': 'delta', 'Banha': 'delta', 'Benha': 'delta',
  'دمنهور': 'delta', 'Damanhour': 'delta',
  'الغردقة': 'frontier', 'Hurghada': 'frontier',
  'شرم الشيخ': 'frontier', 'Sharm El Sheikh': 'frontier', 'Sharm': 'frontier',
  'دهب': 'frontier', 'Dahab': 'frontier',
  'العريش': 'frontier', 'Arish': 'frontier',
};

/* ------------------------------------------------------- reading the city */

const DIACRITICS = /[ً-ٰٟـ]/g;
const ARABIC_INDIC = /[٠-٩]/g;
const ARABIC_BLOCK = 'a-z0-9\\u0600-\\u06FF';

/**
 * One spelling for every way a place can be written.
 *
 * Arabic is typed a dozen ways for the same word and none of them is a
 * mistake: the hamza is optional in practice (إسكندرية / اسكندرية), the taa
 * marbuta is routinely written as a haa (الجيزه), the alef maqsura and the yaa
 * are the same key to most people, and a phone keyboard adds diacritics nobody
 * meant to type. Folding all of it away first is what lets the alias tables
 * above stay readable.
 *
 * The definite article comes off every token rather than only off the front of
 * the string, because "محافظة القاهرة" and "القاهرة" have to land on the same
 * key. It is only taken from a token long enough to still be a word without
 * it, so a genuine short name is left alone.
 *
 * There is no noise-word list. Extra words are harmless: zoneFor matches whole
 * tokens inside the string, so "محافظة الجيزة - الهرم" finds الجيزة without
 * anything having to be removed first. A list of words to drop would only add
 * a way to delete half of a real name — "مدينة نصر" is Nasr City, and a rule
 * that strips "مدينة" turns it into somewhere else.
 */
export function normalise(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(DIACRITICS, '')
    .replace(ARABIC_INDIC, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[آأإٱ]/g, 'ا') // آ أ إ ٱ -> ا
    .replace(/ة/g, 'ه')                     // ة -> ه
    .replace(/ى/g, 'ي')                     // ى -> ي
    .replace(/ؤ/g, 'و')                     // ؤ -> و
    .replace(/ئ/g, 'ي')                     // ئ -> ي
    .replace(new RegExp(`[^${ARABIC_BLOCK}]+`, 'g'), ' ')
    .trim()
    .split(/\s+/)
    .map(t => (t.length > 4 && t.startsWith('ال') ? t.slice(2) : t))
    .filter(Boolean)
    .join(' ');
}

/** Both tables, folded, longest key first so the scan can stop being greedy. */
const ALIASES = Object.entries({ ...GOVERNORATE, ...NEIGHBOURHOOD })
  .map(([name, zone]) => [normalise(name), zone])
  .sort((a, b) => b[0].length - a[0].length);

/**
 * The zone a free-text city belongs to, or 'unknown'.
 *
 * Matched on whole tokens, longest alias first. The token test is what stops
 * "قنا" matching inside "القناطر", and longest-first is what stops "شرم الشيخ"
 * being decided by the "الشيخ" in "الشيخ زايد" — both of which a plain
 * substring search gets wrong, silently, and in the direction of a promise the
 * shop cannot keep.
 */
export function zoneFor(city) {
  const clean = normalise(city);
  if (!clean) return 'unknown';

  const hay = ` ${clean} `;
  for (const [alias, zone] of ALIASES) {
    if (hay.includes(` ${alias} `)) return zone;
  }
  return 'unknown';
}

/* --------------------------------------------------- where we deliver --- */

/**
 * The governorates the shop actually delivers to.
 *
 * The table above knows every governorate in Egypt because it exists to quote
 * a delivery window, and quoting one for Aswan is harmless. Taking an order
 * for Aswan is not: there is no courier contract for it, so the order would be
 * accepted, charged and then walked back by hand.
 *
 * Cairo and Giza are the metro pair. Qalyubia is here because Shubra El Kheima
 * is continuous with Cairo and the shop is in Belbeis - it still bills as the
 * Delta tier for the window, which is why this list is separate from the zone
 * table rather than derived from it.
 */
export const SERVED = ['cairo', 'giza', 'qalyubia'];

/** What each one is called on the checkout picker. */
export const SERVED_LABELS = {
  cairo: { ar: 'القاهرة', en: 'Cairo' },
  giza: { ar: 'الجيزة', en: 'Giza' },
  qalyubia: { ar: 'القليوبية', en: 'Qalyubia' },
};

/**
 * Alias -> governorate, for the three we serve.
 *
 * The neighbourhood names are the point. Somebody typing "المعادي" or "الشيخ
 * زايد" has given a served address and must not be refused for not writing the
 * administrative division - that is the same tail zoneFor() already handles,
 * and refusing it would be worse than mis-quoting a window because it loses
 * the order outright.
 *
 * Shubra is the trap. "شبرا" is Cairo and "شبرا الخيمة" is Qalyubia, so both
 * are listed and the scan below takes the longest match first. Both are
 * served, so getting it wrong costs a delivery window rather than an order -
 * but it is one line to be right about.
 */
const SERVED_ALIASES = Object.entries({
  cairo: [
    'القاهرة', 'Cairo', 'مصر', 'المعادي', 'Maadi', 'مدينة نصر', 'Nasr City',
    'مصر الجديدة', 'Heliopolis', 'القاهرة الجديدة', 'New Cairo',
    'التجمع الخامس', 'Fifth Settlement', 'شبرا', 'Shubra', 'حلوان', 'Helwan',
    'الزمالك', 'Zamalek', 'وسط البلد', 'Downtown', 'العباسية', 'Abbasia',
  ],
  giza: [
    'الجيزة', 'Giza', 'أكتوبر', '6 أكتوبر', 'October', '6 October',
    'الشيخ زايد', 'Sheikh Zayed', 'Zayed', 'الهرم', 'Haram', 'Pyramids',
    'الدقي', 'Dokki', 'المهندسين', 'Mohandessin', 'فيصل', 'Faisal',
    'إمبابة', 'Imbaba', 'العجوزة', 'Agouza', 'البدرشين', 'Badrashin',
  ],
  qalyubia: [
    'القليوبية', 'Qalyubia', 'Kalyoubia', 'Qaliobia',
    'شبرا الخيمة', 'Shubra El Kheima', 'Shobra El Kheima',
    'بنها', 'Banha', 'Benha', 'قليوب', 'Qalyub', 'الخانكة', 'Khanka',
    'العبور', 'Obour', 'الخصوص', 'Khosous',
  ],
}).flatMap(([gov, names]) => names.map(n => [normalise(n), gov]))
  .sort((a, b) => b[0].length - a[0].length);

/**
 * The served governorate a free-text address belongs to, or null.
 *
 * Same whole-token, longest-alias-first scan zoneFor() uses, and for the same
 * reasons: a substring search matches "قنا" inside "القناطر" and decides
 * "شرم الشيخ" from the "الشيخ" in "الشيخ زايد".
 */
export function governorateFor(city) {
  const clean = normalise(city);
  if (!clean) return null;
  const hay = ` ${clean} `;
  for (const [alias, gov] of SERVED_ALIASES) {
    if (hay.includes(` ${alias} `)) return gov;
  }
  return null;
}

/** True when the shop delivers to this address. */
export const isServed = city => governorateFor(city) !== null;

/* ------------------------------------------------------ the working week */

const DAY_MS = 86400000;

/** Y-M-D as a UTC instant. These are calendar days, never clocks. */
const toUtc = ymd => {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

const fromUtc = ms => new Date(ms).toISOString().slice(0, 10);

/**
 * The date it is in Cairo, as YYYY-MM-DD.
 *
 * Vercel runs in UTC and the shop is on +02:00 or +03:00 depending on the time
 * of year — Egypt brought daylight saving back in 2023 — so an order confirmed
 * at half past midnight Cairo time is still the previous day in UTC. Reading
 * the calendar date through Intl rather than off a Date getter is what keeps
 * the window anchored to the day the shop thinks it is.
 */
export function todayInCairo(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * `n` working days after `ymd`, skipping Fridays.
 *
 * Friday only, not Friday and Saturday. The Egyptian weekend is both days for
 * an office, but the couriers this shop uses run Saturday to Thursday and
 * quote their tiers in those days, so counting Saturday off as well would push
 * every window a day past the service that was actually bought.
 *
 * Counting starts from the day AFTER the anchor. A parcel confirmed at four in
 * the afternoon is not also delivered at four in the afternoon, and "one
 * working day" means tomorrow in every quote the tiers came from.
 */
export function addWorkingDays(ymd, n) {
  let at = toUtc(ymd);
  let left = Math.max(0, Math.trunc(Number(n) || 0));
  while (left > 0) {
    at += DAY_MS;
    if (new Date(at).getUTCDay() !== 5) left--;
  }
  return fromUtc(at);
}

/**
 * The window to write on an order, as two calendar dates.
 *
 * `now` is an argument so a test can hold the clock still. Nothing in the app
 * passes it.
 */
export function deliveryWindow(city, now = new Date()) {
  const zone = zoneFor(city);
  const [early, late] = SLA[zone];
  const anchor = todayInCairo(now);
  return { zone, from: addWorkingDays(anchor, early), to: addWorkingDays(anchor, late) };
}

/* ------------------------------------------------------------ the words */

/** True for a value this module is willing to treat as a calendar date. */
export const isYmd = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));

/**
 * One date, as the two pieces the sentence is built from.
 *
 * Assembled with formatToParts rather than a format string, because the
 * separator a locale puts between a weekday and a day number is not the same
 * in both: ar-EG writes "الأربعاء، ٢" with an Arabic comma, en-GB writes
 * "Wed 2" with a space. Taking the parts and joining them here gives one shape
 * in both languages while still getting the words and the digits from the
 * locale — Arabic month names and Arabic-Indic numerals, the same as the
 * refund date app/order/[ref]/RefundRequest.js already renders.
 *
 * timeZone is pinned to UTC because the values above are UTC midnights. Left
 * to the runtime default, a date would render as the previous evening anywhere
 * west of Greenwich and the customer would be shown the wrong day.
 */
function pieces(ymd, lang) {
  const parts = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-EG', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(new Date(`${ymd}T00:00:00Z`));

  const of = type => parts.find(p => p.type === type)?.value ?? '';
  return { day: `${of('weekday')} ${of('day')}`, month: of('month') };
}

/**
 * The window as a customer reads it: "Tue 2 – Thu 4 Sept".
 *
 * The month is written once when both ends share it, because "Tue 2 Sept –
 * Thu 4 Sept" is the same fact said twice and the line still has to fit a
 * 375px screen. It is written twice across a month boundary, where dropping it
 * would make the range ambiguous.
 *
 * Returns '' rather than throwing on anything that is not a pair of dates. The
 * caller renders nothing at all in that case, which is the right answer both
 * for an order nobody has confirmed yet and for a row written before these
 * columns existed.
 */
export function formatWindow(from, to, lang) {
  if (!isYmd(from) || !isYmd(to)) return '';

  const a = pieces(from, lang);
  const b = pieces(to, lang);

  if (from === to) return `${a.day} ${a.month}`;
  if (a.month === b.month) return `${a.day} – ${b.day} ${b.month}`;
  return `${a.day} ${a.month} – ${b.day} ${b.month}`;
}

/** One calendar day on its own. */
export function formatDay(ymd, lang) {
  if (!isYmd(ymd)) return '';
  const { day, month } = pieces(ymd, lang);
  return `${day} ${month}`;
}

/**
 * A stored timestamp as the day it was in Cairo.
 *
 * cancelled_at and the timeline rows are TIMESTAMPTZ, and a customer wants the
 * day it happened where they live, not the day it was in UTC. An order
 * cancelled at one in the morning Cairo time is stamped the previous day in
 * UTC, so anything that formats these without naming the zone shows the wrong
 * date for two or three hours out of every twenty-four — which is the sort of
 * bug that is only ever reported as "your website says the wrong thing" by
 * someone who was awake late.
 */
export function formatStamp(value, lang) {
  const at = value instanceof Date ? value : new Date(String(value ?? ''));
  if (Number.isNaN(at.getTime())) return '';
  return formatDay(todayInCairo(at), lang);
}
