import { resolve } from 'node:path';
import * as clack from '@clack/prompts';
import pc from 'picocolors';

/** Asks questions; abstracted so tests can script the answers. */
export interface Prompter {
  text(question: TextQuestion): Promise<string>;
  select<Value extends string>(question: SelectQuestion<Value>): Promise<Value>;
  /** Multi-select, flat or grouped; picking a group picks all of it. */
  multiselect<Value extends string>(question: MultiSelectQuestion<Value>): Promise<Value[]>;
  confirm(question: ConfirmQuestion): Promise<boolean>;
  /** Unechoed text input. */
  password(question: PasswordQuestion): Promise<string>;
}

interface TextQuestion {
  message: string;
  /** Returned for an empty answer. */
  defaultValue: string;
  /** Returns an error message, or `undefined` when valid. */
  validate?: (value: string) => string | undefined;
}

interface SelectQuestion<Value extends string> {
  message: string;
  options: { value: Value; label: string; hint?: string }[];
  initialValue: Value;
}

type MultiSelectQuestion<Value extends string> = {
  message: string;
  initialValues?: Value[];
  /** At least one pick (default: yes). */
  required?: boolean;
} & (
  | { groups: Record<string, { value: Value; label: string; hint?: string }[]> }
  | { options: { value: Value; label: string; hint?: string }[] }
);

interface ConfirmQuestion {
  message: string;
  initialValue: boolean;
}

interface PasswordQuestion {
  message: string;
  validate?: (value: string) => string | undefined;
}

/** Progress output. */
export interface Reporter {
  intro(title: string): void;
  /** Lines under a heading. */
  note(title: string, lines: string[]): void;
  step(message: string): void;
  warn(message: string): void;
  /** Runs `work` with a spinner; `done` supplies the final label. */
  spin<T>(label: string, work: () => Promise<T>, done: (result: T) => string): Promise<T>;
  outro(message: string): void;
}

/** A parser as a prompt's `validate`: its error message is the hint. */
export function validateWith(
  parse: (raw: string) => unknown,
): (value: string) => string | undefined {
  return (value) => {
    try {
      parse(value);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
}

/** Asks until `parse` accepts the answer, and returns what it parsed. */
export async function askParsed<T>(
  prompter: Prompter,
  message: string,
  fallback: string,
  parse: (raw: string) => T,
): Promise<T> {
  const raw = await prompter.text({
    message,
    defaultValue: fallback,
    validate: validateWith(parse),
  });
  return parse(raw);
}

/** The folder to create a project in, resolved against `cwd`; its last part must be a valid name. */
export async function askTargetDir(
  prompter: Prompter,
  question: {
    message: string;
    fallback: string;
    cwd: string;
    validName: (name: string) => unknown;
  },
): Promise<string> {
  const answer = await prompter.text({
    message: question.message,
    defaultValue: question.fallback,
    validate: (value) =>
      validateWith(question.validName)(value.split(/[\\/]/).filter(Boolean).at(-1) ?? '')?.replace(
        '--name',
        'folder name',
      ),
  });
  return resolve(question.cwd, answer);
}

/** Asks for the install and git options the command line left open. */
export async function askInstallAndGit(
  prompter: Prompter,
  given: { install?: boolean | undefined; git?: boolean | undefined },
  defaults: { install: boolean; git: boolean },
): Promise<{ install: boolean; git: boolean }> {
  const install =
    given.install ??
    (await prompter.confirm({
      message: 'Install dependencies now with pnpm?',
      initialValue: defaults.install,
    }));
  const git =
    given.git ??
    (await prompter.confirm({
      message: 'Initialise a git repository?',
      initialValue: defaults.git,
    }));
  return { install, git };
}

/** Thrown when a question is cancelled. */
export class Cancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'Cancelled';
  }
}

/** The word mark; 52 columns, fits an 80 column terminal. */
const LOGO = [
  ' __  __                       _      _',
  '|  \\/  |  __ _  _ __    __ _ | |__  | |  ___  __  __',
  "| |\\/| | / _` || '_ \\  / _` || '_ \\ | | / _ \\ \\ \\/ /",
  '| |  | || (_| || | | || (_| || |_) || || (_) | >  <',
  '|_|  |_| \\__,_||_| |_| \\__,_||_.__/ |_| \\___/ /_/\\_\\',
];

