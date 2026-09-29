import { renderSVG } from 'uqr';

/** The QR code an authenticator app scans, as SVG markup. */
export function totpQrSvg(uri: string): string {
  return renderSVG(uri, { border: 1, whiteColor: '#ffffff', blackColor: '#000000' });
}

/** The key inside an `otpauth://` URI, in groups of four for typing by hand. */
export function totpSecret(uri: string): string {
  try {
    const secret = new URL(uri).searchParams.get('secret') ?? '';
    return secret.match(/.{1,4}/g)?.join(' ') ?? '';
  } catch {
    return '';
  }
}

/** Backup codes as a text file's content. */
export function backupCodesText(codes: readonly string[]): string {
  return [
    'Manablox two-factor backup codes',
    'Each code works once. Keep them somewhere safe.',
    '',
    ...codes,
    '',
  ].join('\n');
}
