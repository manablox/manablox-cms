{{#if sqlite}}
- The site process opens the same database file. Its isolation is the site server mode: no auth, no API, no uploads; drafts only through a signed share link.
{{#else}}
- The site process connects as `manablox_public` too, so it can only read.
{{/if}}
