import { defineCliContribution } from '@manablox/core';

/** The local plugin's command, `manablox greeter wave`. */
export default defineCliContribution({
  summary: 'greetings from the instance repository',
  commands: {
    wave: {
      description: 'wave at someone',
      args: '<name>',
      run: async (context) => {
        context.out.write(`*waves at ${context.positionals[0]}*\n`);
        return 0;
      },
    },
  },
});
