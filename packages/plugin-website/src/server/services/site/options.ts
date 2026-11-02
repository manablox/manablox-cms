/** Settings of the website plugin, shared by the management API and the website mode. */
export interface WebsiteConfig {
  /** The website process origin; the admin frames its design canvas there. */
  url?: string | undefined;
  /** Admin origins that may frame `/_manablox/canvas`; none by default. */
  editorOrigin?: string | string[] | undefined;
  /** `s-maxage` for pages, in seconds. Falls back to `cache.ttl`. */
  cacheTtl?: number | undefined;
  /** Per IP; falls back to `server.rateLimit`. */
  rateLimit?: { window: number; max: number } | false | undefined;
  /**
   * Form submissions. The website process forwards them to `apiUrl`; a management instance
   * with `secret` set accepts them at `POST /plugins/website/forms/submit`.
   */
  forms?:
    | {
        /** Management API origin; website processes only. */
        apiUrl?: string | undefined;
        /** Shared bearer secret, on both processes; ignored below 16 characters. */
        secret?: string | undefined;
        /** Submissions per IP; defaults to 10 per 10 minutes. */
        rateLimit?: { window: number; max: number } | undefined;
        /** Milliseconds a forward may take; defaults to 10 seconds. */
        timeout?: number | undefined;
      }
    | undefined;
}

/** Below this a forms secret is ignored and forms stay off. */
const MIN_FORMS_SECRET = 16;

/** The forms secret when it is long enough to use. */
export function websiteFormsSecret(config: WebsiteConfig): string | null {
  const secret = config.forms?.secret ?? '';
  return secret.length >= MIN_FORMS_SECRET ? secret : null;
}