/** The logo, violet to cyan, with a caption. */
export function logo(caption: string): string {
  const shades = [pc.magenta, pc.magenta, pc.blue, pc.cyan, pc.cyan];
  const rows = LOGO.map((row, index) => (shades[index] ?? pc.cyan)(pc.bold(row)));
  return `\n${rows.join('\n')}\n\n  ${pc.dim(caption)}\n`;
}

/** Colour helpers for text outside clack widgets. */
export const paint = {
  accent: (text: string) => pc.cyan(text),
  dim: (text: string) => pc.dim(text),
  path: (text: string) => pc.magenta(text),
  ok: (text: string) => pc.green(text),
};

/** The `@clack/prompts` implementation. */
export function clackUi(): Prompter & Reporter {
  function settle<T>(value: T | symbol): T {
    if (clack.isCancel(value)) throw new Cancelled();
    return value as T;
  }

  return {
    async text(question) {
      const validate = question.validate;
      const value = await clack.text({
        message: question.message,
        placeholder: question.defaultValue,
        defaultValue: question.defaultValue,
        ...(validate
          ? { validate: (raw?: string) => validate((raw ?? '').trim() || question.defaultValue) }
          : {}),
      });
      return settle(value).trim() || question.defaultValue;
    },
    async select<Value extends string>(question: SelectQuestion<Value>): Promise<Value> {
      const value = await clack.select<Value>({
        message: question.message,
        // `Option<Value>` is conditional on `Value`, which a generic cannot settle.
        options: question.options as unknown as Parameters<
          typeof clack.select<Value>
        >[0]['options'],
        initialValue: question.initialValue,
      });
      return settle(value);
    },
    async multiselect<Value extends string>(
      question: MultiSelectQuestion<Value>,
    ): Promise<Value[]> {
      if ('options' in question) {
        const value = await clack.multiselect<Value>({
          message: question.message,
          // `Option<Value>` is conditional on `Value`, which a generic cannot settle.
          options: question.options as unknown as Parameters<
            typeof clack.multiselect<Value>
          >[0]['options'],
          ...(question.initialValues ? { initialValues: question.initialValues } : {}),
          required: question.required ?? true,
        });
        return settle(value);
      }
      const value = await clack.groupMultiselect<Value>({
        message: question.message,
        // `Option<Value>` is conditional on `Value`, which a generic cannot settle.
        options: question.groups as unknown as Parameters<
          typeof clack.groupMultiselect<Value>
        >[0]['options'],
        ...(question.initialValues ? { initialValues: question.initialValues } : {}),
        required: question.required ?? true,
        selectableGroups: true,
      });
      return settle(value);
    },
    async confirm(question) {
      return settle(
        await clack.confirm({ message: question.message, initialValue: question.initialValue }),
      );
    },
    async password(question) {
      const validate = question.validate;
      const value = await clack.password({
        message: question.message,
        ...(validate ? { validate: (raw?: string) => validate((raw ?? '').trim()) } : {}),
      });
      return settle(value).trim();
    },

    intro(title) {
      clack.intro(pc.bgMagenta(pc.black(` ${title} `)));
    },
    note(title, lines) {
      clack.note(lines.join('\n'), title);
    },
    step(message) {
      clack.log.step(message);
    },
    warn(message) {
      clack.log.warn(message);
    },
    async spin(label, work, done) {
      const spinner = clack.spinner();
      spinner.start(label);
      try {
        const result = await work();
        spinner.stop(done(result));
        return result;
      } catch (error) {
        spinner.error(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    outro(message) {
      clack.outro(message);
    },
  };
}

/** Plain-text reporter without colour, for pipes and tests. */
export function plainReporter(out: NodeJS.WritableStream): Reporter {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the escape byte is the point
  const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');
  const write = (text: string) => out.write(plain(text));
  return {
    intro(title) {
      write(`${title}\n`);
    },
    note(title, lines) {
      write(`\n${title}\n${lines.map((line) => `  ${line}`).join('\n')}\n`);
    },
    step(message) {
      write(`${message}\n`);
    },
    warn(message) {
      write(`warning: ${message}\n`);
    },
    async spin(label, work, done) {
      write(`${label}\n`);
      const result = await work();
      write(`${done(result)}\n`);
      return result;
    },
    outro(message) {
      write(`\n${message}\n`);
    },
  };
}
