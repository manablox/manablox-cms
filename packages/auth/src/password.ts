/** Argon2id, shared by better-auth and admin-created accounts. */
export async function hashPassword(password: string): Promise<string> {
  const { hash } = await import('@node-rs/argon2');
  return hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const { verify } = await import('@node-rs/argon2');
  return verify(stored, password);
}

/** Passed to better-auth as `minPasswordLength`. */
export const MIN_PASSWORD_LENGTH = 12;
