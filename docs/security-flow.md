# Security flow

## What it covers

How the server protects itself, assuming the browser is hostile.

## The security layers

1. **Session tokens:** random 256-bit tokens, stored as SHA-256 hashes, delivered in HttpOnly SameSite=Lax cookies.
2. **Passwords:** scrypt (N=32768, r=8, p=1), per-password salt, NFKC normalisation.
3. **Email tokens:** single-use, hashed, time-limited (24h verify, 30m reset), consumed on use.
4. **Origin checks:** state-changing HTTP routes and socket events run `requireSameOrigin`. A present foreign origin is rejected. A missing origin is allowed.
5. **Rate limits:** in-memory, mostly per-IP for HTTP, per-socket for game actions. One report limiter is per-user.
6. **CSP:** Helmet with a production CSP (script-src 'self' 'wasm-unsafe-eval', worker-src 'self' 'blob:').
7. **Socket checks:** every game event validates the player is in that game and it's their turn (for moves).

## Two important nuances

### The origin check allows missing headers

`requireSameOrigin` rejects a present origin that is not allowlisted. It allows a request with **no origin header at all**. This is intentional for non-browser tools and smoke tests, but it means the check is not a complete CSRF boundary.

### Rate limits are not per-account

Most HTTP limiters are per-IP. Socket limiters are per-socket. A user with many sockets gets many budgets. Guests can create many identities, which also creates many budgets.

## What the server does not trust

- No clock value from the client.
- No game result from the client (except computer game archive).
- No move without server-side legality check.
- No session without the cookie and server-side hash lookup.

## Known gaps

- `/api/admin/reports` requires an account but not an admin role.
- `SESSION_SECRET` is required in production but not used cryptographically (sessions are random tokens + hashes).
- Spectator chat is broadcast through the game room; spectators can receive live chat.
- No persistence-queue flush on shutdown.
- Move writes are not retried; finish retries once and is not idempotent.

## Why this way

Each layer covers a different failure mode. The browser is treated as hostile. The server enforces everything.

## Trade-offs

- **Layered defence** is stronger than a single gate.
- **Missing origin allowed** is a deliberate usability choice for tools, not an oversight.
- **In-memory rate limits** work for a single process but are not a strong anti-abuse system.
- **Known gaps** are documented trade-offs, not forgotten features.

