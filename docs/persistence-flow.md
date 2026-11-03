# Persistence and recovery flow

## What it covers

What is written, when, and what survives a crash or restart.

## Two different durability paths

### Moves (fast, best-effort)

1. Server updates in-memory game state.
2. Server broadcasts the move to the room immediately.
3. Server queues the move + updated game summary for the database.
4. The database write is a single atomic transaction (move row + game summary).
5. No retry on failure; the error is logged.

Why this order? Latency matters for live play. A move that arrives 50ms later feels worse than a move that might be lost in a rare crash.

### Game end (durable before visible)

1. Server persists the result, both rating rows and both rating-change rows in one transaction.
2. If the first attempt fails, it retries once.
3. Only after the transaction succeeds does the server broadcast the final result.

Why this order? A player should never see a rating change the database did not accept.

## Recovery on restart

1. Server starts and finds games that were still running.
2. For each game:
   - Loads the game and its moves from Postgres.
   - Replays the moves to rebuild the board position.
   - Reconstructs the clocks from the move history.
   - Adds a short restart grace to both clocks.
3. Resumes the games; they appear in the lobby as active.

Finished games are not rehydrated the same way; they are just history.

## What can be lost

- The last broadcast move if the process crashes before its queued write completes.
- A finished game's rating update if the retry applies twice in an ambiguous commit (no unique constraint on rating change per game).
- Chat messages are not in the game transaction; a failed chat write is lost.
- Shutdown does not wait for the persistence queue to drain.

## Trade-offs

- **Moves are fast** because broadcast comes first.
- **Results are safe** because durability comes before broadcast.
- **Moves can be lost** on crash; results can be applied twice on retry ambiguity.
- **No automatic retry** for moves; the queue is ordering, not durability.

