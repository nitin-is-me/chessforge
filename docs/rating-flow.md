# Rating flow

## What it covers

How a finished game turns into a rating change, and the rules around when a game counts.

## When a game is rated

A game updates ratings only if:

- Both players are registered (not guests).
- The game is not classical (classical is always casual).
- The game was not aborted.
- There is a result.

## The two-ply floor and the exception

In normal play, a game cannot end before both sides have moved:

- Resigning before two plies aborts the game.
- Flagging before two plies aborts the game.
- Abort is only allowed before two plies.
- Draw, mate, stalemate, repetition and 50-move cannot happen before two plies.

The exception is an **absence claim**. If the opponent disconnects, the player can claim the win after one move. This can produce a rated game after one ply.

## The rating calculation

When the game ends and is rated:

1. The manager runs Glicko-2 for the relevant time-control category (bullet, blitz, rapid, classical).
2. One rating period = one game.
3. The update is transactional: both players' rating rows and both rating-change rows commit together.
4. Provisional ratings (few games) are shown with a marker.

## Categories

Each player has four separate ratings: bullet, blitz, rapid and classical. They do not mix. Being 1800 in bullet and 1200 in classical stays that way; they are not averaged.

## Why this way

- Category isolation keeps ratings meaningful for the time control you actually play.
- One game = one period is the standard Glicko-2 model.
- Transactional commit means the database never has a partial rating update.

## Trade-offs

- The "two-ply" rule is enforced by the game-ending rules, not by the rating function itself. The absence-claim exception is a known gap.
- Classical games are excluded from ratings entirely because a 40-minute loss to a disconnect felt unfair.
- Guests can play but never rate; their games are casual by definition.

