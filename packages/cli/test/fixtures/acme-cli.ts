import { defineCliContribution } from '@manablox/core';

/** A plugin contribution for the loader and parser tests. */
export default defineCliContribution({
  summary: 'acme things',
  options: {
    'space create': {
      options: [
        { name: 'acme-mood', arg: '<mood>', help: 'the mood of the space' },
        { name: 'acme-loud', type: 'switch', help: 'shout' },
      ],
      check: (values) => {
        if (values['acme-mood'] === 'grumpy') throw new Error('--acme-mood cannot be grumpy');
      },
      apply: (space, values) =>
        values['acme-mood'] ? { mood: values['acme-mood'], for: space.machineName } : undefined,
      report: (data) => [`acme mood ${(data as { mood: string }).mood}`],
    },
  },
  commands: {
    hello: {
      description: 'say hello',
      options: [{ name: 'to', arg: '<name>', help: 'whom to greet' }],
      run: async (context) => {
        context.out.write(
          `hello ${context.values.to ?? 'world'} ${context.positionals.join(',')}\n`,
        );
        return 0;
      },
    },
    'hello twice': {
      description: 'say hello twice',
      args: '<name>',
      run: async (context) => {
        context.out.write(`hello hello ${context.positionals[0]}\n`);
        return 3;
      },
    },
  },
});
