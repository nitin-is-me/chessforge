# System flow

## What it is

ChessForge is a single-process web application with three main pieces:

- a React client in the browser,
- a Node server that handles HTTP and live sockets,
- a Postgres database for durable state.

The browser draws the board and sends intentions. The server decides whether those intentions are legal and what they mean. The database records the important parts. The chess engine is the one thing that runs outside the server, inside the browser.

## The main request flow

1. The browser loads the client application.
2. Normal actions go over HTTP: sign up, sign in, load a profile, list games, manage friends, send reports.
3. Live actions go over a persistent socket: moves, chat, draw offers, resign, rematch, presence, matchmaking.
4. One Node process serves both HTTP and sockets.
5. The server updates in-memory game state and writes the durable parts to Postgres.
6. The browser receives snapshots and events and updates the screen.

The key idea is that HTTP is for things that fit a request/response shape, while sockets are for things that happen continuously or need to be pushed to both players at once.

## The live game flow

1. Two players are seated in a game.
2. The server starts the clocks and broadcasts the initial snapshot.
3. A player sends a move over the socket.
4. The server checks that the game is running, the player is in the game, it is their turn and the move is for the expected position.
5. The server validates the move with the rules engine.
6. The server settles the clock and updates the game state.
7. The move is broadcast to the room so players and spectators see it immediately.
8. The move is queued for persistence.
9. If the move ends the game, the finish flow takes over: result, rating update, durability, then broadcast.

The move path is optimised for latency. The finish path is optimised for correctness.

## Why one process

The live state is in memory: game objects, clocks, flag timers, absence timers, matchmaking pools, presence, challenges and rate-limit counters.

Keeping all of that in one process makes the system much simpler. There is no distributed lock, no shared cache, no message bus and no cross-instance coordination. A move updates memory and broadcasts from the same place.

The cost is that the app is not horizontally scalable as written. Running two instances would split the live state, so a player could be connected to one instance while their game lives in another. Supporting that would require shared state and a pub/sub layer for broadcasts.

## Why Postgres

Postgres is the durable record. It stores users, sessions, games, moves, clocks, results, ratings, rating changes, chat links, reports and email tokens.

The database is not the live game loop. The server does not query Postgres for every move. It updates memory first and persists in the background. That is why the app can feel fast while still having a durable history.

## Why the engine is separate

Stockfish is not part of the live game path. Human moves are validated by the server's rules engine. Stockfish is only used for computer opponents and post-game analysis, and it runs locally in a Web Worker.

That separation is deliberate. It keeps the server cheap and the positions private, and it avoids a server-side analysis queue.

## Trade-offs

- **Fast and simple** because one process owns everything.
- **Not horizontally scalable** because that state is process-local.
- **Low-latency moves** because the broadcast happens before the database write.
- **Possible last-move loss** on a crash because the write is queued and not retried.
- **Private analysis** because the engine is local, but analysis speed depends on the user's device.


