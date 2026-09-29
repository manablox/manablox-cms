import { environmentRoutes } from './routes/environments.js';
import { events } from './routes/events.js';
import { groupRoutes } from './routes/groups.js';
import { instance, instanceState, state } from './routes/instance.js';
import { catalogue, settingsRoutes } from './routes/settings.js';
import { snapshotRoutes } from './routes/snapshots.js';
import { spaceRoutes } from './routes/spaces.js';
import { usageRoutes } from './routes/usage.js';
import { userRoutes } from './routes/users.js';

export type { ControlContext } from './base.js';

/** The control API's procedures; the order is the order of the OpenAPI document. */
export const controlRouter = {
  instance,
  catalogue,
  settings: settingsRoutes,
  groups: groupRoutes,
  spaces: spaceRoutes,
  environments: environmentRoutes,
  snapshots: snapshotRoutes,
  users: userRoutes,
  usage: usageRoutes,
  events,
  instanceState,
  state,
};
