import type { SsoProviderInput, SsoSettingsInput } from '@manablox/auth';
import { z } from 'zod';
import { superadmin, superadminWrite } from '../base.js';
import { machineName, uuid } from '../schemas.js';

const url = z.string().trim().min(1).max(2000);

const oidc = z.object({
  issuer: url,
  clientId: z.string().trim().min(1).max(500),
  /** Kept as stored when empty on an update. */
  clientSecret: z.string().max(2000).optional(),
  discoveryEndpoint: z.string().trim().max(2000).optional(),
  scopes: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
});

const saml = z.object({
  entryPoint: url,
  certificate: z.string().min(1).max(20_000),
  idpEntityId: z.string().trim().min(1).max(2000),
  spEntityId: z.string().trim().max(2000).optional(),
  emailAttribute: z.string().trim().max(500).optional(),
  nameAttribute: z.string().trim().max(500).optional(),
  signRequests: z.boolean().optional(),
  /** Unencrypted assertions are refused when on. */
  encryptAssertions: z.boolean().optional(),
  /** Unsolicited responses are accepted when on. */
  idpInitiated: z.boolean().optional(),
  /** Admin path after an IdP-initiated sign-in; `/` when empty. */
  landingPath: z.string().trim().max(500).optional(),
});

const fields = {
  name: z.string().trim().max(120),
  domains: z.array(z.string().trim().min(1).max(253)).min(1).max(50),
  oidc: oidc.optional(),
  saml: saml.optional(),
  requireSso: z.boolean().optional(),
  showOnSignIn: z.boolean().optional(),
  createAccounts: z.boolean().optional(),
  defaultGrants: z
    .array(z.object({ spaceId: uuid, role: machineName }))
    .max(50)
    .optional(),
};

// Typed by name: the inferred schema types would push the router type past what tsc emits.
const createInput: z.ZodType<SsoProviderInput, SsoProviderInput> = z.object({
  ...fields,
  providerId: z.string().trim().min(2).max(63),
});
const updateInput: z.ZodType<SsoSettingsInput & { id: string }, SsoSettingsInput & { id: string }> =
  z.object({ ...fields, id: uuid });

/** SSO providers of the instance; superadmins only. Writes need the `sso` feature. */
export const ssoRouter = {
  list: superadmin.handler(({ context }) => context.sso.list()),

  create: superadminWrite
    .input(createInput)
    .handler(({ input, context }) => context.sso.create(input)),

  /** The provider id is fixed; an empty client secret keeps the stored one. */
  update: superadminWrite
    .input(updateInput)
    .handler(({ input: { id, ...input }, context }) => context.sso.update(id, input)),

  /** Linked accounts lose the link; their sessions stay. */
  delete: superadminWrite.input(z.object({ id: uuid })).handler(async ({ input, context }) => {
    await context.sso.delete(input.id);
    return { deleted: true };
  }),

  /** A new SP key pair for a SAML provider; the IdP needs the new certificate. */
  regenerateKeys: superadminWrite
    .input(z.object({ id: uuid }))
    .handler(({ input, context }) => context.sso.regenerateKeys(input.id)),

  /** OIDC discovery, or reading a SAML certificate, before saving. */
  test: superadmin
    .input(
      z.object({
        oidc: z
          .object({ issuer: url, discoveryEndpoint: z.string().trim().max(2000).optional() })
          .optional(),
        saml: z.object({ certificate: z.string().min(1).max(20_000) }).optional(),
      }),
    )
    .handler(({ input, context }) => context.sso.test(input)),
};
