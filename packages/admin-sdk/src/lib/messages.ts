import type { ErrorKey } from '@manablox/core';
import { errorDetails, errorKey } from './api';

/** Server error keys as sentences; a missing entry falls back to the key. */

/** Toast for a save with field errors. */
export const NOT_SAVED = 'Not saved - see the errors marked';

const MESSAGES: Partial<Record<ErrorKey, string>> = {
  'auth.unauthorized': 'You are not signed in.',
  'auth.forbidden': 'You do not have permission to do that.',
  'auth.superadminRequired': 'Only an instance administrator can do that.',
  'auth.signUp.closed':
    'Sign-up is closed. Ask an instance administrator to create an account for you.',
  'auth.tooManyAttempts': 'Too many attempts - wait a moment and try again.',
  'auth.mail.notConfigured': 'This installation cannot send mail.',
  'auth.mails.tooMany': 'Too many mails to this account - wait a while and try again.',
  'auth.email.unverified':
    'Confirm your email address first - we sent you a link. Check your inbox and try again.',
  'auth.email.tokenInvalid': 'This link is invalid or has expired. Ask for a new one.',
  'auth.twoFactor.enrolmentRequired': 'Set up two-factor authentication before you continue.',
  'auth.twoFactor.required':
    'Two-factor authentication is required for your account and cannot be turned off.',
  'auth.twoFactor.policyNeedsFeature':
    'Two-factor authentication is not available on this instance, so it cannot be required.',
  'auth.sso.required':
    'Your organisation signs in with single sign-on - use the single sign-on button instead of a password.',
  'auth.sso.disabled': 'Single sign-on is not available on this instance at the moment.',
  'auth.sso.unknown': 'That single sign-on provider is not set up here any more.',
  'auth.sso.domain':
    'Your identity provider signed you in with an address this provider is not set up for.',
  'auth.sso.banned': 'This account is blocked. Ask an instance administrator.',
  'auth.sso.noAccount':
    'There is no account for your address yet. Ask an instance administrator to invite you.',
  'auth.sso.seats':
    'No new accounts can be added at the moment - the account limit is reached. Ask an instance administrator.',
  'sso.notFound': 'That single sign-on provider no longer exists.',
  'sso.validation.failed': 'The provider could not be saved - see the fields marked.',
  'sso.providerId.invalid':
    'Use 2 to 63 lower-case letters, digits and dashes, starting with a letter or digit.',
  'sso.providerId.taken': 'Another provider already uses this id.',
  'sso.protocol.required': 'Set up either OpenID Connect or SAML.',
  'sso.url.invalid': 'Enter a full http or https address.',
  'sso.clientId.required': 'Enter the client id from the identity provider.',
  'sso.clientSecret.required': 'Enter the client secret from the identity provider.',
  'sso.discovery.failed': 'The identity provider could not be reached: {reason}',
  'sso.certificate.invalid': 'This is not a readable X.509 certificate (PEM).',
  'sso.entityId.required': 'Enter the identity provider entity id.',
  'sso.domains.required': 'Add at least one email domain.',
  'sso.domain.invalid': '{domain} is not a domain name.',
  'sso.domain.taken': '{domain} already signs in with {provider}.',
  'sso.landingPath.invalid': 'Enter a path in the admin that starts with /, for example /spaces.',
  'rateLimit.exceeded': 'Too many requests - wait a moment and try again.',
  'control.feature': 'This feature is not available here.',
  'control.limit': 'The limit of {amount} {where} is reached - remove some before adding more.',
  'control.usage': 'The allowance for this period ({max}) is used up until the next period starts.',
  'control.readOnly': 'This is read-only at the moment - changes are not saved.',
  'control.suspended': 'This instance is suspended - nothing can be changed at the moment.',
  'service.unavailable': 'This is unavailable at the moment.',
  'request.invalid': 'The server could not read that request.',
  'internal.error': 'Something went wrong on the server.',
  'route.notFound': 'The server has nothing at that address.',
  'graphql.query.tooDeep': 'That query nests deeper than the {maxDepth} levels allowed.',
  'graphql.query.tooComplex':
    'That query asks for too much at once (limit {maxComplexity}) - request fewer fields or a smaller limit.',
  'graphql.introspection.disabled': 'This GraphQL endpoint does not share its schema.',
  'graphql.persisted.required': 'This GraphQL endpoint only runs its registered queries.',
  'graphql.persisted.notFound': 'This GraphQL endpoint does not know that registered query.',

  'space.notFound': 'That space no longer exists.',
  'space.machineName.taken': 'Another space already uses that technical name.',
  'space.defaultLocale.notInLocales': "The default locale must be one of the space's locales.",
  'space.plugin.unknown': 'No plugin "{plugin}" takes part in creating spaces.',
  'space.plugin.off': 'The plugin "{plugin}" is switched off for new spaces.',
  'space.plugin.invalid': 'The plugin settings for the new space are invalid: {message}',
  'space.member.lastOwner': 'A space needs at least one owner - promote someone else first.',
  'space.member.roleNotFound': 'That role does not exist in this space.',
  'space.assets.mimeType.outsideInstance': 'The instance does not allow that file type.',
  'space.assets.mimeType.outsideControl': 'This instance is set up to refuse that file type.',
  'space.assets.maxFileSize.aboveInstance': 'Larger than the instance allows.',
  'space.assets.maxFileSize.aboveControl': 'Larger than this space may accept.',
  'space.import.notAnExport': 'That file is not a Manablox space export.',
  'space.import.assetsRefused':
    'Some files in the export are too large, or of a type this instance does not accept.',
  'space.import.versionUnsupported': 'That export was written by a newer version of Manablox.',
  'space.import.typeMissing':
    'Some documents use a content type that is neither in the file nor on this instance - include the content types, or add them to the config first.',
  'space.import.exists':
    'This instance already holds that space. An import restores it under its original id, so it cannot be duplicated here.',
  'space.import.failed':
    'The import stopped partway. The space is kept as failed - resume or delete it under Settings, Spaces.',
  'space.import.notResumable': 'That import cannot be resumed - delete the space and import again.',
  'space.import.running': 'That import is still running.',
  'space.importing': 'This space is still importing - it takes no edits until the import finishes.',
  'snapshot.notFound':
    'That snapshot no longer exists - it may have been removed after its retention.',
  'snapshot.unsupported': 'This installation keeps no snapshots: its storage cannot list files.',
  'snapshot.confirmMismatch': 'Type the technical name of the space to confirm the restore.',
  'snapshot.ownerOnly': 'Only an owner of the space can restore a snapshot.',
  'space.starter.typeTaken':
    'The template needs type names this instance already defines in code ({names}) - pick another template or create an empty space.',

  'apiHost.notFound': 'That API host no longer exists.',
  'apiHost.validation.failed': 'The API host could not be saved - see the fields marked.',
  'apiHost.hostname.invalid': 'Enter a host name like api.example.com, without http:// or a path.',
  'apiHost.hostname.taken': 'That host name is already in use.',
  'redirect.notFound': 'That redirect no longer exists.',
  'redirect.validation.failed': 'The redirect could not be saved - see the fields marked.',
  'redirect.path.invalid': 'Enter a path that starts with /, like /old-page.',
  'redirect.target.required': 'Pick a document or enter a path to redirect to.',
  'redirect.target.self': 'A redirect cannot point at its own path.',
  'redirect.target.loop': 'That target would send visitors round in a loop.',
  'redirect.fromPath.taken': 'Another redirect already starts at {fromPath}.',
  'redirect.locale.unknown': 'This space does not have the locale "{locale}".',

  'tag.notFound': 'That tag no longer exists.',
  'tag.name.required': 'A tag needs a name.',
  'tag.name.taken': 'This space already has a tag with that name.',
  'tag.merge.sameTag': 'Pick a different tag to merge into.',

  'content.notFound': 'That document no longer exists.',
  'content.title.required': 'A title is required.',
  'content.slug.required': 'A slug is required.',
  'content.slug.duplicate': 'Another document at this level already uses that slug.',
  'content.version.conflict': 'Someone else saved this document while you were editing.',
  'content.parent.cycle': 'A document cannot be moved beneath itself.',
  'content.parent.otherLocale': 'A document cannot be moved under a page in another language.',
  'content.parent.isData': 'A databag entry cannot hold other documents.',
  'content.data.hasParent': 'A databag entry has no place in the tree.',
  'content.translation.exists': 'That translation already exists.',
  'content.type.notPublishable': 'Documents of this type cannot be published.',
  'content.schedule.notPublishable': 'Documents of this type cannot be scheduled.',
  'content.schedule.invalidWindow': 'The unpublish date must come after the publish date.',
  'asset.schedule.invalidWindow': 'The unpublish date must come after the publish date.',
  'asset.spaces.required': 'An asset has to stay in at least one space.',
  'asset.spaces.forbidden': 'You cannot add or remove this asset in one of those spaces.',
  'content.approval.notRequired': 'Documents of this type are published without review.',
  'content.approval.alreadyPending': 'This document is already waiting for approval.',
  'content.approval.notPending': 'This document is not waiting for approval.',
  'content.approval.notRequester': 'Only whoever asked for approval can withdraw the request.',
  'field.required': 'This is required.',
  'field.unique': 'Another document of this type already uses this value.',
  'field.databag.notFound': 'Pick a databag type of this space.',

  'contentType.name.invalid': 'Use lower-case letters, digits, hyphens and underscores.',
  'contentType.name.duplicate': 'Another content type already uses that technical name.',
  'contentType.inUse': 'Documents of this type still exist; delete them first.',
  'contentType.code.immutable': 'This type is defined in code and cannot be edited here.',
  'contentType.plugin.unknown': 'No loaded plugin takes the data this content type brings for it.',
  'contentType.plugin.invalid': 'The data this content type brings for a plugin is not valid.',
  'contentType.data.flagsNotAllowed':
    'A databag type has no slug, no place in the tree and no menu entries.',
  'credential.code.immutable': 'This credential is declared in code and cannot be removed here.',
  'content.code.immutable': 'This document is managed in code and cannot be edited here.',
  'contentType.field.name.invalid': 'Use lower-case letters, digits, hyphens and underscores.',
  'contentType.field.name.duplicate': 'Another field already uses that technical name.',
  'contentType.field.name.immutable': 'A saved field cannot be renamed.',
  'contentType.field.type.notFound': 'That field type is not installed on this instance.',
  'contentType.field.blockType.notFound': 'One of the chosen block types no longer exists.',
  'contentType.field.blockType.notABlock': '"{name}" is not a block type.',
  'contentType.field.subFields.tooDeep':
    'A repeater inside a repeater cannot hold another repeater. Two levels are the limit.',
  'contentType.plan.empty': 'The plan holds no content types.',
  'contentType.plan.name.duplicate': 'The plan names the same type twice.',
  'contentType.plan.reference.unknown':
    'A field refers to a type that is neither in the plan nor in this space.',
  'contentType.plan.reference.wrongKind':
    'A block field has to name block types, and a relation document types.',

  'user.notFound': 'That account no longer exists.',
  'user.email.taken': 'Another account already uses that email address.',
  'user.password.incorrect': 'That is not your current password.',
  'user.password.sameAsCurrent': 'Choose a password you are not already using.',
  'user.email.same': 'That is already your email address.',

  'invitation.notFound': 'That invitation no longer exists.',
  'invitation.invalid': 'This invitation is no longer valid. Ask for a new one.',
  'invitation.expired': 'This invitation has expired. Ask for a new one.',
  'invitation.grants.required': 'Choose at least one space for the invitation.',
  'invitation.grant.duplicate': 'Each space can be chosen only once.',
  'invitation.role.unknown': 'That role does not exist in the chosen space.',
  'invitation.space.notFound': 'One of the chosen spaces no longer exists.',
  'invitation.signInRequired':
    'An account with this email address exists. Sign in with it to accept the invitation.',
  'invitation.emailMismatch':
    'This invitation is for another email address. Sign out and sign in with that one.',
  'notification.notFound': 'That notification no longer exists.',
  'user.self.protected': 'You cannot do that to your own account.',
  'user.lastSuperadmin':
    'The instance needs at least one administrator - promote someone else first.',

  'asset.notFound': 'That asset no longer exists.',
  'asset.file.required': 'Choose a file to upload.',
  'asset.file.single': 'Upload one file at a time.',
  'asset.tooLarge': 'That file is larger than this space accepts.',
  'asset.mimeType.notAllowed': 'That file type is not allowed in this space.',
  'apiKey.validation.failed': 'The key could not be issued - see the permissions marked.',
  'role.notFound': 'That role no longer exists.',
  'role.validation.failed': 'The role could not be saved - see the fields marked.',
  'role.inUse': 'Members still hold this role - give them another one first.',
  'role.name.required': 'A name is required.',
  'role.machineName.invalid':
    'Use lower-case letters, digits, dashes and underscores, starting with a letter.',
  'role.machineName.reserved': 'That name belongs to a built-in role.',
  'role.machineName.taken': 'Another role in this space already uses that technical name.',
  'role.permission.unknown': 'One of the permissions is not known to the server.',
  'environment.notFound': 'That environment no longer exists.',
  'environment.forbidden': 'This API key may not be used in that environment.',
  'environment.machineName.invalid':
    'Use lower-case letters, digits, dashes and underscores, starting with a letter, and not "production".',
  'environment.machineName.taken': 'This space already has an environment with that name.',
  'environment.production.undeletable': 'The production environment cannot be deleted.',
  'environment.promote.notStaging': 'Only a staging environment can be promoted.',
  'environment.promote.confirmRequired': 'Check the changes and confirm the promote first.',
  'environment.promote.failed': 'Part of the promote could not be written.',
  'environment.unsupported': 'Environments are not available on this instance.',
  'menu.notFound': 'That menu no longer exists.',
  'menu.machineName.taken': 'Another menu in this space already uses that technical name.',
  'menu.validation.failed': 'The menu could not be saved - see the entries marked below.',
  'menu.item.targetRequired': 'An entry needs a document or a link address.',
  'menu.item.linkNeedsLabel': 'A link entry needs a label.',
  'menu.item.contentNotFound': 'That document no longer exists in this space.',
  'menu.item.typeNotAllowed': 'Documents of this type cannot appear in menus.',

  'audit.notFound': 'That activity entry does not exist in this space.',
  'net.blocked': 'That address is not one this instance may reach.',
  'net.tooLarge': 'The answer was larger than this instance may read.',
  'net.tooManyRedirects': 'That address redirected too many times.',
  'secret.keyMissing':
    'The instance has no secret configured, so keys and credentials cannot be stored.',
  'secret.undecryptable':
    'The stored key cannot be read - the instance secret has changed. Enter the key again.',
  'credential.validation.failed': 'The credential could not be saved - see the parts marked.',
  'credential.notFound': 'That credential no longer exists.',
  'credential.name.required': 'A name is required.',
  'credential.slug.invalid': 'That name cannot be turned into an identifier.',
  'credential.slug.taken': 'Another credential already goes by that name.',
  'credential.kind.unknown': 'The server does not know that kind of credential.',
  'credential.field.required': 'This is required.',
  'credential.create.failed': 'The credential could not be saved.',
  'credential.oauth.exchangeFailed':
    'The refresh token could not be exchanged - check the client id, secret and token endpoint.',
  'mail.notConfigured': 'This instance has no mail transport configured (MAIL_DRIVER).',
  'mail.tokenMissing': '{provider} handed back no access token.',
  'mail.serviceStatus': '{service} answered with HTTP {status}: {reason}',
  'push.notConfigured': 'This instance has no push keys configured (PUSH_VAPID_*).',
  'push.subscriptionInvalid': 'The browser handed over a subscription the server cannot use.',
  'push.subscription.createFailed': 'The push subscription could not be saved.',

  'asset.notAnImage': 'Only an image can be cropped or given a focal point.',
  'asset.crop.outOfBounds': 'The crop does not fit inside the image.',
  'asset.focalPoint.outOfBounds': 'The focal point has to be inside the image.',
};

