import { ref } from 'vue';

/** The node being dragged in the content tree; dragover handlers cannot read the payload. */
export const dragging = ref<string | null>(null);
