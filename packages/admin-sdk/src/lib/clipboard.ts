import { toast } from './toast';

/** Copies with a toast; the clipboard rejects on plain HTTP, denied permission or inactive tabs. */
export async function copyText(
  text: string,
  messages: { success?: string; failure?: string } = {},
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(messages.success ?? 'Copied');
    return true;
  } catch {
    toast.error(messages.failure ?? 'Could not copy - select it and copy it by hand');
    return false;
  }
}

/** Shared messages for copying a URL. */
export const COPIED_URL = {
  success: 'URL copied',
  failure: 'Could not copy - select the URL and copy it by hand',
};
