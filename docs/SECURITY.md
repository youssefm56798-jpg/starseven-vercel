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
| **Order access** | No accounts. A random token in the emails we send, stored only as a SHA-256, granting exactly one order. One order can hold several live links — `order_tokens` — so a status email can carry one without killing the one in the confirmation. See below. | `lib/order-access.js`, `db/schema.sql` |
| **Admin auth** | Separate cookie, separate table, separate module. A customer session cannot become an admin session. | `lib/auth.js` |
| **Broken access control** | An order is reachable only through its own token, and the refund write goes to the id that token unlocked — no route reads an order id from a body or query string. Asserted by tests that grep the route files. | `lib/order-access.js`, `tests/order-access.test.mjs` |
| **Order enumeration** | A wrong token, a wrong reference and a reference that does not exist render the same page, from a single failure branch. `/order/find` answers the same sentence whether or not the email and reference matched — one response expression, and the lookup and the mint are one statement so a hit and a miss cost the same round trip. | `app/order/[ref]/page.js`, `app/api/order/find/route.js` |
| **Rate limiting** | Fixed-window per-IP limiter in a single statement, so concurrent requests cannot race between read and write. Covers ordering, the newsletter, the quiz, admin login, refund requests and the order-link resend — which is limited per email as well as per IP, so the shop cannot be used to mail somebody on demand. | `lib/db.js`, `lib/config.js` |
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
  of `orders` or of `order_tokens` yields nothing replayable.
- Lookup is **by digest, then confirmed against the reference** in the URL.
  Both halves have to agree, so one valid token cannot be pointed at a
  different order by editing the path.
- A wrong token, a wrong reference and a reference that does not exist all
  render **the same page**. Distinguishing them would turn this into a way to
  test whether an order reference is real.
- **No expiry** on the links a customer is meant to keep. Somebody chasing a
  refund six weeks later still needs one, and unlike a session this grants
  exactly one order rather than an identity.

### Several links, one order

`orders.access_hash` held one digest, and one digest per order is a credential
that can be issued exactly once. `order_tokens` holds a row per link instead,
so minting is **additive**: a new link never invalidates an old one.

- A **status email** (confirmed / shipped / delivered / cancelled) mints its
  own link and carries it. Before this it carried none, because the only
  digest there was could not be turned back into a URL and overwriting it
  would have killed the link already in the customer's inbox.
- **`/order/find`** takes an email and an order reference and mails a fresh
  link to the address on the order. That link — and only that one — **expires
  after 30 days**: it is the only token a stranger can cause to be minted, and
  the only one whose loss costs nothing, because the same page will make
  another.
- Every existing `access_hash` is migrated into the table by `db/schema.sql`,
  idempotently, on every deploy. The column is **still written and still read**
  for one more release, so that a rollback cannot strand orders placed while
  the new code was live — the schema is applied at build time, before the old
  code stops serving.

`/order/find` refuses to be an oracle, and the mechanism matters more than the
wording: there is one response expression in the route and both a match and a
miss fall through to it, the lookup and the mint are a **single statement** so
they cost the same round trip, and the mail goes out from `after()` so its
latency is not in the response. Limited per IP (enumeration) and per email
(so nobody can use the shop to mail a person they do not own).

The refund request re-verifies the token server-side and writes to the id the
token unlocked — `requestRefund(orderId, …)` takes no reference and the route
reads no id from the body, so one valid token cannot write to another order.

Consequences to know before changing it:

- **The token still cannot be recovered — a new one is issued instead.**
  Nothing stored can be turned back into a link. `/order/find` does not find
  the old token; it mints a new row and mails a new URL.
- `/order` is disallowed in robots.txt and every page under it sends `noindex`
  and `force-dynamic` — they render one customer's order, or one per-visitor
  answer, and must never be cached.
- `npm run verify:access` proves all of the above against a throwaway Neon
  database: the migration, the two-branch lookup, a tampered token, an expired
  one, and the hit/miss timing of `/order/find`.

## What is deliberately not done yet

These are known gaps, not oversights. Listed so nobody has to rediscover them.

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
      it; they are hashed tokens, not signed ones.
- [ ] `NEXT_PUBLIC_SITE_URL` set to the real origin. The CSRF origin check
      compares against it, so a wrong value refuses every mutation.
- [ ] `ADMIN_SETUP_KEY` removed after the first admin is created.
- [ ] `MAIL_FROM` on a domain the client actually controls. It currently
      defaults to `newstarseven.com`, which belongs to an unrelated business —
      see `docs/product-facts.md`.
- [ ] HTTPS only. The admin session cookie is `Secure` unconditionally, so it
      will not be set over plain HTTP at all — and order links travel in email,
      where a plain-http link would leak the token to every hop.
- [ ] `RESEND_API_KEY` working. Without it no email sends at all — the
      confirmation, the status notices and the `/order/find` resend are the
      only ways a link ever reaches a customer, and none of them is stored.
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
