## Mail

{{#if mailNone}}
No mail is configured (`MAIL_DRIVER=none`): the workflow email step fails with
`mail.notConfigured`, and notifications reach people in the admin and by push only.
{{/if}}
{{#if mailpit}}
Mail goes to Mailpit (`MAIL_DRIVER=mailpit`), which accepts everything and delivers
nothing: open its inbox at <http://localhost:8025> to read what the CMS sent. Pick a real
driver before real people are meant to receive mail.
{{/if}}
{{#if mailProvider}}
Mail goes out through `__MAIL_DRIVER__` (`MAIL_DRIVER=__MAIL_DRIVER__`). Fill in its variables in
`.env`; until the required ones are set the instance refuses to boot and names the first
one missing.
{{/if}}

`MAIL_FROM` is the sender of every mail. For `gmail` and `microsoft` it defaults to the
mailbox itself; everywhere else set an address the provider lets you send from.

To switch, set `MAIL_DRIVER` and that driver's variables in `.env`, then
{{#if docker}}`docker compose up -d api`{{#else}}a restart of `pnpm dev`{{/if}}. `none` turns mail off.

| Driver | Variables |
| --- | --- |
__MAIL_TABLE__

`SMTP_URL=smtps://user:pass@host:465` replaces the five `SMTP_*` parts.
