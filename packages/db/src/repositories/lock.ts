import { Repository } from './base.js';

/** Serialises instance-wide operations across processes. */
export class LockRepository extends Repository {
  /** Runs `fn` while no other holder of `name` runs; its writes commit as they go. */
  withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return this.dialect.withLock(this.db, name, fn);
  }
}
