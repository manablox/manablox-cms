import { randomBytes } from 'node:crypto';
import { resolveCname, resolveTxt } from 'node:dns/promises';
import { purgeTags } from '@manablox/core';
import type { Manablox } from '@manablox/core/node';
import type { HostVerificationData, Repositories } from '@manablox/db';
import type { HostRow, HostSource } from './data/provider.js';
import { hostSources } from './data/registry.js';
import { environmentPayload } from './lib.js';

/** The DNS lookups a check needs; `node:dns/promises` by default. */
export interface DnsResolver {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
}

const systemResolver: DnsResolver = { resolveTxt, resolveCname };

/** A new host is checked this long; then it is marked failed and only "Verify now" retries. */
export const VERIFICATION_WINDOW_MS = 7 * 24 * 60 * 60_000;
/** Hosts of each source checked per sweep. */
const SWEEP_BATCH = 50;

export type HostVerificationStatus = 'verified' | 'pending' | 'failed';

/** What the admin shows to prove ownership of a host. */
export interface HostVerificationView {
  status: HostVerificationStatus;
  /** Unverified hosts are not served while this is on. */
  required: boolean;
  /** The TXT record's name and value. */
  txtName: string;
  txtValue: string | null;
  /** The configured CNAME target, if any. */
  cnameTarget: string | null;
  checkedAt: Date | null;
  failedAt: Date | null;
}

/** `_manablox.<host>`, the name the TXT record goes on. */
export const txtRecordName = (hostname: string): string => `_manablox.${hostname}`;

const newToken = (): string => `manablox-verify-${randomBytes(16).toString('hex')}`;

const bare = (name: string): string => name.trim().toLowerCase().replace(/\.$/, '');

export interface HostVerifierOptions {
  resolver?: DnsResolver | undefined;
  now?: (() => Date) | undefined;
}

/** DNS ownership checks for every host source, on demand and in a periodic sweep. */
export class HostVerifier {
  /** Replaceable, e.g. by a fake in tests. */
  resolver: DnsResolver;
  private readonly now: () => Date;

  constructor(
    private readonly manablox: Manablox,
    private readonly repos: Repositories,
    options: HostVerifierOptions = {},
  ) {
    this.resolver = options.resolver ?? systemResolver;
    this.now = options.now ?? (() => new Date());
  }

  /** Whether `domains.requireVerification` is on. */
  async required(): Promise<boolean> {
    return (await this.manablox.controls.resolved(null)).settings.domainsRequireVerification;
  }

  /** Whether an unverified row is refused right now. */
  async blocks(row: Pick<HostRow, 'verifiedAt'>): Promise<boolean> {
    return row.verifiedAt === null && (await this.required());
  }

  /** Verified at once while the control is off; otherwise pending with a fresh token. */
  async initial(): Promise<HostVerificationData> {
    const now = this.now();
    if (!(await this.required())) {
      return {
        verifiedAt: now,
        verificationToken: null,
        verificationStartedAt: null,
        verificationCheckedAt: null,
        verificationFailedAt: null,
      };
    }
    return {
      verifiedAt: null,
      verificationToken: newToken(),
      verificationStartedAt: now,
      verificationCheckedAt: null,
      verificationFailedAt: null,
    };
  }

  view(row: HostRow, required: boolean): HostVerificationView {
    return {
      status: row.verifiedAt ? 'verified' : row.verificationFailedAt ? 'failed' : 'pending',
      required,
      txtName: txtRecordName(row.hostname),
      txtValue: row.verifiedAt ? null : row.verificationToken,
      cnameTarget: this.cnameTarget(),
      checkedAt: row.verificationCheckedAt,
      failedAt: row.verificationFailedAt,
    };
  }

  /** The source and row holding `hostname`, across every source. */
  async owner(hostname: string): Promise<{ source: HostSource; row: HostRow } | null> {
    for (const source of hostSources(this.manablox)) {
      const row = await source.find(this.repos, hostname);
      if (row) return { source, row };
    }
    return null;
  }

  /** Looks the host up now; a match verifies it, a miss leaves it as it was. */
  async check<T extends HostRow>(kind: string, row: T): Promise<T> {
    const source = this.source(kind);
    if (row.verifiedAt) return row;
    const now = this.now();
    // A row from before tokens, or one that failed, gets a token to check against.
    const token = row.verificationToken ?? newToken();
    const matched = await this.matches(row.hostname, token);
    const data: Partial<HostVerificationData> = matched
      ? { verifiedAt: now, verificationCheckedAt: now, verificationFailedAt: null }
      : {
          verificationCheckedAt: now,
          ...(row.verificationToken
            ? {}
            : { verificationToken: token, verificationStartedAt: now }),
        };
    const updated = ((await source.setVerification(this.repos, row.id, data)) ?? row) as T;
    if (matched) await this.verified(source, updated);
    return updated;
  }

  /** Checks the pending hosts of every source; ones past the window are marked failed. */
  async sweep(): Promise<{ checked: number; verified: number; failed: number }> {
    const report = { checked: 0, verified: 0, failed: 0 };
    for (const source of hostSources(this.manablox)) {
      for (const row of await source.pending(this.repos, SWEEP_BATCH)) {
        const started = (row.verificationStartedAt ?? row.createdAt).getTime();
        if (this.now().getTime() - started > VERIFICATION_WINDOW_MS) {
          await source.setVerification(this.repos, row.id, { verificationFailedAt: this.now() });
          report.failed += 1;
          continue;
        }
        report.checked += 1;
        const after = await this.check(source.kind, row).catch((error: unknown) => {
          this.manablox.logger.warn({ err: error, hostname: row.hostname }, 'host check failed');
          return row;
        });
        if (after.verifiedAt) report.verified += 1;
      }
    }
    return report;
  }

  private cnameTarget(): string | null {
    const target = this.manablox.config.control.domainCnameTarget;
    return target ? bare(target) : null;
  }

  private async matches(hostname: string, token: string): Promise<boolean> {
    const txt = await this.resolver.resolveTxt(txtRecordName(hostname)).catch(() => []);
    if (txt.some((chunks) => chunks.join('').trim() === token)) return true;
    const target = this.cnameTarget();
    if (!target) return false;
    const cnames = await this.resolver.resolveCname(hostname).catch(() => []);
    return cnames.some((name) => bare(name) === target);
  }

  private source(kind: string): HostSource {
    const source = hostSources(this.manablox).find((entry) => entry.kind === kind);
    if (!source) throw new Error(`No host source ${kind}.`);
    return source;
  }

  private async verified(source: HostSource, row: HostRow): Promise<void> {
    await this.manablox.controls.emit(
      'domain.verified',
      { kind: 'space', id: row.spaceId },
      {
        spaceId: row.spaceId,
        ...(await environmentPayload(this.repos, row)),
        domainId: row.id,
        hostname: row.hostname,
        kind: source.kind,
        ...source.eventFields?.(row),
      },
    );
    await purgeTags(this.manablox, row.spaceId, [source.cacheTag]);
  }
}
