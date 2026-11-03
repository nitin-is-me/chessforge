# Identity flow

## What it covers

How someone becomes a user, how a guest becomes an account, how sessions work, and how email verification and password reset fit in.

## Guest flow

1. A first-time visitor arrives without an account.
2. The server creates a guest user and a session.
3. The browser receives an HttpOnly cookie.
4. The guest can play casual games immediately.

That is why the site can be used in two clicks. There is no email, no username choice and no “verify to continue” step before playing.

The guest identity is real: it has a user row, games and a session. It is not just a temporary browser state. That is what lets a guest later upgrade to an account and keep their games.

## Account upgrade flow

1. The guest chooses to create an account.
2. The existing guest identity is upgraded in place rather than replaced.
3. Their games remain attached to the same user.
4. Their ratings start fresh because the guest had no rating history.

The product idea is “play first, sign up later”. The trade-off is that unauthenticated traffic creates database rows, so the server has to rate-limit guest creation and treat guest identities as cheap but real.

## Login and session flow

1. A user signs in with a username or email and password.
2. The server verifies the password with scrypt.
3. The server creates a random session token.
4. The browser gets the token in an HttpOnly cookie.
5. The server stores only a hash of the token.

The session token is opaque. There is no signed claim inside it and no client-side identity the server trusts. Every request with the cookie is resolved against the session row.

Why this way? A random token with a hashed server-side copy is simple and does not require a signing key. It also means a stolen database row does not directly hand over working session tokens.

One nuance: the production environment requires a session secret, but the current code does not use it cryptographically. It acts as a deployment guard, not a signing key. That is worth saying honestly in an interview.

## Email verification flow

1. The user adds an email address.
2. The server creates a single-use verification token.
3. Only the token's hash is stored.
4. The user receives a link by email.
5. The link is valid for 24 hours.
6. Clicking it marks the email as verified.

Email is optional. If email is not configured, the rest of the site still works; accounts just cannot verify or recover through email.

## Password reset flow

1. The user requests a reset for an email address.
2. The server always responds as if the request succeeded, to avoid revealing which addresses exist.
3. If the address exists, a single-use reset token is created and emailed.
4. The reset link is valid for 30 minutes.
5. Submitting a new password consumes the token and invalidates existing sessions.

Why the short reset window? A reset token is more sensitive than a verification token. Verification only proves ownership of an email; reset can take over the account.

Why invalidate sessions? If someone resets a password because the account was compromised, the attacker's existing session should stop working.

## Trade-offs

- **Guest-first** is great for conversion and friction, but it creates database rows before trust is established.
- **Opaque sessions** avoid signing-key complexity, but the current secret is not used as a key.
- **Optional email** keeps signup simple, but users without email cannot recover an account.
- **Hashed tokens** protect the database, but the link itself is still a bearer credential until it is used or expires.


