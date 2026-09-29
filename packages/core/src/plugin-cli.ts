import type { PluginContext } from './plugin-extensions.js';

/**
 * The core's `manablox` commands. `manablox <plugin id>` runs a plugin's commands, so no
 * plugin may have one of these ids; the config is refused at boot when one does.
 */
export const CLI_CORE_COMMANDS = [
  'start',
  'migrate',
  'migrate-db',
  'backup',
  'sync',
  'push-keys',
  'space',
  'user',
  'create',
  'frontend',
  'plugin',
  'docs',
] as const;

/** An option a plugin adds to a `manablox` command. */
export interface CliOption {
  /** The long name without dashes, e.g. `theme`. */
  name: string;
  /** `value` takes an argument (default), `switch` is on or off (`--no-<name>`), `list` repeats. */
  type?: 'value' | 'switch' | 'list';
  /** The argument as the help shows it, e.g. `<id>` or `designed|external`. */
  arg?: string;
  /** The help text; a string is wrapped, an array is taken line by line. */
  help: string | readonly string[];
}

/** Given option values by name: a string, a list, or `true`/`false` for a switch. */
export type CliValues = Record<string, string | readonly string[] | boolean | undefined>;

/** Asks questions in a terminal. */
export interface CliPrompter {
  text(question: {
    message: string;
    defaultValue: string;
    validate?: (value: string) => string | undefined;
  }): Promise<string>;
  select<Value extends string>(question: {
    message: string;
    options: { value: Value; label: string; hint?: string }[];
    initialValue: Value;
  }): Promise<Value>;
  /** Several picks out of the options. */
  multiselect<Value extends string>(question: {
    message: string;
    options: { value: Value; label: string; hint?: string }[];
    initialValues?: Value[];
    /** At least one pick (default: yes). */
    required?: boolean;
  }): Promise<Value[]>;
  confirm(question: { message: string; initialValue: boolean }): Promise<boolean>;
}

/** The space `manablox space create` is about to create. */
export interface CliSpaceCreateContext {
  readonly name: string;
  readonly machineName: string;
  readonly url: string;
  readonly locales: readonly string[];
}

/** A plugin's options of `manablox space create`. */
export interface CliSpaceCreateOptions {
  options: readonly CliOption[];
  /** Validates the given values before anything runs; throws naming the option. */
  check?(values: CliValues): void | Promise<void>;
  /** The plugin's data for `spaces.create` (`plugins.<id>`), `undefined` for none; may be a promise. */
  apply(space: CliSpaceCreateContext, values: CliValues): unknown;
  /** Lines for the summary once the space exists. */
  report?(data: unknown, space: { url: string; warnings: readonly string[] }): string[];
}

/** The instance `manablox create` writes, as the core options resolved it. */
export interface CliInstance {
  readonly name: string;
  readonly preset: 'local' | 'docker';
  readonly proxy: 'caddy' | 'nginx' | 'none';
  readonly database: 'postgres' | 'sqlite';
  readonly publicApi: boolean;
  /** Docker behind Caddy or nginx: routed by domain rather than port. */
  readonly byDomain: boolean;
  readonly adminUrl: string;
  /** The range every `@manablox/*` dependency gets. */
  readonly manabloxVersion: string;
  /** The first space, when one is created. */
  readonly space: { readonly name: string } | null;
}

export interface CliCreateContext {
  readonly instance: CliInstance;
  /** `null` without a terminal or with `--yes`: take the defaults. */
  readonly prompter: CliPrompter | null;
}

/** What a plugin makes of its `manablox create` options. */
export interface CliCreateResult {
  /** Arguments added to the first space's `manablox space create`. */
  spaceArgs?: string[];
  /** The first space's website address unless `--space-url` gives one. */
  spaceUrl?: string;
  /** Lines added to the next steps shown at the end. */
  nextSteps?(state: { started: boolean }): string[];
  /** Handed to `templates` as `values`. */
  values?: unknown;
}

/**
 * A plugin's options of `manablox create`; the plugin itself is picked in the feature choice,
 * with `--features` or `--<id>`. Only picked plugins' `check` and `apply` run.
 */
export interface CliCreateOptions {
  options: readonly CliOption[];
  /** Validates the given values before any question; throws naming the option. */
  check?(values: CliValues): void | Promise<void>;
  /** Resolves the values, asking for missing ones when a prompter is given. */
  apply(context: CliCreateContext, values: CliValues): CliCreateResult | Promise<CliCreateResult>;
}

/** A process a plugin adds to a new instance, e.g. a server in its own mode. */
export interface CliProcess {
  /** The compose service, e.g. `site`. */
  name: string;
  /** The port it listens on inside its container. */
  port: number;
  /** Connects with the read-only database role. */
  readOnly?: boolean;
  /** In prose, e.g. `the site process`. */
  label: string;
}

/**
 * The core templates' insertion points. Each is a line `{{slot <name>}}`; the fragment is raw
 * template text rendered with the host file's flags and tokens, and written between marker
 * comments after the slot's anchor comment so `manablox plugin` can add and remove it later.
 * `config.imports` and `public.imports` share one anchor, since both configs import their
 * plugins from `manablox.plugins.ts`.
 */
