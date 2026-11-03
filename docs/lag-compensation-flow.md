# Lag compensation flow

## What it covers

How the server gives honest players credit for network latency without letting cheaters fake latency to get free time.

## The problem

If you just subtract the player's measured ping from the elapsed time, a cheater can add delay (e.g., a proxy, a script) and get free thinking time. The more lag they fake, the more free time they get.

## The solution: a bounded quota

Each player gets a **lag quota** — a budget of compensation time.

- The budget is sized to the time control: bullet gets ~6s, blitz ~9s, rapid and classical ~12s.
- Per-move compensation is capped: 200ms bullet, 400ms blitz, 1000ms rapid/classical.
- After each move, the quota refills slowly (50ms/move bullet, 100ms/move blitz, 200ms/move rapid/classical).

## The per-move flow

1. The server measures how long the move actually took (wall time from turn start to move arrival).
2. The allowed compensation is the minimum of:
   - the player's remaining quota,
   - the per-move cap,
   - the elapsed time itself.
3. The clock is charged for `elapsed - compensation`.
4. A tiny minimum charge (10ms) is enforced so an instant move is never completely free.
5. The increment is added.
6. The quota is reduced by the compensation used.
7. The quota refills up to its maximum.

## Why it works

- An honest connection gets its real round-trip time compensated.
- A cheater can inflate one move, but the quota drains and refills slowly. They cannot farm unlimited free time.
- The budget is sized so a normal game stays within it; only a deliberately inflated connection runs out.

## The client display

The client uses the same formula for the on-screen clock, but the server applies the final minimum charge. The display can be a few milliseconds more generous than the enforced charge; the next snapshot corrects it.

## Trade-offs

- **Honest latency is covered** without trusting the client's ping.
- **Fake latency is capped** by the quota and per-move limit.
- **More complex** than a simple countdown; the display can briefly disagree with the server.
- **Bullet is tighter**; a bad connection can exhaust the quota, but that is the intended cost of inflating latency.

