# `@manablox/auth`

Everything about who is calling and what they may do.

- **Sign-in and sessions** with email and password, built on better-auth.
- **API keys** for scripts and websites, optionally limited to certain spaces.
- **Roles and permissions** per space, like "may publish posts".
- **The first account** created on a new CMS becomes the superadmin. After that, open sign-up closes and new accounts are created in the admin under Settings > Users.

Passwords are hashed with Argon2.

## Do I need to install it?

Usually not. `@manablox/server` installs and uses it for you. You only import it
directly when you build your own server setup or a plugin that needs it.

## Main exports

- `createAuth(config, db)`: sets up sign-in, sign-out and sessions.
- `resolvePrincipal(...)`: finds out who sent a request: a signed-in user, an API key, or nobody. The result is a `Principal`.
- `can(principal, spaceId, permission)`: `true` if the principal may do this in the space.
- `assertCan(...)`: the same, but throws a "forbidden" error instead of returning `false`.
- `ApiKeyService`: issues, lists, checks and revokes API keys.
- `UserService`: manages user accounts.
- `PasswordResetService`: "forgot password" mails and one-time links that let a person set a new password. Pass it to `createAuth` as `passwordResets`.
- `hashPassword(password)`, `verifyPassword(stored, password)`: store and check passwords safely.
- `promoteFirstUser`, `attachBootstrapOwner`: make the first account the superadmin.
