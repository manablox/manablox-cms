import { ManabloxError, type ResolvedScope, type TypeScope } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { AiProviderRef } from '../../sdk.js';
import { aiKeys } from '../keys.js';
import type { AiDesignJsonInput } from './ai/types.js';
import type { AiService } from './ai.service.js';
import {
  CONTENT_TYPE_DESIGN_SYSTEM,
  type ContentTypeDesign,
  type ContentTypeDesignScope,
  composeContentTypeDesignPrompt,
  readContentTypeDesign,
} from './design/content-types.js';
import {
  composeTemplateDesignPrompt,
  readTemplateDesign,
  TEMPLATE_DESIGN_SYSTEM,
  type TemplateDesign,
} from './design/template.js';

export interface AiDesignInput {
  /** Provider space, and unless `forNewSpace`, the types to build on. */
  spaceId: string;
  /** The environment whose types to build on; the space's production types when absent. */
  typeScope?: ResolvedScope | null | undefined;
  providerKind?: AiProviderRef | undefined;
  model?: string | undefined;
  prompt: string;
  actorId?: string | null | undefined;
  /** Allowed icon names. */
  icons?: string[] | undefined;
}

export interface AiContentTypeDesignInput extends AiDesignInput {
  scope?: ContentTypeDesignScope | undefined;
  /** Design for a new space: build on global types only. */
  forNewSpace?: boolean | undefined;
}

export interface AiTemplateDesignInput extends AiDesignInput {
  locale?: string | null | undefined;
}

/** What another plugin's design asks for; see `AiDesignService.design`. */
export interface AiDesignRequest<T> extends AiDesignJsonInput<T> {
  /** False when the checked answer holds nothing to use; the design then fails. */
  usable?: ((value: T) => boolean) | undefined;
}

/**
 * AI designs: content types and templates, and checked designs other plugins ask for (themes,
 * workflows). Returns plans only; nothing is written.
 */
export class AiDesignService {
  constructor(
    private readonly manablox: Manablox,
    private readonly ai: AiService,
  ) {}

  /**
   * A structured design another plugin checks with `check`, behind `plugins.ai.designModels`;
   * refused with `plugins.ai.design.empty` when `usable` says the answer holds nothing.
   */
  async design<T>(
    request: AiDesignRequest<T>,
  ): Promise<{ value: T; problems: string[]; generationId: string }> {
    const { usable, ...input } = request;
    await this.assertModels(input.spaceId);
    const result = await this.ai.designJson(input);
    if (usable && !usable(result.value)) throw nothingUsable(result.problems);
    return result;
  }

  async designContentTypes(
    input: AiContentTypeDesignInput,
  ): Promise<ContentTypeDesign & { problems: string[]; generationId: string }> {
    if (input.forNewSpace)
      await this.manablox.controls.assertFeature(null, aiKeys.features.designSpace);
    else await this.assertModels(input.spaceId);
    const context = {
      fieldTypes: this.manablox.fieldTypes.all,
      existing: this.existingTypes(input.forNewSpace ? null : (input.typeScope ?? input.spaceId)),
      scope: input.scope ?? 'any',
      icons: input.icons,
    };

    const result = await this.ai.designJson({
      spaceId: input.spaceId,
      providerKind: input.providerKind,
      model: input.model,
      prompt: composeContentTypeDesignPrompt(input.prompt, context),
      system: CONTENT_TYPE_DESIGN_SYSTEM,
      purpose: 'Content types',
      actorId: input.actorId,
      check: (answer) => readContentTypeDesign(answer, context),
    });
    if (!result.value.plan.types.length) {
      throw nothingUsable(result.problems);
    }
    return { ...result.value, problems: result.problems, generationId: result.generationId };
  }

  async designTemplate(
    input: AiTemplateDesignInput,
  ): Promise<TemplateDesign & { problems: string[]; generationId: string }> {
    await this.assertModels(input.spaceId);
    const context = {
      fieldTypes: this.manablox.fieldTypes.all,
      existing: this.existingTypes(input.typeScope ?? input.spaceId),
      scope: 'block' as const,
      icons: input.icons,
      locale: input.locale,
      spaceId: input.spaceId,
    };

    const result = await this.ai.designJson({
      spaceId: input.spaceId,
      providerKind: input.providerKind,
      model: input.model,
      prompt: composeTemplateDesignPrompt(input.prompt, context),
      system: TEMPLATE_DESIGN_SYSTEM,
      purpose: 'Template',
      actorId: input.actorId,
      check: (answer) => readTemplateDesign(answer, context),
    });
    if (!result.value.blocks.length) {
      throw nothingUsable(result.problems);
    }
    return { ...result.value, problems: result.problems, generationId: result.generationId };
  }

  /** Designing types, templates, workflows and plugin designs needs `plugins.ai.designModels`. */
  private assertModels(spaceId: string): Promise<void> {
    return this.manablox.controls.assertFeature(spaceId, aiKeys.features.designModels);
  }

  /** Space and global types, excluding system types. */
  private existingTypes(scope: TypeScope) {
    return this.manablox.contentTypes
      .forSpace(scope)
      .filter((type) => !type.isSystem && (scope !== null || type.spaceId === null));
  }
}

/** Error for a design with nothing usable, carrying the problems. */
export function nothingUsable(problems: readonly string[]): ManabloxError {
  return ManabloxError.badRequest('plugins.ai.design.empty', {
    problems: problems.join(' '),
    ...(problems.length
      ? {
          message: `The model did not design anything usable. ${problems.slice(0, 3).join(' ')}`,
        }
      : {}),
  });
}
