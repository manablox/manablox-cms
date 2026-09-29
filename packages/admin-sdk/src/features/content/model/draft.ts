/** A document as the editor holds it. */
export interface DraftDocument {
  id?: string;
  spaceId: string;
  typeId: string;
  locale: string;
  parentId: string | null;
  title: string;
  slug: string;
  fields: Record<string, unknown>;
  position: number;
  version?: number;
  /** Tag names; shared by every translation of the document. */
  tags: string[];
}
