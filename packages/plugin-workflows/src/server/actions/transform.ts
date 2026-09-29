import { defineWorkflowAction, type WorkflowActionContext } from '../../define/action.js';

export interface TransformConfig extends Record<string, unknown> {
  /** JSON whose strings are templates; a lone placeholder keeps its value's type. */
  template: string;
}

export const transformAction = defineWorkflowAction<TransformConfig>({
  type: 'transform.json',
  label: 'Reshape data',
  description: 'Builds a JSON value out of what earlier nodes produced.',
  icon: 'braces',
  tone: 'violet',
  group: 'data',
  inputs: [{ name: 'in', label: 'Anything', type: 'any' }],
  ports: [],
  output: { name: 'ok', label: 'The value you built', type: 'json' },
  outputPaths: [],
  credential: null,
  fields: [
    {
      name: 'template',
      label: 'Shape',
      kind: 'json',
      rows: 10,
      required: true,
      hint: 'JSON. A placeholder on its own keeps its type: {{ nodes.fetch.body.total }} stays a number.',
    },
  ],
  defaults: () => ({
    template: '{\n  "title": "{{ content.title }}",\n  "source": "{{ nodes.fetch.body }}"\n}',
  }),
  validate: (config, at, add) => {
    const template = config.template?.trim() ?? '';
    try {
      JSON.parse(template);
    } catch {
      add('plugins.workflows.node.transform.templateInvalid', at('template'));
    }
    return { template };
  },
  execute: async (ctx: WorkflowActionContext<TransformConfig>) => {
    const output: unknown = JSON.parse(ctx.renderJson(ctx.config.template));
    return {
      kind: 'ok',
      message: 'Built a value',
      detail: { preview: JSON.stringify(output).slice(0, 500) },
      output,
    };
  },
});
