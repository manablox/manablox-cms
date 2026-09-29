import type { SpaceBlockId, SpaceTemplateId } from '@manablox/core';
import { basicTemplate } from './basic.js';
import { blogTemplate } from './blog.js';
import { businessTemplate } from './business.js';
import { customTemplate } from './custom.js';
import { landingTemplate } from './landing.js';
import { portfolioTemplate } from './portfolio.js';
import type { SpaceTemplate } from './shared.js';

/** A website type's model; `blocks` are the picked ones of `custom`. */
export function spaceTemplateModel(
  id: SpaceTemplateId,
  blocks?: readonly SpaceBlockId[],
): SpaceTemplate {
  switch (id) {
    case 'basic':
      return basicTemplate;
    case 'blog':
      return blogTemplate;
    case 'portfolio':
      return portfolioTemplate;
    case 'business':
      return businessTemplate;
    case 'landing':
      return landingTemplate;
    case 'custom':
      return customTemplate(blocks);
  }
}
