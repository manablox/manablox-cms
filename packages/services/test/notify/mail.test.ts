import type { MailTransportConfig } from '@manablox/core';
import { describe, expect, it } from 'vitest';
import { createMailer } from '../../src/notify/mail.js';
import { createMailTransport, parseAddress } from '../../src/notify/mail-transports.js';

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** A fetch that answers from a table by URL prefix and remembers every request. */
function recorder(answers: Array<[string, () => Response]>) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: String(init?.body ?? ''),
    });
    const answer = answers.find(([prefix]) => url.startsWith(prefix));
    if (!answer) throw new Error(`unexpected request to ${url}`);
    return answer[1]();
  }) as typeof fetch;
  return { calls, fetch: fetchImpl };
}

const json =
  (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

const message = {
  from: 'Manablox <cms@a.test>',
  to: ['one@b.test', 'two@b.test'],
  cc: ['cc@b.test'],
  subject: 'Grüße',
  text: 'plain',
  html: '<p>html</p>',
};

const send = (config: MailTransportConfig, fetchImpl: typeof fetch, now?: () => number) =>
  createMailTransport(config, { fetch: fetchImpl, ...(now ? { now } : {}) });

describe('transactional API transports', () => {
  it('Resend: bearer key, both bodies, its id back', async () => {
    const { calls, fetch } = recorder([['https://api.resend.com/emails', json({ id: 're_1' })]]);
    const sent = await send({ driver: 'resend', apiKey: 'rk' }, fetch).send(message);

    expect(sent).toEqual({ id: 're_1' });
    expect(calls[0]?.headers.authorization).toBe('Bearer rk');
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({
      from: 'Manablox <cms@a.test>',
      to: ['one@b.test', 'two@b.test'],
      cc: ['cc@b.test'],
      subject: 'Grüße',
      text: 'plain',
      html: '<p>html</p>',
    });
  });

  it('SendGrid: the sender split into parts, plain text first, the EU host on request', async () => {
    const { calls, fetch } = recorder([
      [
        'https://api.eu.sendgrid.com/v3/mail/send',
        () => new Response(null, { status: 202, headers: { 'x-message-id': 'sg_1' } }),
      ],
    ]);
    const sent = await send({ driver: 'sendgrid', apiKey: 'sk', region: 'eu' }, fetch).send(
      message,
    );

    expect(sent).toEqual({ id: 'sg_1' });
    const body = JSON.parse(calls[0]?.body ?? '');
    expect(body.from).toEqual({ email: 'cms@a.test', name: 'Manablox' });
    expect(body.personalizations).toEqual([
      { to: [{ email: 'one@b.test' }, { email: 'two@b.test' }], cc: [{ email: 'cc@b.test' }] },
    ]);
    expect(body.content.map((part: { type: string }) => part.type)).toEqual([
      'text/plain',
      'text/html',
    ]);
  });

  it('Postmark: the server token header and the configured stream', async () => {
    const { calls, fetch } = recorder([
      ['https://api.postmarkapp.com/email', json({ MessageID: 'pm_1' })],
    ]);
    const sent = await send(
      { driver: 'postmark', serverToken: 'pt', messageStream: 'broadcast' },
      fetch,
    ).send(message);

    expect(sent).toEqual({ id: 'pm_1' });
    expect(calls[0]?.headers['x-postmark-server-token']).toBe('pt');
    expect(JSON.parse(calls[0]?.body ?? '')).toMatchObject({
      To: 'one@b.test, two@b.test',
      Cc: 'cc@b.test',
      TextBody: 'plain',
      HtmlBody: '<p>html</p>',
      MessageStream: 'broadcast',
    });
  });

  it('Mailgun: basic auth as api, a form with one field per recipient', async () => {
    const { calls, fetch } = recorder([
      ['https://api.mailgun.net/v3/mg.a.test/messages', json({ id: '<mg_1@mg.a.test>' })],
    ]);
    const sent = await send({ driver: 'mailgun', apiKey: 'mk', domain: 'mg.a.test' }, fetch).send(
      message,
    );

    expect(sent).toEqual({ id: '<mg_1@mg.a.test>' });
    expect(calls[0]?.headers.authorization).toBe(
      `Basic ${Buffer.from('api:mk').toString('base64')}`,
    );
    const form = new URLSearchParams(calls[0]?.body);
    expect(form.getAll('to')).toEqual(['one@b.test', 'two@b.test']);
    expect(form.get('html')).toBe('<p>html</p>');
  });

  it("puts the provider's answer into the error", async () => {
    const { fetch } = recorder([
      ['https://api.resend.com/emails', json({ message: 'domain not verified' }, 422)],
    ]);
    await expect(send({ driver: 'resend', apiKey: 'rk' }, fetch).send(message)).rejects.toThrow(
      /Resend send answered HTTP 422: .*domain not verified/,
    );
  });
});

describe('mailbox transports', () => {
  it('Microsoft Graph: client credentials once, then sendMail from the sender mailbox', async () => {
    const { calls, fetch } = recorder([
      [
        'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token',
        json({ access_token: 'ms-token', expires_in: 3600 }),
      ],
      [
        'https://graph.microsoft.com/v1.0/users/cms%40contoso.test/sendMail',
        () => new Response(null, { status: 202 }),
      ],
    ]);
    const transport = send(
      {
        driver: 'microsoft',
        tenantId: 'tenant-1',
        clientId: 'client',
        clientSecret: 'secret',
        sender: 'cms@contoso.test',
      },
      fetch,
    );

    await transport.send({ ...message, from: undefined });
    await transport.send({ ...message, html: undefined });

    const tokenCalls = calls.filter((call) => call.url.includes('login.microsoftonline.com'));
    expect(tokenCalls).toHaveLength(1);
    const token = new URLSearchParams(tokenCalls[0]?.body);
    expect(token.get('grant_type')).toBe('client_credentials');
    expect(token.get('scope')).toBe('https://graph.microsoft.com/.default');

    const [first, second] = calls
      .filter((call) => call.url.includes('graph.microsoft.com'))
      .map((call) => ({ ...call, json: JSON.parse(call.body) }));
    expect(first?.headers.authorization).toBe('Bearer ms-token');
    // No From: Graph sends as the mailbox.
    expect(first?.json.message.from).toBeUndefined();
    expect(first?.json.message.body).toEqual({ contentType: 'HTML', content: '<p>html</p>' });
    expect(first?.json.message.toRecipients).toEqual([
      { emailAddress: { address: 'one@b.test' } },
      { emailAddress: { address: 'two@b.test' } },
    ]);
    expect(first?.json.saveToSentItems).toBe(false);
    expect(second?.json.message.from).toEqual({
      emailAddress: { address: 'cms@a.test', name: 'Manablox' },
    });
    expect(second?.json.message.body).toEqual({ contentType: 'Text', content: 'plain' });
  });

  it('Gmail: refreshes the token when it runs out, sends a raw MIME message', async () => {
    let clock = 0;
    let issued = 0;
    const { calls, fetch } = recorder([
      [
        'https://oauth2.googleapis.com/token',
        () => {
          issued += 1;
          return json({ access_token: `g-token-${issued}`, expires_in: 600 })();
        },
      ],
      ['https://gmail.googleapis.com/gmail/v1/users/me/messages/send', json({ id: 'gm_1' })],
    ]);
    const transport = send(
      { driver: 'gmail', clientId: 'c', clientSecret: 's', refreshToken: 'r' },
      fetch,
      () => clock,
    );

    expect(await transport.send(message)).toEqual({ id: 'gm_1' });
    clock = 10 * 60 * 1000;
    await transport.send(message);

    expect(issued).toBe(2);
    const sends = calls.filter((call) => call.url.includes('gmail.googleapis.com'));
    expect(sends[1]?.headers.authorization).toBe('Bearer g-token-2');
    const raw = Buffer.from(JSON.parse(sends[0]?.body ?? '').raw, 'base64url').toString('utf8');
    expect(raw).toMatch(/^From: Manablox <cms@a\.test>/m);
    expect(raw).toMatch(/^To: one@b\.test, two@b\.test/m);
    expect(raw).toMatch(/^Subject: =\?UTF-8\?/m);
    expect(raw).toContain('multipart/alternative');
  });
});

describe('createMailer', () => {
  const logger = { debug: () => undefined } as never;

  it('is null without a transport', () => {
    expect(createMailer({ transport: null }, logger)).toBeNull();
  });

  it('hands the configured sender to a ready-made transport, or none at all', async () => {
    const seen: Array<string | undefined> = [];
    const transport = {
      name: 'mine',
      send: async (mail: { from?: string | undefined }) => {
        seen.push(mail.from);
        return { id: 'x' };
      },
    };
    await createMailer({ transport, from: 'CMS <cms@a.test>' }, logger)?.send(message);
    await createMailer({ transport }, logger)?.send(message);
    expect(seen).toEqual(['CMS <cms@a.test>', undefined]);
  });
});

describe('parseAddress', () => {
  it('splits a display name from the address, and takes a bare address as it is', () => {
    expect(parseAddress('Manablox <cms@a.test>')).toEqual({
      name: 'Manablox',
      address: 'cms@a.test',
    });
    expect(parseAddress('cms@a.test')).toEqual({ name: '', address: 'cms@a.test' });
  });
});
