import { createHmac } from 'node:crypto';
import { sameSignature } from '@manablox/core/node';

export interface TransformRequest {
  assetId: string;
  preset: string;
  format: string;
}

/** Signs a transform so only CMS-issued resize URLs are honoured. */
export function signTransform(secret: string, request: TransformRequest): string {
  return createHmac('sha256', secret)
    .update(`${request.assetId}:${request.preset}:${request.format}`)
    .digest('base64url')
    .slice(0, 32);
}

export function verifyTransform(
  secret: string,
  request: TransformRequest,
  signature: string,
): boolean {
  return sameSignature(signTransform(secret, request), signature);
}

export function transformPath(request: TransformRequest, signature: string): string {
  return `/media/${request.assetId}/${request.preset}.${request.format}?s=${signature}`;
}
