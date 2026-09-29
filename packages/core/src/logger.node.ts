import { createWriteStream, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { Writable } from 'node:stream';
import {
  type DestinationStream,
  type Logger,
  type LoggerOptions,
  multistream,
  pino,
  type StreamEntry,
} from 'pino';

export type { Logger };

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/** A named writable receiving one NDJSON line per record. `level` filters this one alone. */
export interface LogAdapter {
  readonly name: string;
  readonly level?: LogLevel | undefined;
  readonly stream: DestinationStream | NodeJS.WritableStream;
  /** Flush and release. Called once, when the instance stops. */
  close?(): void | Promise<void>;
}

/** Builds an adapter from its config entry. Registered under a `type` name. */
export type LogAdapterFactory = (options: Record<string, unknown>) => LogAdapter;

export interface ConsoleLogAdapterConfig {
  type: 'console';
  level?: LogLevel;
  /** Human-readable colourised output. Defaults to on outside production. */
  pretty?: boolean;
  destination?: 'stdout' | 'stderr';
}

export interface FileLogAdapterConfig {
  type: 'file';
  level?: LogLevel;
  path: string;
  /** Create the parent directory when it is missing. Defaults to true. */
  mkdir?: boolean;
  /** Append rather than truncate. Defaults to true. */
  append?: boolean;
}

export interface HttpLogAdapterConfig {
  type: 'http';
  level?: LogLevel;
  /** Where batches are posted. */
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** `ndjson` posts one record per line, `json` posts an array. Defaults to `ndjson`. */
  format?: 'ndjson' | 'json';
  /** Records per request. Defaults to 100. */
  batchSize?: number;
  /** Milliseconds between flushes of a partial batch. Defaults to 5000. */
  flushInterval?: number;
  /** Records held while the endpoint is unreachable, oldest dropped first. Defaults to 10000. */
  maxQueue?: number;
  /** Per-request timeout in milliseconds. Defaults to 10000. */
  timeout?: number;
}

/** Anything registered by a plugin: the `type` is looked up in the adapter registry. */
export interface CustomLogAdapterConfig {
  type: string;
  level?: LogLevel;
  [option: string]: unknown;
}

export type LogAdapterConfig =
  | ConsoleLogAdapterConfig
  | FileLogAdapterConfig
  | HttpLogAdapterConfig
  | CustomLogAdapterConfig;

/** A config entry, a ready-made adapter, or a function that builds one. */
export type LogAdapterInput = LogAdapterConfig | LogAdapter | (() => LogAdapter);

export interface LoggingConfig {
  /** The floor for every adapter that does not set its own. Defaults to `LOG_LEVEL` or `info`. */
  level?: string;
  /** Destinations. Defaults to a single console adapter. */
  adapters?: LogAdapterInput[];
  /** Paths blanked before a record leaves the process. Replaces the defaults when given. */
  redact?: string[];
  /** Fields stamped on every record - `{ service: 'api' }`, an instance id. */
  base?: Record<string, unknown>;
  /** Escape hatch onto the underlying pino options; merged last. */
  pino?: LoggerOptions;
}

/** The logger plus the adapters behind it, so the runtime can flush them on shutdown. */
export interface Logging {
  readonly logger: Logger;
  readonly adapters: readonly LogAdapter[];
  close(): Promise<void>;
}

const DEFAULT_REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.refreshToken',
  '*.secret',
];

const registry = new Map<string, LogAdapterFactory>();

/** Registers an adapter type for config entries like `{ type: 'datadog', apiKey: '...' }`. */
export function registerLogAdapter(type: string, factory: LogAdapterFactory): void {
  registry.set(type, factory);
}

export function createLogAdapter(input: LogAdapterInput): LogAdapter {
  if (typeof input === 'function') return input();
  if (isAdapter(input)) return input;

  const { type, ...options } = input;
  switch (type) {
    case 'console':
      return consoleAdapter(input as ConsoleLogAdapterConfig);
    case 'file':
      return fileAdapter(input as FileLogAdapterConfig);
    case 'http':
      return httpAdapter(input as HttpLogAdapterConfig);
    default: {
      const factory = registry.get(type);
      // Never silently lose a destination.
      if (!factory) throw new Error(`Unknown log adapter type: ${type}`);
      return factory(options as Record<string, unknown>);
    }
  }
}

function isAdapter(value: LogAdapterInput): value is LogAdapter {
  return typeof value === 'object' && value !== null && 'stream' in value;
}

