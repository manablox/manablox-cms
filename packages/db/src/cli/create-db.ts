import { rmSync } from 'node:fs';
import postgres from 'postgres';
import { dialectOf } from '../client.js';
import { sqliteFile } from '../sqlite/client.js';
import { withDatabase } from '../testing.js';

/** Creates the database `DATABASE_URL` names if it is missing; `--fresh` drops it first. */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

if (dialectOf(url) === 'sqlite') {
  // SQLite creates the file on first connect; `--fresh` deletes it and its WAL files.
  const file = sqliteFile(url);
  if (file && process.argv.includes('--fresh')) {
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
    console.info(`removed ${file}`);
  }
  process.exit(0);
}

const name = new URL(url).pathname.replace(/^\//, '');
const fresh = process.argv.includes('--fresh');
const admin = postgres(withDatabase(url, 'postgres'), { max: 1 });

try {
  if (fresh) await admin.unsafe(`drop database if exists "${name}" with (force)`);
  const [row] = await admin.unsafe(`select 1 as found from pg_database where datname = '${name}'`);
  if (!row) {
    await admin.unsafe(`create database "${name}"`);
    console.info(`created database ${name}`);
  } else {
    console.info(`database ${name} exists`);
  }
} finally {
  await admin.end();
}