/** Plugin error sentences by key, from the server's plugin catalogue. */
const PLUGIN_MESSAGES: Record<string, string> = {};

/** The sentence for an error, from its first detail or its own key. */
export function messageFor(error: unknown): string {
  const detail = errorDetails(error)[0];
  // Schema issue sentences only make sense next to their field, so toast a generic one.
  if (detail?.key === 'validation.invalid') {
    return 'Something entered is missing or not in a form that is accepted.';
  }
  const key = detail?.key ?? errorKey(error);
  // A plugin key the admin has no sentence for: the server's.
  const sent = (error as { data?: { message?: unknown } } | null)?.data?.message;
  if (!hasMessage(key) && typeof sent === 'string' && sent !== key) return sent;
  return messageForKey(key, detail?.params);
}

/** Adds the error sentences and limit nouns of the loaded plugins (`instance.plugins`). */
export function registerPluginMessages(
  plugins: ReadonlyArray<{
    errors: Record<string, string>;
    nouns: Record<string, [string, string]>;
  }>,
): void {
  for (const plugin of plugins) {
    Object.assign(PLUGIN_MESSAGES, plugin.errors);
    Object.assign(LIMIT_NOUNS, plugin.nouns);
  }
}

/** What each count limit counts, singular and plural. */
const LIMIT_NOUNS: Record<string, [string, string]> = {
  spaces: ['space', 'spaces'],
  seats: ['user', 'users'],
  contentTypes: ['content type', 'content types'],
  documents: ['document', 'documents'],
  databagTypes: ['databag', 'databags'],
  databagEntries: ['databag entry', 'databag entries'],
  localesPerSpace: ['locale', 'locales'],
  menusPerSpace: ['menu', 'menus'],
  apiKeys: ['API key', 'API keys'],
  customDomains: ['custom domain', 'custom domains'],
  redirectsPerSpace: ['redirect', 'redirects'],
  customRolesPerSpace: ['custom role', 'custom roles'],
  environmentsPerSpace: ['staging environment', 'staging environments'],
};

