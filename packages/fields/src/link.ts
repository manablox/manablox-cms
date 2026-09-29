import { defineFieldType, isSafeHref, type LinkValue, normalizeExternalUrl } from '@manablox/core';
import { z } from 'zod';

export const linkSettings = z.object({
  allowInternal: z.boolean().default(true),
  allowExternal: z.boolean().default(true),
  /** Content type ids an internal link may point at. Empty means any. */
  types: z.array(z.string()).default([]),
  /** Without it the document's title is the label. */
  allowLabel: z.boolean().default(true),
  /** With it off, every link uses `defaultTarget`. */
  allowTarget: z.boolean().default(true),
  defaultTarget: z.enum(['_self', '_blank']).default('_self'),
});

export type LinkSettings = z.infer<typeof linkSettings>;

/** An internal document or external address; both modes share one shape. */
export const linkField = defineFieldType<LinkSettings, LinkValue | null>({
  name: 'link',
  label: 'Link',
  icon: 'i-lucide-link-2',
  description: 'A document in this space or an address elsewhere, with a tab choice.',

  settingsSchema: linkSettings,

  /** Settings arrive undefaulted, so each is read as on unless explicitly off. */
  valueSchema: (settings) => {
    const allowInternal = settings.allowInternal !== false;
    const allowExternal = settings.allowExternal !== false;
    const allowTarget = settings.allowTarget !== false;
    const defaultTarget = settings.defaultTarget === '_blank' ? '_blank' : '_self';

    return z
      .object({
        mode: z.enum(['internal', 'external']),
        contentId: z.string().uuid().nullable().default(null),
        url: z.string().max(2000).nullable().default(null),
        target: z.enum(['_self', '_blank']).default(defaultTarget),
        label: z.string().max(500).nullable().default(null),
      })
      .transform((value) => ({
        ...value,
        // A scheme-less address is a website, not a relative path.
        url: value.url ? normalizeExternalUrl(value.url) : null,
        target: allowTarget ? value.target : defaultTarget,
      }))
      .superRefine((value, ctx) => {
        if (value.mode === 'internal') {
          if (!allowInternal) {
            ctx.addIssue({ code: 'custom', message: 'internal links are not allowed here' });
          }
          if (!value.contentId) {
            ctx.addIssue({
              code: 'custom',
              path: ['contentId'],
              message: 'pick a document',
            });
          }
          return;
        }
        if (!allowExternal) {
          ctx.addIssue({ code: 'custom', message: 'external links are not allowed here' });
        }
        if (!value.url) {
          ctx.addIssue({ code: 'custom', path: ['url'], message: 'enter an address' });
          return;
        }
        // Refuse executable hrefs here rather than in every renderer.
        if (!isSafeHref(value.url)) {
          ctx.addIssue({ code: 'custom', path: ['url'], message: 'not a usable address' });
        }
      })
      .nullable() as never;
  },

  defaultValue: () => null,
  storage: { kind: 'jsonb', index: false },
  filters: ['isNull', 'isNotNull'],
  graphql: { type: { kind: 'link' } },
  search: (value) => [value?.label, value?.url].filter(Boolean).join(' ') || null,
  references: (value) =>
    value?.mode === 'internal' && value.contentId
      ? [{ target: 'content' as const, id: value.contentId }]
      : [],

  admin: { input: 'link', settings: 'link' },
});
