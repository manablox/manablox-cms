import { decryptSecret } from '@manablox/core/node';
import { parseJson, type StoredOidc, type StoredSaml } from './stored.js';

/** Decrypts the client secret inside a stored OIDC config. */
function revealOidc(config: string, secret: string): string {
  const parsed = parseJson<Partial<StoredOidc>>(config);
  if (!parsed?.clientSecret) return config;
  try {
    return JSON.stringify({ ...parsed, clientSecret: decryptSecret(parsed.clientSecret, secret) });
  } catch {
    return config;
  }
}

/** The adapter methods that read or write provider rows. */
interface SsoAdapter {
  findOne(args: { model: string }): Promise<unknown>;
  findMany(args: { model: string }): Promise<unknown[]>;
  update(args: { model: string }): Promise<unknown>;
  transaction?: ((cb: (trx: SsoAdapter) => Promise<unknown>) => Promise<unknown>) | undefined;
}

/** Decrypts the SP private key inside a stored SAML config, for signing and decryption. */
function revealSaml(config: string, secret: string): string {
  const parsed = parseJson<StoredSaml>(config);
  if (!parsed?.spMetadata?.privateKey) return config;
  try {
    const privateKey = decryptSecret(parsed.spMetadata.privateKey, secret);
    const encrypted = parsed.idpMetadata?.isAssertionEncrypted === true;
    return JSON.stringify({
      ...parsed,
      spMetadata: {
        ...parsed.spMetadata,
        privateKey,
        ...(encrypted ? { encPrivateKey: privateKey } : {}),
      },
    });
  } catch {
    return config;
  }
}

function revealRow(row: unknown, secret: string): unknown {
  const { oidcConfig, samlConfig } = (row ?? {}) as { oidcConfig?: unknown; samlConfig?: unknown };
  if (typeof oidcConfig === 'string') {
    return { ...(row as object), oidcConfig: revealOidc(oidcConfig, secret) };
  }
  if (typeof samlConfig === 'string') {
    return { ...(row as object), samlConfig: revealSaml(samlConfig, secret) };
  }
  return row;
}

/** An adapter handing better-auth provider rows with their client secret and SP key decrypted. */
function revealingAdapter<A extends object>(adapter: A, secret: string): A {
  return new Proxy(adapter, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      const call = value as (...args: unknown[]) => Promise<unknown>;
      if (key === 'findOne' || key === 'update') {
        return async (args: { model: string }) => {
          const row = await call.call(target, args);
          return args.model === 'ssoProvider' ? revealRow(row, secret) : row;
        };
      }
      if (key === 'findMany') {
        return async (args: { model: string }) => {
          const rows = (await call.call(target, args)) as unknown[];
          return args.model === 'ssoProvider' ? rows.map((row) => revealRow(row, secret)) : rows;
        };
      }
      if (key === 'transaction') {
        return (cb: (trx: SsoAdapter) => Promise<unknown>) =>
          call.call(target, (trx: SsoAdapter) => cb(revealingAdapter(trx, secret)));
      }
      return call.bind(target);
    },
  });
}

/** Wraps a better-auth adapter factory so provider secrets are decrypted when read. */
export function withSsoSecrets<F extends (...args: never[]) => object>(
  factory: F,
  secret: string,
): F {
  return ((...args: Parameters<F>) => revealingAdapter(factory(...args), secret)) as F;
}
