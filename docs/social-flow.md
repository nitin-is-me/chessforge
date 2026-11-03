# Social flow

## What it covers

Friends, presence, blocking and chat — the social layer that sits on top of games.

## Friends and presence

- Friends are added by username.
- Presence (online / in-game) is stored in memory.
- The friend list shows real-time status.
- A restart clears presence; it rebuilds as players reconnect.

## Blocking

Blocks are checked at these points:

- Sending a friend request.
- Sending a challenge.
- Matching in a pool.
- Joining a waiting room.

Blocks are **not** re-checked when:

- Accepting an existing challenge.
- Spectating a game that already started.

## Chat

Chat is consent-based:

1. One player requests chat.
2. The other accepts or declines.
3. Only after acceptance can messages be sent.

Messages are broadcast to the game room. This means:

- Players in the game see chat.
- Spectators in the room can also receive live chat.

The UI implies chat is private to the two players, but the server does not filter by role.

## Trade-offs

- **In-memory presence** is fast and simple but not durable.
- **Consent-based chat** avoids unwanted messages, but the server does not enforce privacy from spectators.
- **Block exceptions** keep the flow simple for challenge acceptance and spectating, but a blocked user can still interact in those specific cases.

## Why this way

Social features are secondary to the core game. Keeping them in memory and simple was the right trade-off for a small project. The chat privacy gap is a known limitation, not an oversight.