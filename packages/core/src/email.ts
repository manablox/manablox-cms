/** A loose shape check (`a@b.c`) to keep stray words out of recipient lists. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmailAddress = (value: string): boolean => EMAIL_RE.test(value);
