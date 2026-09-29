import { users } from './queries';

/**
 * Install state. `setupNeeded` flips once the first account exists, mid-wizard;
 * `installing` keeps the wizard reachable until it finishes.
 */

let asked: Promise<boolean> | null = null;
let installing = false;

/** Asked once per page load; a failure answers `false` so nobody lands in the wizard. */
export function setupNeeded(): Promise<boolean> {
  asked ??= users.setupNeeded().catch(() => false);
  return asked;
}

/** True from the wizard's first step until it finishes. */
export function isInstalling(): boolean {
  return installing;
}

export function beginInstall(): void {
  installing = true;
}

export function endInstall(): void {
  installing = false;
  asked = Promise.resolve(false);
}
