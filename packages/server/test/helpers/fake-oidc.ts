import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** The claims the next sign-in hands out. */
interface FakeUser {
  sub: string;
  email: string;
  name?: string;
  email_verified?: boolean;
}

export interface FakeOidcProvider {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** A code for `user`, as the IdP would add to the redirect after its sign-in. */
  codeFor(user: FakeUser): string;
  /** Client secrets the token endpoint received. */
  presentedSecrets: string[];
  close(): Promise<void>;
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** A minimal OpenID provider on a local port: discovery, JWKS and a code-for-token endpoint. */
export async function startFakeOidc(): Promise<FakeOidcProvider> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const clientId = 'manablox-test-client';
  const clientSecret = `secret-${randomBytes(8).toString('hex')}`;
  const codes = new Map<string, FakeUser>();
  const presentedSecrets: string[] = [];
  let issuer = '';

  const idToken = (user: FakeUser) => {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key' }));
    const body = b64url(
      JSON.stringify({
        iss: issuer,
        aud: clientId,
        iat: now,
        exp: now + 300,
        email_verified: true,
        ...user,
      }),
    );
    const signature = sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey);
    return `${header}.${body}.${b64url(signature)}`;
  };

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', issuer);
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/openid-configuration') {
      return send(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
      });
    }
    if (url.pathname === '/jwks') return send(200, { keys: [jwk] });
    if (url.pathname === '/token' && request.method === 'POST') {
      let raw = '';
      request.on('data', (chunk) => {
        raw += chunk;
      });
      request.on('end', () => {
        const form = new URLSearchParams(raw);
        const basic = request.headers.authorization?.replace(/^Basic /, '') ?? '';
        const [id, secret] = Buffer.from(basic, 'base64').toString('utf8').split(':');
        presentedSecrets.push(decodeURIComponent(secret ?? ''));
        if (
          decodeURIComponent(id ?? '') !== clientId ||
          decodeURIComponent(secret ?? '') !== clientSecret
        ) {
          return send(401, { error: 'invalid_client' });
        }
        const user = codes.get(form.get('code') ?? '');
        if (!user) return send(400, { error: 'invalid_grant' });
        codes.delete(form.get('code') ?? '');
        send(200, {
          access_token: `access-${randomBytes(8).toString('hex')}`,
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: idToken(user),
        });
      });
      return;
    }
    send(404, { error: 'not_found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    issuer,
    clientId,
    clientSecret,
    presentedSecrets,
    codeFor(user) {
      const code = randomBytes(12).toString('hex');
      codes.set(code, user);
      return code;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
