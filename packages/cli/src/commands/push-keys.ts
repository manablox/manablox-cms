export async function pushKeys(): Promise<number> {
  const { generatePushKeys } = await import('@manablox/services');
  const keys = generatePushKeys();
  process.stdout.write(
    [
      '# Add these to the environment (and keep the private key private):',
      `PUSH_VAPID_PUBLIC_KEY=${keys.publicKey}`,
      `PUSH_VAPID_PRIVATE_KEY=${keys.privateKey}`,
      'PUSH_VAPID_SUBJECT=mailto:admin@example.com',
      '',
    ].join('\n'),
  );
  return 0;
}
