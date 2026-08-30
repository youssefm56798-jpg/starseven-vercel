# Legal brief — New Star Seven storefront

**For:** an Egyptian lawyer advising Ovanza Cosmetics.
**Purpose:** you should not have to read a codebase to answer these. This
describes exactly what the site does with personal data, and asks the four
questions the engineering could not settle.

**Written by the engineering side, August 2026. Not legal advice.**

---

## 1. What the business is

- Single-brand men's hair-care storefront, `starseven-vercel.vercel.app`, moving
  to a custom domain.
- **Cash on delivery only.** No card processing, no payment gateway, no stored
  payment instrument. The site never sees a card number.
- Egypt only. Prices in EGP. Delivery by courier, collected in cash at the door.
- Bilingual Arabic (primary) and English.
- **No customer accounts.** There is no signup, no password, no login for
  customers. A customer reaches their own order through a link emailed to them.

## 2. Exactly what personal data is collected

| Data | When | Required? | Why |
|---|---|---|---|
| Name, mobile, address, governorate, notes | At checkout | Yes | To deliver and to phone-confirm |
| Email | At checkout | **Yes** | It is the only route back into the order |
| Email + mobile on a marketing list | Only if the customer ticks a box, or signs up separately | No | Offers |
| Hair-quiz answers + recommended product | If the finder is used | No | Product demand signal. No name or number attached |
| IP address | On an order, a newsletter signup, a quiz answer, and in a rate-limit table | Automatic | Abuse prevention and incident investigation |

Nothing else. No card data, no date of birth, no ID number, no location beyond
the delivery address the customer types.

## 3. How order access works, because it is unusual

There are no accounts, so there is no password to steal. Instead:

- At checkout the server generates a 256-bit random token, emails it inside a
  link, and stores **only its SHA-256 digest**. The token itself is never
  written to the database or to any log.
- Opening that link is what proves entitlement to see the order.
- An independent security audit attacked this: a wrong token, a tampered order
  reference, and a reference that does not exist all return a byte-identical
  "not found" page, with response times measured and indistinguishable.

**Why it matters to you:** the practical effect is that the confirmation email
is the credential. Anyone forwarded that email can see the order — name,
address, phone, contents. We judged this the right trade for a shop with no
accounts, and it is what Shopify and most parcel trackers do. If you disagree,
say so, because it is a design decision and not an accident.

## 4. Sub-processors and where data physically sits

| Provider | Role | Location |
|---|---|---|
| **Neon** | Postgres database — all customer data | **Frankfurt, Germany** (`eu-central-1`) |
| **Vercel** | Hosting, plus Web Analytics and Speed Insights | US company, global edge |
| **Resend** | Transactional and marketing email | US company |

Analytics measures page views and load speed. It sets no advertising cookies and
there is no advertising on the site. **There is currently no consent banner.**

The only cookie is the staff login cookie. Customers get no cookies — the cart
and a duplicate-order guard live in browser local storage.

## 5. The questions

### Q1 — Cross-border transfer under PDPL (Law 151 of 2020)

Egyptian customers' names, phone numbers and home addresses are stored in
Germany, and email passes through a US provider.

- Does this need a licence or permit from the Data Protection Centre?
- Is customer consent at checkout a sufficient basis, or is more required?
- **We are aware the executive regulations have been delayed.** What is the
  practical compliance posture in the meantime — act as if they are in force, or
  document and wait?
- Does the business need to register, or appoint a data protection officer?

### Q2 — The returns window under Consumer Protection Law (181 of 2018)

The terms previously offered **48 hours, damaged-or-wrong only**. Our
understanding is that the law provides a **14-day right to return a distance
purchase without giving a reason**, so the published terms were narrower than
the statutory right. They have been rewritten to state 14 days.

- Is 14 days correct for this kind of sale?
- **Is there an exemption for opened cosmetics on hygiene grounds?** This is the
  commercially important half — a wax pot that has been opened and used cannot
  be resold, and the terms currently gesture at this without stating a rule.
- Who bears return shipping?
- Does anything change because payment is cash on delivery rather than prepaid?

### Q3 — Does analytics need consent here?

Vercel Analytics and Speed Insights run on every page with no banner. They are
first-party-ish, cookieless, and not used for advertising or profiling.

- Under Egyptian law, is consent required before loading them?
- If a banner is needed, does it need to block loading until a choice is made?

### Q4 — What must appear on the site

The policy and terms currently carry `[[placeholders]]` for these because nobody
should invent them:

- Registered legal name and address
- Commercial register number
- Tax card number
- A privacy contact address (only a WhatsApp number exists today)

Please confirm which of these are legally required on an Egyptian e-commerce
site, and whether anything else is missing — a returns address, a complaints
route, or ETA e-invoicing obligations once the business is a registered
taxpayer.

## 6. What has already been done

So you are not re-solving these:

- Marketing is **double opt-in**: a subscriber is not added until they click a
  confirmation link.
- **Unsubscribe is honoured permanently.** A previously fixed defect let an old
  confirmation link re-subscribe somebody who had opted out; it now refuses.
- Order data is never shared, sold, or sent anywhere except the three
  sub-processors above.
- The privacy policy and terms have been rewritten to describe what the code
  actually does, and a test now fails the build if they drift apart again.

---

**Where the text lives:** `app/_components/legalCopy.js` — one file, both
languages, both documents. Changes are a copy edit, not a code change, so
whatever you mark up can be applied directly.
