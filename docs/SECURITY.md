# Security model — New Star Seven store

This describes the Next.js / Neon Postgres application in this repository.

> An earlier version of this file documented the PHP + MySQL site this was
> ported from — `lib/boot.php`, `.htaccess`, `htmlspecialchars`, `api/order.php`.
> None of those exist here. If you have a copy that mentions them, it is stale.

---

## Where each control actually lives

| Threat | Defence | File |
|---|---|---|
| **SQL injection** | `@neondatabase/serverless` tagged templates. Every `${}` is a bound parameter — the driver never interpolates into SQL text. There is no string-built query in the codebase. | everywhere `sql\`` appears |
| **Price / total tampering** | The browser sends `sku` and `qty` and nothing else. Prices, discounts and delivery are re-read from the database and recomputed server-side. Anything else in the payload is dropped by `cleanCartLines()`. | `lib/pricing.js`, `lib/credentials.js`, `app/api/order/route.js` |
| **Quantity abuse** | Clamped 1–20 per line, floored to an integer, capped at 50 lines. Negative, `NaN`, `Infinity` and `1e9` all tested. | `lib/credentials.js`, `tests/credentials.test.mjs` |
| **Stock races** | The order write is one transaction and the decrement is guarded by `WHERE stock >= ?`, so two customers cannot both take the last jar. | `app/api/order/route.js` |
| **Stored XSS** | React escapes by default. The three places that use `dangerouslySetInnerHTML` are: article Markdown, which escapes first and then re-enables a whitelist; and JSON-LD, which is serialised then has `<` replaced with `<` so a `</script>` in a product name cannot break out. | `lib/markdown.js`, the `ld()` helper in each page |
| **CSRF** | An `Origin` / `Sec-Fetch-Site` check plus a required `application/json` content type, which a cross-site form post cannot set without a preflight this API never answers. | `lib/credentials.js`, `app/api/order/refund/route.js` |
| **Order access** | No accounts. A random token in the confirmation email, stored only as a SHA-256, granting exactly one order. See below. | `lib/order-access.js` |
| **Admin auth** | Separate cookie, separate table, separate module. A customer session cannot become an admin session. | `lib/auth.js` |
| **Stolen admin session** | The token carries the `session_epoch` from its admin row and is refused when that number moves. Changing a password, turning two-factor off and the sign-out-everywhere button all move it. Before this, a leaked cookie was good for its full eight hours and nothing could stop it. | `lib/session-epoch.js`, `lib/auth.js` |
| **Stolen admin password** | TOTP as a second factor, with hashed single-use recovery codes. A correct password issues a five-minute pending cookie and the verify screen, not a session. | `lib/totp.js`, `lib/admin-security.js` |
| **Second-factor brute force** | A six-digit code is a million values; the caps are a five-minute pending window, a per-address limit and a per-account limit keyed on the admin id so rotating source addresses buys nothing. | `app/admin/(auth)/login/verify/page.js`, `lib/config.js` |
| **Replayed one-time codes** | A TOTP code is live for ninety seconds across the drift window, which is long enough to use twice. The accepted step is recorded and anything at or below it is refused. Recovery codes are claimed by `WHERE used_at IS NULL`, so two requests racing on one code cannot both win. | `lib/admin-security.js` |
| **Broken access control** | An order is reachable only through its own token, and the refund write goes to the id that token unlocked — no route reads an order id from a body or query string. Asserted by tests that grep the route files. | `lib/order-access.js`, `tests/order-access.test.mjs` |
| **Order enumeration** | A wrong token, a wrong reference and a reference that does not exist render the same page, from a single failure branch. | `app/order/[ref]/page.js` |
| **Rate limiting** | Fixed-window per-IP limiter in a single statement, so concurrent requests cannot race between read and write. Covers ordering, the newsletter, the quiz, admin login and refund requests. | `lib/db.js`, `lib/config.js` |
| **Request body size** | 128 KB cap, checked both from `Content-Length` and from the actual read, so a spoofed length does not get around it. | `lib/http.js` |
| **Secrets** | Nothing is committed. `.env*` is gitignored; only `.env.example` with placeholders is tracked. Verified against the full history, not just the working tree. | `.gitignore`, `.env.example` |
| **Indexing of private pages** | `/admin`, `/api`, `/checkout` and `/order` are disallowed in robots.txt in both locales, and the pages themselves send `robots: noindex`. | `app/robots.js` |

---

## Reaching your own order, without an account

