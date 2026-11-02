import type { PageDesign, PageSeo, SiteDocument } from '@manablox/site';
import type { DesignField } from './bindings';
import { sampleFields } from './sample-data';
import { sampleDocument } from './site-preview';

export type SeoPart = keyof PageSeo;

const fitsSeo = (field: DesignField, part: SeoPart): boolean =>
  field.settings?.multiple !== true &&
  (part === 'image'
    ? field.type === 'asset'
    : (field.type === 'string' && field.settings?.editor !== 'code') || field.type === 'richtext');

/** Top-level fields a page's description or share image can come from. */
export function seoFieldOptions(fields: readonly DesignField[], part: SeoPart) {
  return fields
    .filter((field) => !field.id.startsWith('$') && fitsSeo(field, part))
    .map((field) => ({ value: field.id, label: field.label || field.name, hint: field.type }));
}

/** The page design with one SEO field set or cleared; an empty `seo` is removed. */
export function withSeo(page: PageDesign, part: SeoPart, fieldId: string | null): PageDesign {
  const seo: PageSeo = { ...page.seo };
  if (fieldId) seo[part] = fieldId;
  else delete seo[part];
  const next: PageDesign = { ...page, seo };
  if (Object.keys(seo).length === 0) delete next.seo;
  return next;
}

/** SEO fields that point at a field the type no longer has, or one that does not fit. */
export function pageSeoIssues(page: PageDesign, fields: readonly DesignField[]): string[] {
  const out: string[] = [];
  for (const part of ['description', 'image'] as const) {
    const id = page.seo?.[part];
    if (!id) continue;
    const field = fields.find((entry) => entry.id === id);
    const what = part === 'image' ? 'share image' : 'description';
    if (!field) out.push(`The ${what} comes from a field the content type no longer has.`);
    else if (!fitsSeo(field, part))
      out.push(`The ${what} comes from "${field.label || field.name}", which cannot provide one.`);
  }
  return out;
}

/** The page design with a layout pick; an empty key follows the site settings. */
export function withPageLayout(page: PageDesign, key: string): PageDesign {
  const next: PageDesign = { ...page };
  if (key) next.layout = key;
  else delete next.layout;
  return next;
}

/** A real document in list shape, as the page sample. */
export interface PageSampleRow {
  id: string;
  localizationId: string;
  typeId: string;
  title: string;
  permalink: string | null;
  publishedAt: string | Date | null;
  fields: Record<string, unknown>;
}

/** The document a page design previews with: a real one, else generated values. */
export function pageSampleDocument(
  typeId: string,
  fields: readonly DesignField[],
  row: PageSampleRow | null,
  databag: string | null = null,
): SiteDocument {
  if (!row)
    return sampleDocument(
      typeId,
      sampleFields(
        fields.filter((field) => !field.id.startsWith('$')),
        databag,
      ),
    );
  return {
    id: row.id,
    localizationId: row.localizationId,
    typeId: row.typeId,
    title: row.title,
    permalink: row.permalink,
    publishedAt: row.publishedAt instanceof Date ? row.publishedAt.toISOString() : row.publishedAt,
    author: null,
    fields: row.fields,
  };
}