/** `2 GB`, `512 MB`, `300 KB`. */
function limitBytes(bytes: number): string {
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[unit]}`;
}

/** `{amount}` and `{where}` of a `control.limit` refusal, e.g. `50 documents`, `in this space`. */
function limitParams(params: Record<string, unknown>): Record<string, unknown> {
  const limit = String(params.limit ?? '');
  const max = Number(params.max);
  const scope = String(params.scope ?? '');
  const nouns = LIMIT_NOUNS[limit];
  const amount =
    limit === 'storageBytes'
      ? `${limitBytes(max)} of storage`
      : nouns
        ? `${max} ${max === 1 ? nouns[0] : nouns[1]}`
        : String(max);
  const where = limit.endsWith('PerSpace')
    ? 'per space'
    : scope.startsWith('space:')
      ? 'in this space'
      : scope.startsWith('group:')
        ? 'for this group of spaces'
        : 'on this instance';
  return { ...params, amount, where };
}

/** A production write refused while a promote runs. */
const PROMOTE_RUNNING =
  'A promote into production is running - production is read-only until it finishes. Try again in a moment.';

/** The sentence for one detail key, with `{param}` filled in. */
export function messageForKey(key: string, params?: Record<string, unknown>): string {
  if (key === 'control.readOnly' && params?.reason === 'promote') return PROMOTE_RUNNING;
  const explicit = params?.message;
  if (typeof explicit === 'string') return explicit;
  const template = MESSAGES[key as ErrorKey] ?? PLUGIN_MESSAGES[key];
  if (!template) return key;
  if (key === 'control.limit' && params) params = limitParams(params);
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    params && params[name] !== undefined && params[name] !== null ? String(params[name]) : whole,
  );
}

/** Whether a key has a sentence of its own. */
export const hasMessage = (key: string): boolean => key in MESSAGES || key in PLUGIN_MESSAGES;
