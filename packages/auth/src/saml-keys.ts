import { generateKeyPair, randomBytes, sign } from 'node:crypto';
import { promisify } from 'node:util';

const generate = promisify(generateKeyPair);

/** DER: a tag with its length and content. */
function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const length =
    body.length < 0x80
      ? Buffer.from([body.length])
      : body.length < 0x100
        ? Buffer.from([0x81, body.length])
        : Buffer.from([0x82, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
}

const sequence = (...parts: Buffer[]) => der(0x30, ...parts);
const SHA256_RSA = Buffer.from('06092a864886f70d01010b0500', 'hex');
const COMMON_NAME = Buffer.from('0603550403', 'hex');
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function utcTime(date: Date): Buffer {
  const text = date.toISOString().replace(/[-:T]/g, '').slice(2, 14);
  return der(0x17, Buffer.from(`${text}Z`));
}

function name(commonName: string): Buffer {
  return sequence(der(0x31, sequence(COMMON_NAME, der(0x0c, Buffer.from(commonName)))));
}

/** PEM body lines of 64 characters. */
const pem = (label: string, body: Buffer) =>
  `-----BEGIN ${label}-----\n${body
    .toString('base64')
    .replace(/(.{64})/g, '$1\n')
    .trim()}\n-----END ${label}-----\n`;

export interface SamlKeyPair {
  /** Self-signed X.509 certificate, PEM. */
  certificate: string;
  /** PKCS#8 private key, PEM. */
  privateKey: string;
}

/** An RSA 2048 key pair with a self-signed certificate valid from yesterday for `years`. */
export async function generateSamlKeys(commonName: string, years = 10): Promise<SamlKeyPair> {
  const { publicKey, privateKey } = await generate('rsa', { modulusLength: 2048 });
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const until = new Date(from.getTime() + years * YEAR_MS);
  const serial = randomBytes(16);
  // A positive DER INTEGER in minimal form: a clear top bit, and a first byte that is not
  // zero, as a leading zero before a byte under 0x80 is padding OpenSSL refuses to parse.
  serial[0] = ((serial[0] as number) & 0x7f) | 0x40;
  const tbs = sequence(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, serial),
    sequence(SHA256_RSA),
    name(commonName.slice(0, 64)),
    sequence(utcTime(from), utcTime(until)),
    name(commonName.slice(0, 64)),
    publicKey.export({ type: 'spki', format: 'der' }),
  );
  const signature = sign('RSA-SHA256', tbs, privateKey);
  const certificate = sequence(tbs, sequence(SHA256_RSA), der(0x03, Buffer.from([0]), signature));
  return {
    certificate: pem('CERTIFICATE', certificate),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

const xmlAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** The base64 body of a PEM certificate. */
const certificateBody = (certificate: string) =>
  certificate.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');

function keyDescriptor(use: 'signing' | 'encryption', certificate: string): string {
  return `<md:KeyDescriptor use="${use}"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>${certificateBody(certificate)}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>`;
}

/** SP metadata with the signing certificate, and the encryption one when assertions are encrypted. */
export function spMetadataXml(input: {
  entityId: string;
  acs: string;
  certificate: string;
  signRequests: boolean;
  encryptAssertions: boolean;
}): string {
  return [
    '<?xml version="1.0"?>',
    `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${xmlAttr(input.entityId)}">`,
    `<md:SPSSODescriptor AuthnRequestsSigned="${input.signRequests}" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">`,
    keyDescriptor('signing', input.certificate),
    input.encryptAssertions ? keyDescriptor('encryption', input.certificate) : '',
    `<md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${xmlAttr(input.acs)}" index="0" isDefault="true"/>`,
    '</md:SPSSODescriptor>',
    '</md:EntityDescriptor>',
  ].join('');
}
