import type { Prompter } from '../../src/ui.js';

/** Answers questions from a list, in order; a text answer that fails validation moves on to the next. */
export function scriptedPrompter(
  answers: string[],
): Prompter & { asked: () => string[]; errors: () => string[] } {
  const queue = [...answers];
  const asked: string[] = [];
  const errors: string[] = [];
  const next = (message: string) => {
    asked.push(message);
    const answer = queue.shift();
    if (answer === undefined) throw new Error(`no answer scripted for: ${message}`);
    return answer;
  };
  return {
    asked: () => asked,
    errors: () => errors,
    async text(question) {
      for (;;) {
        const raw = next(question.message).trim() || question.defaultValue;
        const error = question.validate?.(raw);
        if (!error) return raw;
        errors.push(error);
      }
    },
    async select(question) {
      const raw = next(question.message);
      if (raw === '' && question.initialValue !== undefined) return question.initialValue;
      const choice = question.options.find(
        (option) => option.value === raw || option.label === raw,
      );
      if (!choice)
        throw new Error(
          `'${raw}' is not one of ${question.options.map((o) => o.value).join(', ')}`,
        );
      return choice.value;
    },
    async confirm(question) {
      const raw = next(question.message).toLowerCase();
      if (raw === '') return question.initialValue;
      return ['y', 'yes', 'true'].includes(raw);
    },
    // Comma separated values, each one of the options; empty takes the preselection.
    async multiselect(question) {
      const raw = next(question.message);
      if (raw.trim() === '') return [...(question.initialValues ?? [])] as never;
      const values = (
        'options' in question ? question.options : Object.values(question.groups).flat()
      ).map((option) => option.value);
      const picked = raw.split(',').map((entry) => entry.trim());
      for (const entry of picked) {
        if (!values.includes(entry as never))
          throw new Error(`'${entry}' is not one of the options`);
      }
      return picked as never;
    },
    async password(question) {
      return next(question.message);
    },
  };
}
