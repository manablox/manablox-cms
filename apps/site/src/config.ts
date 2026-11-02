import { manabloxFields } from '@manablox/fields';
import { websiteProcessConfig } from '@manablox/plugin-website/site';

/** The website mode's config: renders every designed space by the `Host` it is asked for. */
export const config = websiteProcessConfig({ plugins: [manabloxFields()] });
