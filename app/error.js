'use client';

import { useEffect } from 'react';

/**
 * What a customer sees when a page throws.
 *
 * Five routes — shop, blog, article, product and checkout — query the database
 * without a catch. Four of them are revalidated on a timer, so a brief fault is
 * cushioned by the cached copy; checkout is force-dynamic and has no cushion at
 * all, which meant a database blip showed an unstyled white "Application error"
 * screen on the one page where someone is trying to give you money.
 *
 * A boundary cannot make the query succeed. It can say something true in the
 * right language, keep the brand on screen, and offer a retry — Next's reset()
 * re-renders the segment, which is exactly the right move for a transient
 * fault.
 */
export default function Error({ error, reset }) {
  useEffect(() => {
    // Reaches the platform logs with the digest, so a real fault is findable.
    console.error('[s7] route error:', error?.digest || error?.message || error);
  }, [error]);

  // A client boundary cannot read the request header, and this can replace a
  // page in either language. The document direction is already correct from the
  // root layout, so inherit it and lead with Arabic, the default market.
  return (
    <div className="wrap nf">
      <h1>فيه حاجة وقعت عندنا</h1>
      <p>
        المشكلة من عندنا مش من عندك، وأغلب الوقت بتتحل لو جربت تاني. لو فضلت،
        كلّمنا على واتساب وهنكمّل الأوردر معاك.
      </p>
      <p lang="en" dir="ltr" style={{ color: 'var(--grey)' }}>
        Something went wrong on our side. It usually clears if you try again.
      </p>

      <div className="nf-links">
        <button className="btn btn-red" onClick={() => reset()}>
          جرّب تاني · Try again
        </button>
        <a className="btn btn-line" href="https://wa.me/201028282216" target="_blank" rel="noopener">
          واتساب
        </a>
      </div>
    </div>
  );
}
