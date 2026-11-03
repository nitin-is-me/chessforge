# Computer and analysis flow

## What it covers

Why Stockfish runs in the browser, how computer games work, and how post-game analysis happens.

## Two different engines

- **Rules engine:** chess.js on the server. It decides whether a move is legal in live play. This is authoritative.
- **Analysis engine:** Stockfish in a Web Worker on the player's machine. It evaluates positions. This is advisory.

They are not the same trust boundary. The server never asks Stockfish whether a move is legal.

## Computer games (playing the engine)

1. The browser starts a local game against Stockfish.
2. Stockfish runs in a Web Worker on the player's machine.
3. The player chooses a level (depth/skill), can take back moves, and plays unclocked.
4. The game is casual and never affects ratings.
5. When the game ends, a signed-in client sends the move list and claimed result to the server.
   A guest's game is kept in the tab instead (see below), because nothing is archived for a
   throwaway identity.
6. The server replays the moves with chess.js to check legality.
7. The server **accepts the client's claimed result and reason** and stores the game as casual.

The server does not re-adjudicate the result. A legal move list + any claimed result = stored game.

## Why run Stockfish in the browser?

- **No server CPU cost.** Analysis scales with the user's device, not your hosting bill.
- **Privacy.** Positions never leave the browser.
- **No queue.** Immediate feedback instead of waiting for a server job.
- **Simpler deployment.** The engine is a static asset served from the same origin.

## Why the lite, single-threaded build?

- The single-threaded WASM build does not need `SharedArrayBuffer`.
- `SharedArrayBuffer` requires cross-origin isolation headers (COOP/COEP), which add deployment complexity and can break embeds/popups.
- The lite build downloads faster and uses less memory.
- Multi-threaded would be stronger but needs those headers and more resources. For this product, the extra strength was not worth the operational cost.

## Guest review without an archive

A guest has no account, so their computer game is never stored on the server. The client keeps the
finished game in `sessionStorage` (the last six games) and the analysis page reads it from there with
a `local-` id. The record carries only what the review needs: the moves, the final position, the time
control and the two names.

- Nothing is sent anywhere, so the privacy story above still holds.
- The copy dies with the tab, and a different tab cannot open it.
- The game does not appear on the profile, and it cannot be shared — nothing else has the moves.
- Account holders still get the server archive, which is the durable copy.
- If the guest creates an account from the review page, that page posts the stored game to the archive
  endpoint once, records the archived id on the local copy, and replaces the `local-` URL with the real
  game URL. Revisiting the old local URL follows the archived id instead of posting a duplicate.

## Post-game analysis flow

1. The user opens an archived game, or a guest opens the `local-` game from the tab that played it.
2. The browser walks through the positions one at a time.
3. For each position, it asks the local Stockfish worker for an evaluation.
4. Progress is tracked and shown.
5. Evaluations are flipped to White's point of view.
6. The evaluation before and after each move is compared.
7. From the evaluation drop, the system derives:
   - Win probability (using the published formula).
   - Accuracy per move.
   - Move labels: best, good, inaccuracy, mistake, blunder.
8. Centipawn scores are clamped so decisive positions don't produce extreme numbers.

The analysis runs locally, in the foreground, one position at a time. Closing the tab stops it. The result is not stored on the server.

Copying the game as PGN also happens in the browser (`client/src/lib/pgn.ts`), built from the
stored move list in the same shape the server writes. That is what lets a guest export a game the
server never received.

## Trade-offs

- **Local engine** = private, free, no queue, but not reproducible and not verifiable by the server.
- **Single-threaded** = no isolation headers, simpler deploy, but slower and weaker than multi-threaded.
- **Computer games** = the server checks move legality but trusts the claimed result. This is a deliberate trust boundary.
- **Analysis** = private and immediate, but lost if the tab closes and not stored.
- **Guest review** = no account and no server write, at the cost of a copy that lives only in the tab.

