# Security policy

## Reporting a vulnerability

Please do not open a public issue, pull request or discussion for a security problem.
Report it privately through GitHub's private vulnerability reporting:
[github.com/manablox/manablox-cms/security/advisories/new](https://github.com/manablox/manablox-cms/security/advisories/new)
(the repository's **Security** tab, then **Report a vulnerability**).

A useful report names the affected package(s) and version, what an attacker can do, and
the steps or a proof of concept that shows it. We confirm receipt, keep you posted while
we work on a fix, and credit you in the advisory unless you would rather not be named.
Please give us a reasonable time to release the fix before you disclose the problem.

This covers everything in this repository: the `@manablox/*` packages published from it,
the admin, and the images `ghcr.io/manablox/cms-api` and `ghcr.io/manablox/cms-admin`. A problem in
a premium plugin goes to that plugin's own repository.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.50.x | Yes |
| older | No |

Fixes are released as a new patch version of the supported line; upgrade to the newest
patch to get them.