/** Builds the logger and its adapters. */
export function createLogging(config: LoggingConfig = {}): Logging {
  const level = normaliseLevel(config.level ?? process.env.LOG_LEVEL ?? 'info');
  const adapters = (config.adapters?.length ? config.adapters : [{ type: 'console' } as const]).map(
    createLogAdapter,
  );

  // Pino filters before the stream, so the root takes the lowest adapter level.
  const rootLevel = adapters.reduce<LogLevel>(
    (lowest, adapter) =>
      adapter.level && LEVELS[adapter.level] < LEVELS[lowest] ? adapter.level : lowest,
    level,
  );

  const streams: StreamEntry[] = adapters.map((adapter) => ({
    level: adapter.level ?? level,
    stream: adapter.stream as DestinationStream,
  }));

  const logger = pino(
    {
      level: rootLevel,
      ...(config.base ? { base: { pid: process.pid, hostname: hostname(), ...config.base } } : {}),
      redact: {
        paths: config.redact ?? DEFAULT_REDACT,
        censor: '[redacted]',
      },
      ...config.pino,
    },
    // Always multistream, so per-adapter levels apply even with one destination.
    multistream(streams, { dedupe: false }),
  );

  return {
    logger,
    adapters,
    async close() {
      for (const adapter of adapters) {
        try {
          await adapter.close?.();
        } catch (error) {
          process.stderr.write(`log adapter ${adapter.name} failed to close: ${String(error)}\n`);
        }
      }
    },
  };
}

/** The logger alone, for callers that never shut it down. */
export function createLogger(config: LoggingConfig = {}): Logger {
  return createLogging(config).logger;
}

function normaliseLevel(level: string): LogLevel {
  return level in LEVELS ? (level as LogLevel) : 'info';
}

// Built-in adapters

function consoleAdapter(config: ConsoleLogAdapterConfig): LogAdapter {
  const target = config.destination === 'stderr' ? process.stderr : process.stdout;
  const pretty = config.pretty ?? process.env.NODE_ENV !== 'production';

  return {
    name: 'console',
    level: config.level,
    // In-process, not a worker transport: workers cannot join the multistream.
    stream: pretty ? prettyStream(target) : target,
  };
}

const nodeRequire = createRequire(import.meta.url);

function prettyStream(target: NodeJS.WritableStream): NodeJS.WritableStream {
  // Required lazily so production never loads the formatter.
  const module = nodeRequire('pino-pretty') as
    | ((options: Record<string, unknown>) => NodeJS.WritableStream)
    | { default: (options: Record<string, unknown>) => NodeJS.WritableStream };
  const build = typeof module === 'function' ? module : module.default;
  return build({ colorize: true, translateTime: 'HH:MM:ss', destination: target });
}

function fileAdapter(config: FileLogAdapterConfig): LogAdapter {
  if (config.mkdir !== false) mkdirSync(dirname(config.path), { recursive: true });

  const stream = createWriteStream(config.path, {
    flags: config.append === false ? 'w' : 'a',
  });

  return {
    name: `file:${config.path}`,
    level: config.level,
    stream,
    close: () =>
      new Promise<void>((resolve) => {
        stream.end(() => resolve());
      }),
  };
}

/**
 * Posts batches to an HTTP endpoint. The queue is bounded, dropping the oldest records;
 * the next successful batch reports how many were dropped.
 */
function httpAdapter(config: HttpLogAdapterConfig): LogAdapter {
  const batchSize = config.batchSize ?? 100;
  const flushInterval = config.flushInterval ?? 5_000;
  const maxQueue = config.maxQueue ?? 10_000;
  const timeout = config.timeout ?? 10_000;
  const format = config.format ?? 'ndjson';

  let queue: string[] = [];
  let dropped = 0;
  let inFlight: Promise<void> | null = null;
  let closed = false;

  const send = async (batch: string[]): Promise<boolean> => {
    const body =
      format === 'json'
        ? `[${batch.join(',')}]`
        : `${batch.map((line) => line.trim()).join('\n')}\n`;

    try {
      const response = await fetch(config.url, {
        method: config.method ?? 'POST',
        headers: {
          'content-type': format === 'json' ? 'application/json' : 'application/x-ndjson',
          ...(dropped ? { 'x-manablox-dropped': String(dropped) } : {}),
          ...config.headers,
        },
        body,
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) return false;
      dropped = 0;
      return true;
    } catch {
      return false;
    }
  };

  const flush = async (): Promise<void> => {
    if (inFlight) return inFlight;
    if (queue.length === 0) return;

    const batch = queue.splice(0, batchSize);
    inFlight = (async () => {
      const ok = await send(batch);
      if (!ok) {
        // Requeue for the next tick, dropping the oldest past the ceiling.
        queue = [...batch, ...queue];
        const excess = queue.length - maxQueue;
        if (excess > 0) {
          queue.splice(0, excess);
          dropped += excess;
        }
      }
    })();

    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  };

  const timer = setInterval(() => {
    if (!closed) void flush();
  }, flushInterval);
  timer.unref?.();

  const stream = new Writable({
    write(chunk, _encoding, callback) {
      queue.push(String(chunk));
      if (queue.length > maxQueue) {
        dropped += queue.length - maxQueue;
        queue.splice(0, queue.length - maxQueue);
      }
      if (queue.length >= batchSize) void flush();
      callback();
    },
  });

  return {
    name: `http:${config.url}`,
    level: config.level,
    stream,
    async close() {
      closed = true;
      clearInterval(timer);
      // One attempt per batch, so a dead endpoint cannot hang shutdown.
      while (queue.length > 0) {
        const batch = queue.splice(0, batchSize);
        if (!(await send(batch))) break;
      }
      stream.end();
    },
  };
}
