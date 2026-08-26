'use client';

import { readCart, writeCart } from './cart.js';

/**
 * The browser half of the session.
 *
 * One job that matters: when the access token expires — every fifteen minutes
 * — the next request comes back 401, and the customer must not see that. This
 * retries it once through /api/auth/refresh, which swaps the rotating refresh
 * cookie for a new pair, and only gives up if that fails too.
 *
 * A single in-flight refresh is shared. Without that, a page that fires four
 * requests on load turns one expiry into four concurrent rotations, and since
 * rotation invalidates the token it just consumed, three of them would be
 * treated as replay — which revokes the whole family and logs the customer
 * out. That failure mode is the reason this is a module and not a one-liner.
 */

let refreshing = null;

async function refreshOnce() {
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
      .then(r => r.ok)
      .catch(() => false)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

/** fetch, with one transparent refresh-and-retry on 401. */
export async function authFetch(url, options = {}) {
  const init = {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  };

  let res = await fetch(url, init);
  if (res.status !== 401) return res;

  if (!(await refreshOnce())) return res;
  return fetch(url, init);
}

/** The signed-in customer, or null. */
export async function fetchMe() {
  try {
    const res = await authFetch('/api/auth/me');
    if (!res.ok) return null;
    return (await res.json()).user || null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ cart --- */

/**
 * Pushes the local basket to the account.
 *
 * The local copy stays the source of truth while a page is open — it is
 * synchronous, and every existing component already reads it. This just mirrors
 * it to the server so the basket is there on the next device. A failure is
 * deliberately silent: a cart that did not sync is a smaller problem than an
 * error message over a shop.
 */
export async function pushCart(cart = readCart()) {
  try {
    await authFetch('/api/cart', {
      method: 'PUT',
      body: JSON.stringify({ cart }),
    });
  } catch {
    /* offline, or signed out — the local cart is unaffected */
  }
}

/** Pulls the account basket into local storage, replacing what is there. */
export async function pullCart() {
  try {
    const res = await authFetch('/api/cart');
    if (!res.ok) return null;
    const { cart } = await res.json();
    if (Array.isArray(cart)) writeCart(cart);
    return cart;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ auth --- */

async function post(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  return { ok: res.ok, status: res.status, ...data };
}

/** Signs in, handing the guest basket over so it is not lost. */
export async function login(email, password) {
  const result = await post('/api/auth/login', { email, password, cart: readCart() });
  if (result.ok && Array.isArray(result.cart)) writeCart(result.cart);
  return result;
}

export async function register(fields) {
  return post('/api/auth/register', { ...fields, cart: readCart() });
}

export async function logout() {
  const result = await post('/api/auth/logout');
  // The basket belonged to the account, so it does not stay on a shared
  // machine after the account leaves it.
  writeCart([]);
  return result;
}

export const logoutEverywhere = () => post('/api/auth/logout-all');
