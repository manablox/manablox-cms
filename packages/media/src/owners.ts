/** Asset-to-owning-space lookups, bounded; the least recently used entry goes first. */
export class AssetOwners {
  private readonly entries = new Map<string, string>();

  constructor(
    private readonly load: (assetId: string) => Promise<string | null>,
    private readonly max = 10_000,
  ) {}

  /** The space the asset's bytes count in; loaded once, then served from memory. */
  async get(assetId: string): Promise<string | null> {
    const hit = this.entries.get(assetId);
    if (hit !== undefined) {
      this.entries.delete(assetId);
      this.entries.set(assetId, hit);
      return hit;
    }
    const owner = await this.load(assetId);
    if (owner) {
      this.entries.set(assetId, owner);
      if (this.entries.size > this.max) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
    }
    return owner;
  }

  forget(assetId: string): void {
    this.entries.delete(assetId);
  }
}
