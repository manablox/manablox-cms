import { setTimeout as sleep } from 'node:timers/promises';
import type { Client, Transaction } from '@libsql/client';

/** How long a write waits for the one in progress before failing. */
const BUSY_TIMEOUT_MS = 15_000;

/** Statements that only read; everything else takes a write turn. */
const READ = /^[\s(]*(select|explain|pragma\s+\w+\s*(;|$))/i;

const sqlOf = (statement: unknown): string =>
  typeof statement === 'string' ? statement : String((statement as { sql?: string })?.sql ?? '');

const isBusy = (error: unknown): boolean =>
  (error as { code?: string } | undefined)?.code === 'SQLITE_BUSY';

const busy = () =>
  Object.assign(new Error('SQLITE_BUSY: waited too long for another write'), {
    code: 'SQLITE_BUSY',
  });

/** Hands out one turn at a time, in call order. */
class Turns {
  private tail: Promise<void> = Promise.resolve();

  /** Waits for a turn; the returned function ends it. */
  async take(deadline: number): Promise<() => void> {
    let end = () => {};
    const done = new Promise<void>((resolve) => {
      end = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => done);

    const waited = new AbortController();
    const expired = sleep(Math.max(0, deadline - Date.now()), 'expired', {
      signal: waited.signal,
    }).catch(() => 'aborted');
    const outcome = await Promise.race([previous.then(() => 'ready'), expired]);
    waited.abort();
    if (outcome !== 'ready') {
      // Give the turn up as soon as it comes, so later callers are not held.
      void previous.then(end);
      throw busy();
    }
    return end;
  }
}

/**
 * SQLite has one writer at a time, and its own busy wait blocks the event loop so the
 * transaction holding the lock could never finish. Writes and transactions therefore take
 * turns here, and never meet a lock held by this process. Reads run beside them (WAL).
 * A lock held by another process fails fast and is retried asynchronously.
 */
export function serializeWrites(client: Client): Client {
  const turns = new Turns();

  /**
   * Retries `run` while the database is busy. A statement that failed busy stays active on
   * its connection, which then cannot commit and reads a stale snapshot, so the pool is
   * reopened first. Only called in a turn, when no transaction of this process is open.
   */
  const retrying = async <T>(run: () => Promise<T>, deadline: number): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await run();
      } catch (error) {
        if (!isBusy(error) || Date.now() >= deadline) throw error;
        client.reconnect();
        await sleep(Math.min(50, 2 ** attempt));
      }
    }
  };

  const exclusive = async <T>(run: () => Promise<T>, reopen = false): Promise<T> => {
    const deadline = Date.now() + BUSY_TIMEOUT_MS;
    const end = await turns.take(deadline);
    try {
      if (reopen) client.reconnect();
      return await retrying(run, deadline);
    } finally {
      end();
    }
  };

  const transaction = async (...args: Parameters<Client['transaction']>) => {
    const deadline = Date.now() + BUSY_TIMEOUT_MS;
    const end = await turns.take(deadline);
    let tx: Transaction;
    try {
      tx = await retrying(() => client.transaction(...args), deadline);
    } catch (error) {
      end();
      throw error;
    }
    return settleEnds(tx, end);
  };

  /** Reads skip the queue; one that meets a busy database retries in a turn. */
  const read = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      if (!isBusy(error)) throw error;
      return exclusive(run, true);
    }
  };

  return new Proxy(client, {
    get(target, key, receiver) {
      if (key === 'transaction') return transaction;
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      if (key === 'batch' || key === 'migrate') {
        return (...args: unknown[]) => exclusive(() => value.apply(target, args));
      }
      if (key === 'execute') {
        return (...args: unknown[]) => {
          const run = () => value.apply(target, args);
          return READ.test(sqlOf(args[0])) ? read(run) : exclusive(run);
        };
      }
      return value.bind(target);
    },
  });
}

/** Ends the turn when the transaction commits, rolls back or closes. */
function settleEnds(tx: Transaction, end: () => void): Transaction {
  let ended = false;
  const finish = () => {
    if (!ended) {
      ended = true;
      end();
    }
  };
  return new Proxy(tx, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      if (key === 'commit' || key === 'rollback') {
        return async (...args: unknown[]) => {
          try {
            return await value.apply(target, args);
          } finally {
            finish();
          }
        };
      }
      if (key === 'close') {
        return (...args: unknown[]) => {
          try {
            return value.apply(target, args);
          } finally {
            finish();
          }
        };
      }
      return value.bind(target);
    },
  });
}
