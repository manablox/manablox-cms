import { iconNames } from '@manablox/admin-sdk/vite';
import { pluginAdminTestConfig } from '@manablox/config-vitest';
import vue from '@vitejs/plugin-vue';

export default pluginAdminTestConfig([vue(), iconNames()]);
