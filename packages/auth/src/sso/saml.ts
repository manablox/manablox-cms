import { deriveSAMLIdentityProviderEntityID } from '@better-auth/sso';
import { encryptSecret } from '@manablox/core/node';
import type { SsoProviderRow } from '@manablox/db';
import { generateSamlKeys, spMetadataXml } from '../saml-keys.js';
import { adminUrl, baseUrl, invalid, providerUrls, type SsoContext } from './context.js';
import { certificateOf, httpUrl, parseJson, pemOf, type StoredSaml } from './stored.js';
import type { SsoSamlInput } from './types.js';

const LANDING_PATH = /^\/(?![/\\])[^\s\\]*$/;

export async function samlConfig(
  ctx: SsoContext,
  providerId: string,
  input: SsoSamlInput,
  before: SsoProviderRow | null,
): Promise<StoredSaml> {
  const entryPoint = httpUrl(input.entryPoint);
  if (!entryPoint) throw invalid([{ key: 'sso.url.invalid', path: ['saml', 'entryPoint'] }]);
  const certificate = certificateOf(input.certificate);
  if (!certificate) {
    throw invalid([{ key: 'sso.certificate.invalid', path: ['saml', 'certificate'] }]);
  }
  const idpEntityId = input.idpEntityId.trim();
  if (!idpEntityId) {
    throw invalid([{ key: 'sso.entityId.required', path: ['saml', 'idpEntityId'] }]);
  }
  const spEntityId =
    input.spEntityId?.trim() ||
    (await providerUrls(ctx, providerId, 'saml')).metadata ||
    providerId;
  const cert = pemOf(input.certificate);
  const mapping = {
    ...(input.emailAttribute?.trim() ? { email: input.emailAttribute.trim() } : {}),
    ...(input.nameAttribute?.trim() ? { name: input.nameAttribute.trim() } : {}),
  };
  const landingPath = input.landingPath?.trim() || '/';
  if (!landingPathValid(ctx, landingPath)) {
    throw invalid([{ key: 'sso.landingPath.invalid', path: ['saml', 'landingPath'] }]);
  }
  const encryptAssertions = input.encryptAssertions ?? false;
  const config: StoredSaml = {
    issuer: spEntityId,
    entryPoint,
    cert,
    idpMetadata: {
      entityID: idpEntityId,
      cert,
      ...(encryptAssertions ? { isAssertionEncrypted: true } : {}),
    },
    wantAssertionsSigned: true,
    authnRequestsSigned: input.signRequests ?? false,
    idpInitiated: input.idpInitiated ?? false,
    landingPath,
    ...(Object.keys(mapping).length > 0 ? { mapping } : {}),
  };
  try {
    deriveSAMLIdentityProviderEntityID(config as never);
  } catch {
    throw invalid([{ key: 'sso.certificate.invalid', path: ['saml', 'certificate'] }]);
  }
  return withSpKeys(ctx, providerId, config, parseJson<StoredSaml>(before?.samlConfig ?? null));
}

/** The SP key pair of `previous`, or a new one, and the SP metadata publishing it. */
export async function withSpKeys(
  ctx: SsoContext,
  providerId: string,
  config: StoredSaml,
  previous: StoredSaml | null,
): Promise<StoredSaml> {
  let certificate = previous?.spCertificate;
  let privateKey = previous?.spMetadata?.privateKey;
  if (!certificate || !privateKey) {
    const host = new URL(await baseUrl(ctx)).hostname;
    const keys = await generateSamlKeys(`${providerId}.${host}`);
    certificate = keys.certificate;
    privateKey = encryptSecret(keys.privateKey, ctx.secret);
  }
  const acs = (await providerUrls(ctx, providerId, 'saml')).acs as string;
  const metadata = spMetadataXml({
    entityId: config.issuer,
    acs,
    certificate,
    signRequests: config.authnRequestsSigned === true,
    encryptAssertions: config.idpMetadata.isAssertionEncrypted === true,
  });
  return { ...config, spMetadata: { metadata, privateKey }, spCertificate: certificate };
}

/** A path on the admin's origin. */
function landingPathValid(ctx: SsoContext, path: string): boolean {
  if (path.length > 500 || !LANDING_PATH.test(path)) return false;
  try {
    const admin = new URL(adminUrl(ctx, '/'));
    return new URL(path, admin).origin === admin.origin;
  } catch {
    return false;
  }
}
