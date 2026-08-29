/**
 * Who is allowed to do what, as a table rather than as a scattering of ifs.
 *
 * Pure — no database, no next/*, no imports at all — so tests/ can prove the
 * table without a Postgres and so lib/admin-accounts.js can enforce it in the
 * same module that does the writing. Same arrangement lib/credentials.js has
 * with the checkout: one place answers the question, and the screens call it
 * rather than forming their own opinion.
 *
 * ---------------------------------------------------------------------------
 * Two roles, and the line between them
 *
 * The shop is a cash-on-delivery operation run by an owner plus, now, somebody
 * who works the order desk. That is the entire org chart, so a third role would
 * be a guess about a shape nobody has. Two is what the situation has.
 *
 *   owner   everything, including accounts.
 *   staff   the order desk, and nothing that is irreversible or is money.
 *
 * What staff may NOT do, and why each one is on that side of the line:
 *
 *   accounts    Owner only, and this is the one that is not negotiable. An
 *               account system where any account can mint another account is
 *               not an account system: the whole reason this feature exists is
 *               that order_events records admin:4 as the actor and that has to
 *               mean one person. Somebody who can create logins can create one
 *               nobody knows about, hand it out, and every entry it writes is
 *               untraceable. Somebody who can suspend accounts can lock the
 *               owner out of the shop.
 *
 *   products    Read yes, write no. Price and stock ARE the money on a shop
 *               that takes cash at the door: a price typed with a missing digit
 *               is a real loss on every order placed before somebody notices,
 *               and it is not remotely needed to process an order. Reading is
 *               allowed because the person on the phone has to be able to say
 *               what is in stock.
 *
 *   offers      Owner only. A discount code is money by another name, and a
 *               broadcast is the one action in this panel that cannot be taken
 *               back at all - it is thousands of emails already delivered.
 *
 *   subscribers Read yes, write and export no. The list itself is not a new
 *               class of secret to somebody who can already read every order,
 *               which carries the same names, phones, addresses and emails. The
 *               bulk CSV is different in kind rather than degree: it is the
 *               whole customer database in one file, it is the single most
 *               valuable thing that can walk out of this panel, and no order
 *               has ever needed it. Deleting a subscriber is destructive and
 *               likewise has nothing to do with the order desk.
 *
 *   orders      Staff have all of it, because that is the job. Status moves,
 *               notes, call outcomes, courier and tracking. Note the asymmetry
 *               that makes this safe rather than generous: every one of those
 *               writes a row into order_events stamped with the admin id, so
 *               the powers staff DO have are exactly the ones that leave a
 *               trail. The powers they do not have are the ones that would not.
 *
 * Nothing here governs an admin acting on their own account. Changing your own
 * password, enrolling your own second factor and signing your own sessions out
 * are open to every role, because they only ever reach the row you are already
 * holding a session for - see app/admin/_lib/security-actions.js, which passes
 * admin.id from the session and never an id from a form.
 */

/** Every role a row may carry, and the CHECK in db/schema.sql agrees. */
export const ROLES = ['owner', 'staff'];

/** The default for a row written by code that has not been told otherwise. */
export const DEFAULT_ROLE = 'staff';

/**
 * The permissions, listed per role rather than per permission.
 *
 * Written out in full for staff instead of as owner-minus-a-few, because a
 * permission added later should have to be granted deliberately. The failure
 * mode of the other arrangement is a new power silently landing in both roles.
 */
export const PERMISSIONS = {
  owner: [
    'orders:read', 'orders:write',
    'products:read', 'products:write',
    'offers:read', 'offers:write',
    'subscribers:read', 'subscribers:write', 'subscribers:export',
    'accounts:read', 'accounts:manage',
  ],
  staff: [
    'orders:read', 'orders:write',
    'products:read',
    'subscribers:read',
  ],
};

const SETS = Object.fromEntries(
  Object.entries(PERMISSIONS).map(([role, list]) => [role, new Set(list)]),
);

/** Every permission any role has. Used by the tests to catch a typo in a call. */
export const ALL_PERMISSIONS = [...new Set(Object.values(PERMISSIONS).flat())].sort();

/**
 * Whether a role may do a thing.
 *
 * Unknown role, unknown permission, null, undefined: false. An authorisation
 * helper that answers "I do not know" with anything other than no is a hole,
 * and this one is called from server actions where the alternative to a clear
 * false is a screen somebody should not be looking at.
 */
export function can(role, permission) {
  return SETS[String(role)]?.has(String(permission)) === true;
}

/** True only for the role that may manage other accounts. */
export const isOwner = role => String(role) === 'owner';

/** A role from a form, or null. Never trust the string that arrived. */
export function cleanRole(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  return ROLES.includes(s) ? s : null;
}