The shop briefly had customer accounts — passwords, rotating session tokens,
per-user carts. They were removed. On a cash-on-delivery shop the only thing a
customer ever comes back for is the state of one order, and asking them to
invent a password for that is friction with no payoff.

What replaced it:

- **Email is mandatory at checkout.** An order without one is an order nobody
  can track, cancel or ask about.
- The confirmation email carries a link: `/order/<ref>?t=<token>`.
- The token is **32 random bytes, stored only as its SHA-256**. It exists in
  that one email and nowhere else — not in the database, not in a log. A dump
  of `orders` yields nothing replayable.
- Lookup is **by digest, then confirmed against the reference** in the URL.
  Both halves have to agree, so one valid token cannot be pointed at a
  different order by editing the path.
- A wrong token, a wrong reference and a reference that does not exist all
  render **the same page**. Distinguishing them would turn this into a way to
  test whether an order reference is real.
- **No expiry.** A customer chasing a refund six weeks later still needs it,
  and unlike a session this grants exactly one order rather than an identity.

The refund request re-verifies the token server-side and writes to the id the
token unlocked — `requestRefund(orderId, …)` takes no reference and the route
reads no id from the body, so one valid token cannot write to another order.

Consequences to know before changing it:

- **The token cannot be recovered.** If the customer loses the email, the shop
  has to look the order up by phone. That is the price of not storing it, and
  the email says to keep it.
- `/order` is disallowed in robots.txt and the page sends `noindex` and
  `force-dynamic` — it renders one customer's order and must never be cached.

## What is deliberately not done yet

These are known gaps, not oversights. Listed so nobody has to rediscover them.

- **The order link is not re-sendable.** There is no "email me my link again"
  flow, because the token is not stored. A customer who loses the email has to
  ring the shop.
- **The email address is not verified.** A typo at checkout means the
  confirmation, and the only copy of the link, goes nowhere. The order still
  exists and the shop still calls the phone number.
- **Requesting a refund does not cancel anything.** It records the request and
  notifies the shop; the decision stays human, because the parcel may already
  be with the courier.
- **`ADMIN_SETUP_KEY` should be removed from the environment** once the first
  admin exists; `/admin/setup` is reachable while it is set.

---

## Checklist before a production domain goes live

- [ ] `SESSION_SECRET` set to a long random string. The **admin login** throws
      without it — this is not a soft failure. Customer order links do not use
      it; they are hashed tokens, not signed ones. It now also derives the key
      that encrypts the TOTP secrets, so **rotating it signs every admin out
      and requires two-factor to be set up again**. That is the deliberate
      price of not storing a second factor in the clear.
- [ ] Two-factor turned on for every admin, from the Security tab, and the ten
      recovery codes saved somewhere that is not the machine that signs in.
      They are shown once; the table holds only their SHA-256, so a lost set
      can be reissued but never recovered.
- [ ] `NEXT_PUBLIC_SITE_URL` set to the real origin. The CSRF origin check
      compares against it, so a wrong value refuses every mutation.
- [ ] `ADMIN_SETUP_KEY` removed after the first admin is created.
- [ ] `MAIL_FROM` on a domain the client actually controls. It currently
      defaults to `newstarseven.com`, which belongs to an unrelated business —
      see `docs/product-facts.md`.
- [ ] HTTPS only. The admin session cookie is `Secure` unconditionally, so it
      will not be set over plain HTTP at all — and order links travel in email,
      where a plain-http link would leak the token to every hop.
- [ ] `RESEND_API_KEY` working. Without it the confirmation email never sends,
      and **the order link is lost for good** — it is not stored anywhere else.
- [ ] Confirm `robots.txt` in production disallows `/order` and `/checkout`.

---

## Testing

`npm test` — no database required.

Three of the suites exist because a green build hid a real production failure,
and are worth keeping for that reason:

| Suite | The failure it would have caught |
|---|---|
| `tests/hook-deps.test.mjs` | `ReferenceError: q is not defined` in a hook dependency array. The checkout was dead for eight deploys; the build was green throughout, because it compiles rather than resolving identifiers. |
| `tests/fonts.test.mjs` | The port dropped the Google Fonts link. Thirty-four `font-family` declarations named fonts nothing loaded, and the whole site rendered in a system fallback. |
| `tests/sql-split.test.mjs` | A migration that ran, reported success, and changed nothing. |

The lesson each encodes: a passing build is not evidence that a thing works, and
neither is an API that answers optimistically. `document.fonts.check()` returns
`true` for a font that was never loaded.
