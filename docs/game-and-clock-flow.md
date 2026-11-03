# Game and clock flow

## What it covers

What happens from the moment both players are seated until the game ends.

## The live game loop

1. Game starts. Both clocks are set to the base time. The side to move is white.
2. The player sends a move with the expected ply number.
3. Server checks: game running, player in game, player's turn, ply matches current position.
4. Server replays the move with the rules engine to confirm legality.
5. Server calculates elapsed time since the turn started.
6. Server applies lag compensation (see lag-compensation-flow.md).
7. Server subtracts the charge, adds the increment, switches the turn and restarts the opponent's clock.
8. Server broadcasts the move and updated snapshot to the room.
9. Server queues the move and clock state for persistence.
10. If the move ends the game, the finish flow takes over.

## The client clock

The client does not run the authoritative clock. It receives a snapshot with:

- remaining time for each player,
- whose turn it is,
- when the server started the current turn.

The client estimates the current time from that snapshot and syncs periodically. The display is close but never authoritative.

## Flagging

An in-process timer watches the clock. When the remaining time reaches zero, the server flags the game.

- If fewer than two plies have been played, the timeout is treated as an abort (no rating change).
- If two or more plies, it is a rated loss (unless the game was already casual).

## Reconnect and resume

On reconnect, the server sends a fresh snapshot with the authoritative clock state. The client does not replay its own clock.

On server restart, unfinished games are reloaded, moves are replayed to rebuild the board and clocks, and a short grace is added before play resumes.

## Trade-offs

- **Server authority** means the browser cannot cheat the clock.
- **Arithmetic clock** avoids drift and works across disconnects.
- **Lag compensation** keeps honest latency from costing time.
- **No browser pause** on disconnect; a long absence can be claimed or lost on time.

