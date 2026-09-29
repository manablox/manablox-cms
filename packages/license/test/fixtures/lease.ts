import type { LeasePayload } from '../../src/index.js';

/** A lease signed with the dev key. Frozen: a change to the format must break its test. */
export const FROZEN_PAYLOAD: LeasePayload = {
  v: 1,
  kid: 'dev-2026-09',
  iss: 'licenses.manablox.io',
  aid: 'act_01',
  iid: '0199f0a0-0000-7000-8000-000000000001',
  key: 'J06NP',
  products: ['ai', 'website'],
  kind: 'production',
  status: 'active',
  periodEnd: 1_790_000_000,
  iat: 1_789_000_000,
  nbf: 1_789_000_000,
  exp: 1_791_209_600,
};

export const FROZEN_LEASE =
  'eyJ2IjoxLCJraWQiOiJkZXYtMjAyNi0wOSIsImlzcyI6ImxpY2Vuc2VzLm1hbmFibG94LmlvIiwiYWlkIjoiYWN0XzAxIiwiaWlkIjoiMDE5OWYwYTAtMDAwMC03MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwia2V5IjoiSjA2TlAiLCJwcm9kdWN0cyI6WyJhaSIsIndlYnNpdGUiXSwia2luZCI6InByb2R1Y3Rpb24iLCJzdGF0dXMiOiJhY3RpdmUiLCJwZXJpb2RFbmQiOjE3OTAwMDAwMDAsImlhdCI6MTc4OTAwMDAwMCwibmJmIjoxNzg5MDAwMDAwLCJleHAiOjE3OTEyMDk2MDB9.CE0qtDXIRvlCRRFbQag2_x9HUlbzivfZe9xg4fnNV24jeNikR5zAFxrAGV9wFN5YyBHYvQJ-kK-oBkt7bPxaAA';
