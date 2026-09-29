import { generatePushKeys } from '@manablox/services';

/** Prints a VAPID key pair. Changing it invalidates all existing subscriptions. */
const keys = generatePushKeys();
console.log('# Add these to the API environment (and keep the private key private):');
console.log(`PUSH_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`PUSH_VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('PUSH_VAPID_SUBJECT=mailto:admin@example.com');
