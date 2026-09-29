// A minimal Redis client for the perf scripts (no dependency at the repository root):
// `redis(url).command('INFO', 'commandstats')`. Also a CLI: `node redis.mjs <url> <cmd> [args]`.
import net from 'node:net';

/** Parses one RESP reply from `buffer` at `offset`; `null` when it is incomplete. */
function parse(buffer, offset = 0) {
  const end = buffer.indexOf('\r\n', offset);
  if (end < 0) return null;
  const type = String.fromCharCode(buffer[offset]);
  const line = buffer.toString('utf8', offset + 1, end);
  const next = end + 2;
  if (type === '+' || type === '-') return { value: type === '-' ? new Error(line) : line, next };
  if (type === ':') return { value: Number(line), next };
  if (type === '$') {
    const length = Number(line);
    if (length < 0) return { value: null, next };
    if (buffer.length < next + length + 2) return null;
    return { value: buffer.toString('utf8', next, next + length), next: next + length + 2 };
  }
  if (type === '*') {
    const length = Number(line);
    const items = [];
    let at = next;
    for (let index = 0; index < length; index++) {
      const item = parse(buffer, at);
      if (!item) return null;
      items.push(item.value);
      at = item.next;
    }
    return { value: items, next: at };
  }
  throw new Error(`unexpected RESP type ${type}`);
}

export function redis(url) {
  const parsed = new URL(url);
  const db = Number(parsed.pathname.slice(1) || 0);
  const socket = net.connect(Number(parsed.port || 6379), parsed.hostname);
  let buffer = Buffer.alloc(0);
  const waiting = [];
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const reply = waiting.length ? parse(buffer) : null;
      if (!reply) break;
      buffer = buffer.subarray(reply.next);
      const { resolve, reject } = waiting.shift();
      if (reply.value instanceof Error) reject(reply.value);
      else resolve(reply.value);
    }
  });
  const command = (...args) =>
    new Promise((resolve, reject) => {
      waiting.push({ resolve, reject });
      socket.write(
        `*${args.length}\r\n${args.map((arg) => `$${Buffer.byteLength(String(arg))}\r\n${arg}\r\n`).join('')}`,
      );
    });
  const ready = db ? command('SELECT', db) : Promise.resolve();
  return {
    command: async (...args) => {
      await ready;
      return command(...args);
    },
    close: () => socket.end(),
  };
}

/** `INFO commandstats` as `{ get: calls, ... }`, lower-case command names. */
export async function commandStats(client) {
  const info = await client.command('INFO', 'commandstats');
  const out = {};
  for (const line of info.split('\r\n')) {
    const match = /^cmdstat_([^:]+):calls=(\d+)/.exec(line);
    if (match) out[match[1]] = Number(match[2]);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [url, ...args] = process.argv.slice(2);
  const client = redis(url);
  console.log(await client.command(...args));
  client.close();
}
