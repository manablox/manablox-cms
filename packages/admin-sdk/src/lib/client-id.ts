/** Per-page-load tab id, sent with writes so the live feed can skip this tab's own echoes. */
export const clientId: string =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
