import { generateSamlKeys } from '@manablox/auth';
import * as samlify from 'samlify';

const REDIRECT = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';

export interface SamlFixture {
  idpEntityId: string;
  entryPoint: string;
  certificate: string;
  /**
   * Answers an AuthnRequest from the sign-in URL with a signed login response for `nameId`;
   * `signedRequests` refuses unsigned requests, `encrypt` encrypts the assertion.
   */
  respond(input: {
    request: URL;
    spMetadata: string;
    nameId: string;
    signedRequests?: boolean;
    encrypt?: boolean;
  }): Promise<{ SAMLResponse: string; RelayState: string }>;
  /** An IdP-initiated (unsolicited) signed login response for `nameId`. */
  unsolicited(input: {
    spMetadata: string;
    nameId: string;
    encrypt?: boolean;
  }): Promise<{ SAMLResponse: string }>;
}

/** An IdP that signs assertions with a certificate made at test time. */
export async function samlFixture(): Promise<SamlFixture> {
  const idpEntityId = 'https://idp.corp.test/saml';
  const entryPoint = 'https://idp.corp.test/sso';
  const { certificate, privateKey } = await generateSamlKeys('idp.corp.test');
  const idp = (options: { signedRequests?: boolean; encrypt?: boolean } = {}) =>
    samlify.IdentityProvider({
      entityID: idpEntityId,
      privateKey,
      signingCert: certificate,
      singleSignOnService: [{ Binding: REDIRECT, Location: entryPoint }],
      wantAuthnRequestsSigned: options.signedRequests ?? false,
      isAssertionEncrypted: options.encrypt ?? false,
    });
  return {
    idpEntityId,
    entryPoint,
    certificate,
    async respond({ request, spMetadata, nameId, signedRequests, encrypt }) {
      const sp = samlify.ServiceProvider({ metadata: spMetadata });
      const provider = idp({
        ...(signedRequests !== undefined ? { signedRequests } : {}),
        ...(encrypt !== undefined ? { encrypt } : {}),
      });
      const query = Object.fromEntries(request.searchParams);
      // The signed part of the query, as sent.
      const octetString = request.search
        .slice(1)
        .split('&')
        .filter((pair) => !pair.startsWith('Signature='))
        .join('&');
      const parsed = await provider.parseLoginRequest(sp, 'redirect', { query, octetString });
      const relayState = request.searchParams.get('RelayState') ?? '';
      const response = (await provider.createLoginResponse(
        sp,
        { extract: parsed.extract },
        'post',
        { email: nameId },
        undefined,
        false,
        relayState,
      )) as { context: string };
      return { SAMLResponse: response.context, RelayState: relayState };
    },
    async unsolicited({ spMetadata, nameId, encrypt }) {
      const sp = samlify.ServiceProvider({ metadata: spMetadata });
      const response = (await idp(encrypt !== undefined ? { encrypt } : {}).createLoginResponse(
        sp,
        // No request to answer.
        { extract: {} },
        'post',
        { email: nameId },
      )) as { context: string };
      return { SAMLResponse: response.context };
    },
  };
}
