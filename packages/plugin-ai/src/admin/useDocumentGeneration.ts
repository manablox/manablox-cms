import { type ContentTypeSummary, type DraftDocument, htmlToRichText } from '@manablox/admin-sdk';
import { slugify } from '@manablox/core';
import { computed, ref } from 'vue';
import { assetValue, type GeneratedDocument } from './model/document';
import { useWand } from './useWand';

export interface DocumentGenerationOptions {
  document: () => DraftDocument;
  contentType: () => ContentTypeSummary;
  canWrite: () => boolean;
}

/** Writes a whole AI-generated document into the editor's draft. */
export function useDocumentGeneration(options: DocumentGenerationOptions) {
  // Whole-document generation needs text fields.
  const wand = useWand('text');
  const generating = ref(false);
  const canGenerate = computed(
    () =>
      wand.enabled.value &&
      options.canWrite() &&
      // A text field, or a block or repeater field that may hold text.
      options
        .contentType()
        .fields.some((field) =>
          ['string', 'richtext', 'block', 'blocks', 'repeater'].includes(field.type),
        ),
  );

  /** Writes a generated document into the draft; the title is a column, so set by name. */
  async function apply(generated: GeneratedDocument): Promise<void> {
    const doc = options.document();
    const contentType = options.contentType();
    const fields = contentType.fields;

    for (const [name, value] of Object.entries(generated.fields)) {
      const field = fields.find((entry) => entry.name === name);
      if (!field) {
        if (name === 'title') {
          doc.title = value;
          if (contentType.hasSlug && !doc.id) doc.slug = slugify(value);
        }
        continue;
      }
      doc.fields[name] = field.type === 'richtext' ? await htmlToRichText(value) : value;
    }

    // Block values arrive laid out, edited and with pictures.
    for (const [name, value] of Object.entries(generated.blocks)) {
      const field = fields.find((entry) => entry.name === name);
      if (!field) continue;
      doc.fields[name] = field.type === 'block' ? (value.blocks[0] ?? null) : value;
    }

    // Repeater items arrive with their text sub-fields filled.
    for (const [name, value] of Object.entries(generated.items)) {
      if (fields.some((entry) => entry.name === name && entry.type === 'repeater'))
        doc.fields[name] = value;
    }

    // Then the pictures for the document's own asset fields.
    for (const image of generated.images) {
      const field = fields.find((entry) => entry.name === image.field);
      if (field && image.assetId)
        doc.fields[image.field] = assetValue(field.settings, image.assetId);
    }
  }

  return { wand, generating, canGenerate, apply };
}
