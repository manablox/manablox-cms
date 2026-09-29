import type { ApiHostService } from '../../api-host.service.js';
import type { ControlApiServices } from './types.js';

/** What the parts of `ControlApi` share: its services, with the API host service built. */
export type ControlApiContext = ControlApiServices & { apiHosts: ApiHostService };
