/** Customer addresses must be deliverable by our configured mail provider. */
export function isEmail(value) {
  const email = String(value ?? '');
  // Resend rejects non-ASCII recipients, including invisible pasted characters.
  return email.length <= 190 && /^[\x21-\x7e]+$/.test(email)
    && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}