export type CliTemplateSlot =
  | 'config.imports'
  | 'config.plugins'
  | 'public.imports'
  | 'public.plugins'
  | 'package.start'
  | 'package.dev'
  | 'env'
  | 'compose.header'
  | 'compose.services'
  | 'compose.proxy'
  | 'compose.volumes'
  | 'caddy.header'
  | 'caddy.global'
  | 'caddy.admin'
  | 'caddy.sites'
  | 'nginx.admin'
  | 'nginx.sites'
  | 'readme.sections'
  | 'readme.security';

/** What a plugin adds to the files of a new instance. */
export interface CliTemplates {
  /** Whole files: raw template text, rendered like the core templates. */
  files?: { path: string; template: string; executable?: boolean }[];
  slots?: Partial<Record<CliTemplateSlot, string>>;
  /** `__TOKEN__` values for the plugin's fragments and files. */
  tokens?: Record<string, string>;
  /** `{{#if flag}}` values for the plugin's fragments and files. */
  flags?: Record<string, boolean>;
  /** Tokens filled with a random secret in `.env` and left blank in `.env.example`. */
  secrets?: string[];
  processes?: CliProcess[];
  /** `package.json` dependencies. */
  dependencies?: Record<string, string>;
}

export interface CliTemplateContext {
  readonly instance: CliInstance;
  /**
   * What `create.apply` or `install` returned as `values`; `undefined` when
   * `manablox plugin uninstall` only asks which parts to remove.
   */
  readonly values: unknown;
}

/** `manablox plugin install` and `uninstall` on an existing instance. */
export interface CliInstallContext {
  /** The instance as its files describe it; `space` is always `null`. */
  readonly instance: CliInstance;
  /** `null` without a terminal or with `--yes`: take the defaults. */
  readonly prompter: CliPrompter | null;
  /**
   * The plugin's `create` options given to `manablox plugin install`, e.g. `--site-port`,
   * checked by `create.check`; empty for `uninstall`. Options about the first space mean
   * nothing here.
   */
  readonly values: CliValues;
}

/** What a plugin makes of `manablox plugin install`. */
export interface CliInstallResult {
  /** Handed to `templates` as `values`, as `create.apply`'s are. */
  values?: unknown;
  /** Lines added to the next steps shown at the end. */
  nextSteps?: string[];
}

/** What a plugin adds to `manablox plugin uninstall`. */
export interface CliUninstallResult {
  /** Lines added to the next steps shown at the end. */
  nextSteps?: string[];
}

/** The booted instance a command works on. */
export interface CliRuntime<S = unknown> {
  /** The plugin's context: services, repositories, controls. */
  readonly plugin: PluginContext<S>;
}

export interface CliCommandContext {
  /** Positional arguments after the command words. */
  readonly positionals: readonly string[];
  readonly values: CliValues;
  readonly out: { write(text: string): unknown };
  readonly err: { write(text: string): unknown };
  /** The instance folder: where the config and its `.env` are. */
  readonly cwd: string;
  /** Asks questions; `null` without a terminal or with `--yes`. */
  readonly prompter: CliPrompter | null;
  /**
   * Aborted by Ctrl-C while the command runs. Reading it makes the first Ctrl-C abort the
   * command instead of ending the process; a second one ends it.
   */
  readonly signal: AbortSignal;
  /**
   * Prints `url` and opens it in the browser. Without a terminal, over SSH or with
   * `browser: false` (a `--no-browser` option) it only prints. Never throws.
   */
  open(url: string, options?: { browser?: boolean }): Promise<void>;
  /** Runs `work` with a spinner on a terminal, plain lines otherwise; `done` labels the end. */
  spin<T>(label: string, work: () => Promise<T>, done: (result: T) => string): Promise<T>;
  /** Boots the instance of `--config` in management mode; shut down after the command. */
  runtime<S = unknown>(): Promise<CliRuntime<S>>;
}

/** `manablox <plugin id> <words>`. */
export interface CliCommand {
  /** One line for the help. */
  description: string;
  /** The positional arguments as the help shows them, e.g. `<hostname>`. */
  args?: string;
  options?: readonly CliOption[];
  /** Resolves to the exit code; throw for a usage error. */
  run(context: CliCommandContext): Promise<number>;
}

/**
 * A plugin's part of the `manablox` CLI; the default export of the module `ManabloxPlugin.cli`
 * names. The help imports it, so it holds the options and commands only; the functions
 * import the rest when they run.
 */
export interface CliContribution {
  /** One line about the plugin, for the help. */
  summary: string;
  options?: {
    'space create'?: CliSpaceCreateOptions;
    create?: CliCreateOptions;
  };
  /** Subcommands by their words after `manablox <plugin id>`, e.g. `domains add`. */
  commands?: Record<string, CliCommand>;
  /**
   * Files and fragments of an instance that includes the plugin: written by `manablox create`,
   * and added or removed by `manablox plugin install` and `uninstall`.
   */
  templates?(context: CliTemplateContext): CliTemplates | Promise<CliTemplates>;
  /**
   * Questions of `manablox plugin install`, like `create.apply` without a first space, for
   * what `values` leaves open; without it `templates` gets no values.
   */
  install?(context: CliInstallContext): CliInstallResult | Promise<CliInstallResult>;
  /**
   * Extra cleanup of `manablox plugin uninstall`, after the confirmation and before the marked
   * parts, whole files and the dependency are removed. The plugin's data always stays.
   */
  uninstall?(
    context: CliInstallContext,
  ): CliUninstallResult | undefined | Promise<CliUninstallResult | undefined>;
}

export function defineCliContribution(contribution: CliContribution): CliContribution {
  return contribution;
}
