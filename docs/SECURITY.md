# Security review — New Star Seven store

An attack → fix → re-attack pass was run against the whole stack (checkout,
newsletter, admin, and the server-rendered pages) with a live MySQL database.
This records what was tested, what held, and what was fixed.

## Controls in place

| Threat | Defence | Verified |
|---|---|---|
| **SQL injection** | Prepared statements with bound parameters everywhere; no string-built queries | Injected payloads in `sku`, `coupon`, and confirm tokens — all rejected as data |
| **Price / total tampering** | Every price, discount and delivery fee recomputed server-side in `api/order.php` from the database; the browser only sends `sku` + `qty` | Sent `price:0.01` and fake totals — ignored, charged the real price |
| **Quantity abuse** | Clamped to 1–20 per line, integer-cast | Negative and 999999999 quantities both clamped |
| **Stored XSS** | All output escaped with `htmlspecialchars`; article Markdown escapes first then re-enables a whitelist; JSON-LD encoded with `JSON_HEX_TAG` | `<script>`, `<img onerror>`, and a `</script>` breakout in a product name — all neutralised |
| **CSRF** | Per-session token required on every admin POST, checked with `hash_equals` | POSTs without / with a forged token → 419 |
| **Broken access control** | Every admin page calls `require_admin()`; no order-read endpoint exists (no IDOR surface) | All admin pages redirect to login; `GET /api/order.php` → 405 |
| **Auth** | `password_hash`/`password_verify`, session regenerated on login, generic "wrong email or password", login rate-limited | Wrong password and enumeration attempts gave nothing |
| **Rate limiting** | Fixed-window per-IP limiter on subscribe / order / quiz / login | Subscribe flips to 429 after 5/hour |
| **Stock races** | Order write is one transaction; stock decrement guarded by `WHERE stock >= ?` | 5 concurrent orders against stock of 3 → one succeeded, stock never went negative |
| **Clickjacking** | `X-Frame-Options: SAMEORIGIN` + `frame-ancestors` in CSP | Confirmed on every response |
| **Method tampering** | `require_post()` on mutating endpoints | PUT/DELETE/PATCH/TRACE → 405 |
| **Open redirect** | Language switch only ever emits same-origin relative paths | No off-site URL emitted |
| **Header injection** | Email validated with `filter_var` before use; phone normalised to digits | Newline-in-email rejected |
| **Secrets exposure** | `config.php` / `config.local.php` only `return` an array (no output if hit directly); `.htaccess` denies `.sql`/`.log`/`config.local.php`; `db/` and `lib/` carry deny rules and an `index.php` guard | Direct hits return 0 bytes or 403 |

## Fixed during the review

1. **Request body size cap (DoS).** A 10 MB POST body was previously read in full.
   Added `S7_MAX_BODY` (128 KB): oversized requests are refused with a clean
   `413` both by an early `Content-Length` check and by a bounded stream read, so
   a spoofed / omitted length can't get around it. `lib/boot.php`.

2. **Security headers no longer depend on `.htaccess` alone.** `security_headers()`
   sets `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy` from
   PHP at boot, so they survive a misconfigured `AllowOverride` or a non-Apache
   server. `lib/boot.php`.

3. **Content-Security-Policy added.** Server-rendered pages and the SPA now ship a
   CSP that locks sources to `self` plus the known CDN/font hosts, with
   `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. JSON endpoints
   send `default-src 'none'; frame-ancestors 'none'`. (`'unsafe-eval'`/`'unsafe-inline'`
   remain only because the in-browser Babel build needs them — a future no-build
   compile step would let those be dropped.)

4. **`db/` directory guard.** Added `db/index.php` (403) so the SQL files aren't
   directory-listed even on a server that ignores `.htaccess`. The `.sql` files
   hold schema only — no credentials — so this is defence in depth.

## Deployment checklist (security-relevant)

- [ ] Set `debug => false` in `lib/config.php` (hides PHP errors).
- [ ] Serve the site over **HTTPS** — the admin session cookie sets its `Secure`
      flag automatically when the request is HTTPS.
- [ ] Delete `admin/setup.php` after creating the first admin.
- [ ] Do **not** upload `tests/` or `lib/config.local.php`.
- [ ] Use a strong `admin.setup_key` and a long admin password (10+ chars enforced).
- [ ] Confirm `.htaccess` is active (Hostinger has `AllowOverride On` by default);
      the PHP-level guards above cover the case where it isn't.

## Residual, accepted

- **Newsletter email enumeration** — subscribing an already-registered address
  returns "you're already on the list". Standard for newsletters and low value to
  an attacker; left as-is for usability.
- **`'unsafe-eval'` in the CSP** — required by the in-browser Babel transform.
  Removing it means adding a build step, which is out of scope for the current
  no-build deployment.
