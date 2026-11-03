# ChessForge: flow notes

> A flow-first guide to how ChessForge works, written for understanding the system design rather than code reading.

## What this is

ChessForge is a real-time chess site. The browser sends intentions — a move, a resign, a chat request, a rematch — and the server decides what happens. The server owns the board, the clock, the result and the rating. Postgres is the durable record. The deliberate exception is engine analysis: Stockfish runs inside the browser.

These notes explain the flow of each part: what happens, how it happens, and why it was built that way. They avoid code-level detail on purpose. The code can be rebuilt; the flow is what you need to understand and defend.

## How to use this

Read `system-flow.md` first. It gives the whole picture. Then read the flow that matches the topic you want to understand.

## The flows

| File | Flow | One-line summary |
| --- | --- | --- |
| [System flow](system-flow.md) | The big picture | One Node process, HTTP plus sockets, Postgres, local engine. |
| [Identity flow](identity-flow.md) | Guests, accounts, sessions, email | Play first, create an account later, keep the session opaque. |
| [Matchmaking flow](matchmaking-flow.md) | Finding an opponent | Pools, private rooms and direct challenges all end at the same game manager. |
| [Game and clock flow](game-and-clock-flow.md) | A live game from start to finish | The server validates the move, settles the clock and broadcasts the result. |
| [Lag compensation flow](lag-compensation-flow.md) | Fair time over a bad connection | A bounded quota compensates latency without rewarding fake latency. |
| [Persistence and recovery flow](persistence-flow.md) | What survives a crash | Moves are fast and can be lost; results are durable before they are shown. |
| [Rating flow](rating-flow.md) | How a result becomes a rating change | One game is one Glicko-2 period, applied per category in one transaction. |
| [Computer and analysis flow](computer-and-analysis-flow.md) | The engine in the browser | Stockfish runs locally, single-threaded and lite, for cost and privacy. |
| [Security flow](security-flow.md) | What protects the server | Layered checks, with the browser treated as hostile. |
| [Social flow](social-flow.md) | Friends, blocks and chat | Presence is in memory; chat is consent-based; spectators can see live chat. |

## The 30-second summary

> ChessForge is a real-time chess platform where the server owns the game state, the clock, the result and the rating. The browser sends intentions over HTTP and sockets; one Node process validates them, updates the game and writes to Postgres. The clock is server-authoritative with lag compensation, so honest latency is covered but fake latency cannot buy free time. The only thing that runs locally is the chess engine: Stockfish runs in a Web Worker, so analysis costs no server CPU and positions never leave the machine. The main trade-off is that the app is designed as a single process because timers, presence and matchmaking live in memory.

## The five decisions that define the project

1. **The server owns live games.** The browser never sends a clock value or a result it is allowed to decide.
2. **The browser owns the engine.** Stockfish runs locally for privacy, cost and simplicity.
3. **One process owns the live state.** Timers, pools, presence and rate limits are in memory, so horizontal scaling is not supported.
4. **Moves and results have different durability rules.** Moves are broadcast before they are written; results are written before they are broadcast.
5. **Ratings are isolated by category.** Bullet, blitz, rapid and classical are separate Glicko-2 histories.

## What the notes deliberately leave out

They do not walk through files, functions, line numbers or code snippets. Those are implementation details. What matters is that you can explain the flow, the reason for each decision, and the trade-off you accepted.
