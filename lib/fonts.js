import { Anton, Cairo, Tajawal } from 'next/font/google';

/**
 * The font instances, in one module, so that there is exactly one next/font
 * call site per face for the whole application.
 *
 * This is not tidiness. Every next/font call generates its own class name and
 * its own set of <link rel="preload"> elements, so calling Anton() from two
 * files does not share one face between them — it ships the same font twice
 * under two different variable names, and doubles the preloads competing for
 * the first paint. A later phase splits the root layout in two, one per
 * language tree, and both halves have to put the same font variables on their
 * own <html>. Importing the instances from here is what makes that split safe;
 * re-declaring them in each half is the failure it is designed to prevent.
 *
 * Anything that needs a face imports it from here. Nothing else should call
 * next/font.
 */

/**
 * The three faces the design is drawn in, and the two loading policies they
 * split across.
 *
 * The PHP site pulled these from a Google Fonts <link>. The port dropped it and
 * nothing replaced it, so every 'Anton' and 'Cairo' in the stylesheets — around
 * thirty declarations — has been silently falling back to a system sans this
 * whole time. Arabic degraded to something passable, which is why it went
 * unnoticed; the English display type did not.
 *
 * next/font rather than the original <link>: it downloads the files at build
 * time and serves them from this origin, so there is no third-party request on
 * the critical path, no round trip to two extra hosts, and a size-adjusted
 * fallback that keeps the swap from shifting the layout.
 *
 * `display` is set per tier rather than uniformly, because the two tiers want
 * opposite things from the moment before the font arrives.
 *
 * The display tier — Anton for Latin, Tajawal for Arabic — gets 'block'. Both
 * of them set the hero, which is the largest thing above the fold, and 'swap'
 * paints it in the size-adjusted fallback first. That fallback is derived from
 * Arial: a wide, even grotesque, nothing like Anton's tall condensed poster
 * face. So the hero renders in a visibly wrong typeface for a beat and then
 * changes under the reader — which is what has been reported three times now
 * as the English font having changed again. It never changed. It was being
 * seen mid-swap. 'block' holds that text invisible for the short block period
 * instead, so the headline paints once, already in the right face.
 *
 * The body tier — Cairo — stays on 'swap' deliberately. It sets body copy, nav,
 * buttons, product cards and the whole Arabic UI, and for running text the
 * trade runs the other way: reading the words immediately in a fallback beats
 * waiting in front of a blank column for the right one. A paragraph that
 * reflows is a far smaller insult than a paragraph that is not there yet.
 *
 * Neither policy can shift the layout. `adjustFontFallback` is on by default
 * and emits the ascent, descent and size-adjust overrides that make the
 * fallback occupy the same box as the real face.
 *
 * One thing `subsets` is not: it does not decide what gets downloaded. The
 * Google Fonts URL next/font builds carries no subset parameter, so every
 * subset of every family below is fetched and self-hosted at build time either
 * way, each behind its own unicode-range. What `subsets` decides is which of
 * those files get a <link rel="preload"> — which is why naming a subset a tier
 * never renders is not free: it forces a download of a file the browser would
 * otherwise never have asked for. It is also required rather than optional,
 * since preloading is on by default and next/font refuses to build without it.
 */
export const anton = Anton({
  // Latin only, and not by preference: the family has no Arabic subset to ask
  // for. That is also why the rules that can meet Arabic text — prices, spec
  // labels, the 404 code — name Cairo immediately after it: on the Arabic pages
  // each Arabic glyph falls straight through to Cairo while the Latin numerals
  // stay in Anton. The purely decorative rules (the ticker, the outline stars,
  // the stamp) skip that and go to sans-serif, because they are never Arabic.
  subsets: ['latin'],
  weight: '400',            // Anton ships one weight
  display: 'block',         // display tier — see above
  variable: '--font-anton',
});

