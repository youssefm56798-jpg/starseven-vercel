import { ImageResponse } from 'next/og';

/**
 * The social preview card, generated rather than exported from a design file.
 *
 * The site was pointing og:image at /assets/wax-red.png, which is a 900x900
 * product photograph at 418KB. Every platform that renders a link card wants
 * 1200x630, so a square gets centre-cropped: Facebook, WhatsApp, LinkedIn and
 * X all cut the top and bottom off, and on the small-card layouts the shop's
 * name never appeared at all - the one thing the card exists to say.
 *
 * Next's file convention takes over as soon as this file exists, which is why
 * the `images` key came out of app/layout.js. The route it creates is static:
 * this runs at build time, not per request.
 *
 * Type is drawn rather than loaded. Reaching for Cairo here would mean shipping
 * a font file into the edge bundle and, for the Arabic name, a shaping engine -
 * for a 1200x630 PNG whose whole job is to be legible as a thumbnail. The Latin
 * name is what a link card needs, and the system stack renders it.
 *
 * The star is an inline SVG and not the ★ character. Satori resolves any glyph
 * outside the bundled Latin set by downloading a font for it at build time, and
 * that lookup returned 400 for this one - so the build printed "Failed to load
 * dynamic font for ★" and the card would have carried a missing glyph or a gap
 * where the brand mark should be. A path needs no font and cannot fail.
 */

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'New Star Seven — premium hair wax and gel, made in Egypt';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          // The brand's own paper and ink, from app/globals.css.
          background: '#F5F2EA',
          color: '#12100B',
          fontFamily: 'sans-serif',
          // The offset red edge the cards on the site carry, as a border rather
          // than a shadow - ImageResponse does not paint box-shadow.
          borderBottom: '18px solid #D7291D',
        }}
      >
        <svg width="104" height="104" viewBox="0 0 24 24" fill="#D7291D">
          <path d="M12 1.6l3.1 6.9 7.5.8-5.6 5 1.6 7.4L12 17.9 5.4 21.7 7 14.3 1.4 9.3l7.5-.8z" />
        </svg>
        <div
          style={{
            fontSize: 84,
            fontWeight: 900,
            letterSpacing: '-0.02em',
            marginTop: 18,
          }}
        >
          NEW STAR SEVEN
        </div>
        <div style={{ fontSize: 34, fontWeight: 600, color: '#6E6A60', marginTop: 16 }}>
          Premium hair wax &amp; gel — made in Egypt
        </div>
        <div style={{ fontSize: 26, fontWeight: 600, color: '#6E6A60', marginTop: 28 }}>
          Cash on delivery
        </div>
      </div>
    ),
    size,
  );
}
