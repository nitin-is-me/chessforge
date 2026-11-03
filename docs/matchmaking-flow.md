# Matchmaking flow

## What it covers

How two players end up in the same game. There are three paths: quick pair, private room and direct challenge.

## Quick pair flow

1. The player chooses a time control and rated/casual mode.
2. The client sends a `pool:join` event with the category key.
3. The server adds the player to an in-memory queue for that pool.
4. The matchmaker checks the queue for a suitable opponent:
   - same pool key,
   - not blocked,
   - rating window match.
5. The rating window starts tight and widens the longer both players wait.
6. When a pair is found, the game manager creates the game and assigns colours.
7. The server emits `pool:paired` to both players with the new game id.
8. Both clients navigate to the game screen and the live game flow begins.

If the player leaves the pool before pairing, they are removed from the queue.

## Private room flow

1. The creator picks a time control and rated/casual mode.
2. The server creates a room and returns a shareable link.
3. The clock does **not** start until both players are seated.
4. The second player opens the link, joins the room and is seated.
5. Once both seats are filled, the game starts and the live game flow begins.

This avoids burning clock time while the opponent is on their way.

## Direct challenge flow

1. A player challenges a friend with a chosen time control.
2. The challenge is sent and the recipient sees an accept/decline prompt.
3. Blocks are checked when the challenge is sent.
4. On accept, the game manager creates the game with the challenged player as white.
5. The live game flow begins.

## Rating and category rules

- Classical games are always casual.
- A game is downgraded to casual if either player is a guest.
- The challenge UI preview may show “rated” for classical, but the manager downgrades at creation. The manager is the authority.

## Why this way

- Quick pair: gets people into a game fast with a widening rating window.
- Private room: lets friends set up a game on their own schedule without clock pressure.
- Direct challenge: social path with the same matchmaking rules.

All three paths end at the same game manager, so the live game flow is identical.

## Trade-offs

- Pools, challenges and presence are in memory. A restart clears them.
- The UI preview for classical challenges can be optimistic; the manager fixes it.
- Blocks are checked on send, not again on accept (for challenge) or spectate.

