import { apiHostRouter } from './routers/api-host.js';
import { assetRouter } from './routers/asset.js';
import { auditRouter } from './routers/audit.js';
import { contentRouter } from './routers/content.js';
import { contentTypeRouter } from './routers/content-type.js';
import { credentialRouter } from './routers/credential.js';
import { environmentRouter } from './routers/environment.js';
import { instanceRouter } from './routers/instance.js';
import { invitationRouter } from './routers/invitation.js';
import { menuRouter } from './routers/menu.js';
import { notificationRouter } from './routers/notification.js';
import { preferenceRouter } from './routers/preference.js';
import { redirectRouter } from './routers/redirect.js';
import { roleRouter } from './routers/role.js';
import { snapshotRouter } from './routers/snapshot.js';
import { spaceRouter } from './routers/space.js';
import { ssoRouter } from './routers/sso.js';
import { tagRouter } from './routers/tag.js';
import { usageRouter } from './routers/usage.js';
import { userRouter } from './routers/user.js';

export * from './base.js';
export * from './context.js';
export { contentTypePlan } from './schemas.js';

/**
 * The management API's shape, by router, so its declaration stays small enough for tsc to emit;
 * a type alias, as oRPC needs the index signature an interface lacks. The admin imports it for
 * end-to-end safety.
 */
export type ManabloxRouter = {
  content: typeof contentRouter;
  contentTypes: typeof contentTypeRouter;
  spaces: typeof spaceRouter;
  assets: typeof assetRouter;
  users: typeof userRouter;
  invitations: typeof invitationRouter;
  preferences: typeof preferenceRouter;
  instance: typeof instanceRouter;
  sso: typeof ssoRouter;
  menus: typeof menuRouter;
  redirects: typeof redirectRouter;
  tags: typeof tagRouter;
  roles: typeof roleRouter;
  credentials: typeof credentialRouter;
  audit: typeof auditRouter;
  notifications: typeof notificationRouter;
  apiHosts: typeof apiHostRouter;
  usage: typeof usageRouter;
  snapshots: typeof snapshotRouter;
  environments: typeof environmentRouter;
};

/** The management API. */
export const router: ManabloxRouter = {
  content: contentRouter,
  contentTypes: contentTypeRouter,
  spaces: spaceRouter,
  assets: assetRouter,
  users: userRouter,
  invitations: invitationRouter,
  preferences: preferenceRouter,
  instance: instanceRouter,
  sso: ssoRouter,
  menus: menuRouter,
  redirects: redirectRouter,
  tags: tagRouter,
  roles: roleRouter,
  credentials: credentialRouter,
  audit: auditRouter,
  notifications: notificationRouter,
  apiHosts: apiHostRouter,
  usage: usageRouter,
  snapshots: snapshotRouter,
  environments: environmentRouter,
};
