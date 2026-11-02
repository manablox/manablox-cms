import type { ManabloxPlugin } from '@manablox/core';
import { manabloxFields } from '@manablox/fields';
import { webhooksPlugin } from '@manablox/plugin-webhooks';
import { workflowsPlugin } from '@manablox/plugin-workflows';

/** The instance's plugins; the migrate command reads them without the rest of the config. */
export const plugins: ManabloxPlugin[] = [manabloxFields(), workflowsPlugin(), webhooksPlugin()];