export const cairo = Cairo({
  // Both subsets earn their preload here. Cairo is the body face on every page
  // in both directions, and it is also the fallback the Anton rules list second,
  // so Latin and Arabic glyphs are both on the first paint whichever language
  // is being served.
  subsets: ['arabic', 'latin'],
  // All five weights are the weights the stylesheets actually ask for — counted
  // across globals.css, landing.css, hairtypes.css and admin.css, they are
  // asked for 2, 56, 38, 36 and 110 times respectively, so not one of them is
  // dead. The original <link> requested 400;600;700;900, which left the three
  // dozen rules set in 800 to be synthesised by the browser — a faux-bold smear
  // of the 700. Cairo is a variable font, so the extra weight costs nothing.
  weight: ['400', '600', '700', '800', '900'],
  // 'swap', and not the 'block' the two display faces get. This is the body
  // tier: unstyled but readable beats correct but invisible. See above.
  display: 'swap',
  variable: '--font-cairo',
});

/**
 * The Arabic display face.
 *
 * Two faces have been rejected here, and both rejections were about drawing
 * rather than loading — the Cairo above is genuine, and has been since the
 * fonts were wired up.
 *
 * Cairo went first. It is a text face, drawn to stay even and quiet at
 * paragraph sizes, which is exactly what makes it fall apart on the hero: at
 * 148px its Black weight has no stroke contrast to hold the eye, the counters
 * open up, and the whole line reads as a UI font that someone dragged bigger.
 *
 * Changa replaced it and was rejected in turn, with the note that modern and
 * bold was what was wanted. Changa is a modern kufi: squared terminals, angular
 * joins, an architectural silhouette rather than a typographic one. That kufi
 * flavour is the thing being objected to, not the weight, so the answer is not
 * a heavier kufi but a different construction altogether.
 *
 * Tajawal is that construction. It is a geometric Arabic sans — even stroke,
 * round unmodulated bowls, clean joins, no calligraphic contrast — which is the
 * neo-grotesque register contemporary Gulf and Egyptian brands are set in. Its
 * Black is the heaviest thing in the comparison: set on the hero's own three
 * lines it is visibly denser in colour than Cairo 900 or Changa 800, which is
 * what bold was asking for. It also partners the Latin hero properly. That is
 * set in Anton — tall, condensed, flat-terminalled, near-uniform stroke — and
 * Tajawal Black is the Arabic face that matches its density and its flatness,
 * so the two halves of a bilingual site read as one design.
 *
 * The rest of the shortlist was set on the same three lines and put aside.
 * Alexandria 900 is wider than the hero column and wraps outright. Zain 900 and
 * Noto Sans Arabic 900 carry real stroke modulation and read editorial next to
 * Anton's blunt grotesque. Almarai stops at 800 and is lighter in colour there.
 * Mada 900, Vazirmatn 900, Readex Pro 700 and IBM Plex Sans Arabic 700 all top
 * out at a strong UI bold rather than a poster black.
 *
 * Cairo stays. Everything below the display tier — body copy, buttons, nav,
 * product cards, the whole Arabic UI — is still set in it, because that is the
 * work it is good at. This is a second face for the headlines, not a swap.
 */
export const tajawal = Tajawal({
  // Arabic only. Exactly one rule in the codebase names this face —
  // `[dir="rtl"] .s7home .hero-title` in app/landing.css — so it is the Arabic
  // display tier and nothing else, and there is no Latin text anywhere that
  // could be set in it. Listing 'latin' here does not stop the Latin file being
  // built, but it did preload it, which spent first-paint bandwidth on a file
  // whose unicode-range the browser was never going to match.
  subsets: ['arabic'],
  // 900 only. It is the single weight the stylesheet asks Tajawal for, and the
  // top of the family's range — anything heavier would have to be synthesised.
  weight: ['900'],
  display: 'block',         // display tier, same as Anton — see above
  variable: '--font-tajawal',
});
