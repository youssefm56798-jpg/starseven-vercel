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
| **CSRF** | Three independent locks: `SameSite=Lax` cookies, an `Origin` / `Sec-Fetch-Site` check, and a required `application/json` content type that a cross-site form post cannot set without a preflight this API never answers. | `lib/auth-guard.js`, `lib/credentials.js` |
| **Customer auth** | bcrypt cost 12. Short signed access token, opaque rotating refresh token stored as a SHA-256 digest. See below. | `lib/customer-auth.js` |
| **Admin auth** | Separate cookie, separate table, separate module. A customer session cannot become an admin session. | `lib/auth.js` |
| **Broken access control** | Every cart and order query is scoped by the user id taken from the verified token. No endpoint reads an identity from a body, query string or header — asserted by a test that greps the route files. | `lib/server-cart.js`, `tests/auth-routes.test.mjs` |
| **User enumeration** | Login runs a real bcrypt compare against a fixed hash when the address is unknown, so an unknown account costs the same time as a wrong password, and both return the same message. | `app/api/auth/login/route.js` |
| **Rate limiting** | Fixed-window per-IP limiter in a single statement, so concurrent requests cannot race between read and write. Login also has a per-account bucket, keyed by a digest so the table never becomes a list of customer emails. | `lib/db.js`, `lib/config.js` |
| **Request body size** | 128 KB cap, checked both from `Content-Length` and from the actual read, so a spoofed length does not get around it. | `lib/http.js` |
| **Secrets** | Nothing is committed. `.env*` is gitignored; only `.env.example` with placeholders is tracked. Verified against the full history, not just the working tree. | `.gitignore`, `.env.example` |
| **Indexing of private pages** | `/admin`, `/api`, `/checkout` and `/account` are disallowed in robots.txt in both locales, and the pages themselves send `robots: noindex`. | `app/robots.js` |

---

## Customer sessions, and the one trade-off worth understanding

The requirement was: do not make a returning customer log in again, do not read
the database on every request, and still be able to revoke a session. Those do
not all fit in one token, so there are two.

**Access token** — a 15-minute JWT (HS256, `jose`). Verified by signature alone.
Every authenticated render uses this and touches no database.

**Refresh token** — 32 random bytes, opaque, 60-day life, **stored only as a
SHA-256 digest**. Rotated on every use. It is the only thing that reads the
`sessions` table, and only once the access token has expired.

Consequences to be aware of before changing any of it:

- **A revoked session survives up to 15 minutes.** That is the price of not
  reading the database per request. Lowering `ACCESS_TTL` narrows it linearly.
  `tests/auth-routes.test.mjs` fails if it is raised above 900s.
- **A refresh token presented twice revokes the whole family.** Two parties
  holding one token is indistinguishable from theft, so both are logged out.
  This means a client that fires concurrent refreshes will log itself out —
  `lib/session-client.js` shares a single in-flight refresh for exactly this
  reason. Do not remove that.
- **A database dump contains nothing replayable.** Digests only.

`docs/auth-spec.json` is the full specification, including what was deliberately
left out.

---

## What is deliberately not done yet

These are known gaps, not oversights. Listed so nobody has to rediscover them.

- **No email verification on register.** An address can be claimed without
  proving control of it.
- **No password reset.** A customer who forgets theirs has no route back.
- **No MFA**, and no per-device session list for customers.
- **The admin login has not been moved onto the customer session machinery.**
  It still uses the simpler 8-hour signed cookie in `lib/auth.js`.
- **`ADMIN_SETUP_KEY` should be removed from the environment** once the first
  admin exists; `/admin/setup` is reachable while it is set.

---

## Checklist before a production domain goes live

- [ ] `SESSION_SECRET` set to a long random string. **Every auth route throws
      without it** — this is not a soft failure.
- [ ] `NEXT_PUBLIC_SITE_URL` set to the real origin. The CSRF origin check
      compares against it, so a wrong value refuses every mutation.
- [ ] `ADMIN_SETUP_KEY` removed after the first admin is created.
- [ ] `MAIL_FROM` on a domain the client actually controls. It currently
      defaults to `newstarseven.com`, which belongs to an unrelated business —
      see `docs/product-facts.md`.
- [ ] HTTPS only. The session cookies are `Secure` unconditionally, so they will
      not be set over plain HTTP at all.
- [ ] Confirm `robots.txt` in production disallows `/account` and `/checkout`.

---

## Testing

`npm test` — 295 tests, no database required.

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
