## ChessForge

> Live website can be viewed here: https://chessforge-k916.onrender.com/

ChessForge is a **free, ad-free, open-source chess platform** that I built mostly for fun. I wanted a
chess site that gets out of the way: no ads, no popups, no "sign up to see your accuracy". The clock
is owned by the server, a short connection drop doesn't automatically forfeit the game, and the engine
review runs entirely on your own machine. <br>
> **The whole thing is open source, so you can read every line that decides your rating.**

I honestly started this as a weekend toy to see whether I could get server-side clocks right, then I
got weirdly obsessed with the lag compensation and the rating maths and here we are, six months
later.

> [!IMPORTANT]
> **Project Status: Feature Complete & Maintenance Mode**
>
> ChessForge is feature complete. Variants, puzzles, tournaments and correspondence are
> deliberately out of scope, so from here the repo mostly gets bug fixes, dependency bumps and
> security patches. It's AGPL, so if you want to fork it and add the things I said no to, please go
> ahead, I'd love to see it.

## Features

### Play without making an account
You can sit down and play in two clicks. Guests get their own identity and their own games, no email,
no username picking, no "verify to continue". The only thing guests can't do is play **rated** games,
because a rating attached to a throwaway identity is just noise. Create an account later and your
ratings start fresh at 1500.

### Pick your pace, not mine
Ten time controls from 1+0 bullet to 30+0 classical, grouped into the usual four categories. Quick
pair drops you into a pool and matches you by rating; wait longer and the rating window widens so you
aren't stuck staring at a spinner at 2 AM. Rated is a checkbox, and classical is casual-only (a
40-minute game deciding someone's rating because their Wi-Fi died felt cruel).

### Private games, and you actually choose the mode
"Create a private game" used to just take whatever time control happened to be first on the tab you
were looking at, which was quietly terrible. Now there's a picker right there: choose the control,
hit create, share the link. The clock only starts when both players are seated, so the link doesn't
burn down while your friend is still making tea.

### Play the computer (it lives in your browser)
Eight levels of Stockfish 19 lite, from "learning the pieces" to "please stop". Takebacks are allowed
because it's a computer and it won't judge you. Computer games are casual and unclocked, and finished
ones get archived so you can run the analysis on them later.

### The clock belongs to the server
Every move is replayed server-side with chess.js before it's accepted, and each side has an
authoritative remaining time. A move is charged `max(10 ms, elapsed - compensation)`, then the
increment is added. The on-screen clock uses the same compensation rule, with the server applying the
final minimum charge. Refresh the tab mid-game and you come back to the same position and the correct
live clock, not a resignation.

### Lag compensation that can't be farmed
This was the most fun part to get right. Subtracting raw ping means a cheater can *inflate* their ping
for free thinking time, so instead each side gets a lag quota that gets spent on compensation, capped
per move (200 ms bullet, 400 ms blitz, 1000 ms rapid and classical) and refunded slowly afterwards.
One bad move can never buy you more than the cap.

### Chat that asks first
Chat is consent-based. Your opponent has to accept before a single message is delivered, which
removes the whole genre of "random person opens with an insult". Decline and you never see it. There's
a report button with a required reason too, because obviously.

### Everything you'd expect in a game, plus the annoying bits
Offer draws (with a proper banner when one arrives), resign with a confirm step so you can't fat-finger
it, abort before the game really starts, claim a threefold repetition or the fifty-move rule, claim the
win if your opponent vanishes, and rematch instantly with colours swapped. PGN export is one click.

### Friends, presence and challenges
Add friends by username, see whether they're online or in a game, and challenge them directly with a
time control. Blocking works too: blocks are checked for friend requests, challenges, pool matching
and joining a waiting room. Accepting an existing challenge and spectating an already-started game are
the exceptions.

### Engine review, locally
Stockfish runs in a Web Worker on your machine, so there's no server CPU bill and no cross-origin
isolation headers to fight. You get per-move accuracy, the win-probability swing, and labels
(best / good / inaccuracy / mistake / blunder). Win% uses
`50 + 50 * (2/(1+exp(-0.00368208*cp)) - 1)` and per-move accuracy uses
`103.1668*exp(-0.04354*(winBefore-winAfter)) - 3.1669`, both clamped at ±1000 cp, so the numbers are
the published formulas rather than something I made up.

### Ratings that actually mean something
Glicko-2, one rating period per game, applied separately per category (bullet / blitz / rapid /
classical), because being 1800 at bullet and 1200 at classical shouldn't average out to nonsense.
Everyone starts at 1500 with RD 350, provisional ratings are marked with a `?`, and a rated game only
counts if both players are registered, it isn't classical, and it wasn't aborted. That gives a two-ply
floor in normal play; the exception is an absence claim, which can settle after one ply.

### Restart-safe games
Unfinished games live in Postgres with every move and clock value. On boot the server replays them and
resumes each clock *after a 30 second grace*, so a restart is not automatically adjudicated as a loss.
The grace applies to server restarts; a browser reconnect does not pause the clock.

### Boards and sounds that stay quiet
Three board palettes (Forge, Midnight, Sand), recorded move/capture/check/castle/illegal clips from the
PyChess sound pack plus synthesised start/end/chat/notify cues, and every preference saved locally on
your device.

### Email, but only if you want it
No account needs an email. If you do add one, verification and password reset go through Brevo, the
token is single-use, verification links last 24 hours, reset links last 30 minutes, only the token's
SHA-256 is stored, and a password reset kills every existing session.

> [!NOTE]
> **Server-authoritative for live games**: moves, clocks, ratings and results are never trusted from
> the browser. Spectators get a fresh snapshot, with a few viewer-specific fields; live snapshots also
> include room chat, so a spectator in the room can see it. Archived computer games are the exception:
> the server replay-checks the moves but accepts the client's claimed result and stores the game as
> casual. Live play sends only the moves, chat and actions you choose. Engine review never sends a
> position anywhere.

## For nerds

- **Frontend**: React 19 + Vite, Tailwind v4, chessground for the board, zustand for the small amount
  of client state, React Router for the routes.
- **Backend**: Node with Express 5 and Socket.IO 4 in a single process. Strict TypeScript across
  client, server and shared code.
- **Database**: Postgres with Prisma. Moves and clock values are written in one transaction with the
  move itself, so the write cannot half-apply. The move is broadcast before that transaction commits,
  so a crash can still lose the last broadcast move.
- **Rules**: chess.js replays every position server-side before anything is broadcast.
- **Ratings**: a pure Glicko-2 module (no I/O), checked against Glickman's worked examples in
  `tests/glicko2.test.ts`.
- **Security**: random 256-bit session ids in an `HttpOnly`, `SameSite=Lax` cookie with only the hash
  stored, scrypt passwords, an `Origin` check on state-changing requests that rejects foreign origins
  (requests with no `Origin` header are allowed), mostly per-IP HTTP rate limits, per-socket limits on
  game actions, and a Helmet CSP in production.
- **Engine**: Stockfish 19 lite (single-threaded WASM) in a Web Worker, served from the same origin.
- **Hosting**: `render.yaml` for Render, plus a `Dockerfile` for anywhere else. Run it as a single
  instance, because flag timers live in process memory.
- **Testing**: Vitest unit tests (including a board-colour check that reads the board CSS rule, so the
  checkerboard cannot flip again), a real two-session smoke test, optional Postgres integration tests
  (`RUN_DB_TESTS=1`), and a socket load-test script.

## Version History
> Development history: The original Git history was accidentally lost and could not be recovered. The version history below documents the project's major development milestones and releases.

| Version | Date           | Summary                                                                                                                                                                                |
| ------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0.0   | **05-May-2026** | Started the repo. Scaffold only: Vite/TS config, ignore rules, the time-control classification maths and the shared protocol types. Nothing playable yet.                              |
| 1.1.0   | **16-May-2026** | Prisma schema and the first migration. Users, games, moves and the friend/block model, which took far longer to get right than it had any right to.                                   |
| 1.2.0   | **27-May-2026** | Accounts: scrypt password hashing and cookie sessions where only the SHA-256 of the token is stored.                                                                                    |
| 1.3.0   | **10-Jun-2026** | The clock and the rules engine. Every move gets replayed server-side with chess.js before it counts.                                                                                   |
| 1.3.1   | **18-Jun-2026** | Wrote the clock and rules tests after one too many "it works on my machine" moments.                                                                                                    |
| 1.4.0   | **22-Jun-2026** | Email verification and password reset through Brevo. Single-use tokens, hashed, 30 minute expiry, reset kills all sessions. (Verification links now last 24 hours; reset links still expire after 30 minutes.)                                                            |
| 1.5.0   | **29-Jun-2026** | Glicko-2. Checked against the published worked example before I trusted it with anyone's rating.                                                                                        |
| 1.6.0   | **11-Jul-2026** | Rating-windowed pools and the game manager (seating, flag timers, restart recovery).                                                                                                    |
| 2.0.0   | **27-Jul-2026** | BIG UPDATE: it's actually multiplayer now. Socket layer for moves, clocks, resign and rematch, plus presence, the REST API for rooms/friends/reports, and metrics.                      |
| 2.1.0   | **09-Aug-2026** | Client scaffold and design tokens. Dark theme, chessground board, typed API and socket clients.                                                                                         |
| 2.2.0   | **06-Sep-2026** | The lobby: quick pair tabs, presets and shareable private room links.                                                                                                                   |
| 3.0.0   | **29-Sep-2026** | Live game screen: clocks, move list, consent-based chat, draw/resign/abort/rematch and spectator mode.                                                                                  |
| 3.1.0   | **04-Oct-2026** | Bundled Stockfish 19 lite as WASM so analysis could run in a worker without server cost.                                                                                               |
| 3.2.0   | **09-Oct-2026** | Play the computer, eight levels, with takebacks and archived games. Finally something to do when the pools are empty.                                                                   |
| 3.3.0   | **14-Oct-2026** | Post-game analysis: per-move accuracy, win% swing, and best/good/inaccuracy/mistake/blunder labels.                                                                                     |
| 3.4.0   | **19-Oct-2026** | Sign up, sign in and account screens, with the optional email flow wired in.                                                                                                            |
| 3.5.0   | **24-Oct-2026** | Settings, profiles and the welcome flow. Board themes, synthesised sounds and per-category ratings in one place.                                                                        |
| 3.6.0   | **26-Oct-2026** | Friends, live presence and direct challenges.                                                                                                                                           |
| 3.7.0   | **29-Oct-2026** | Docker + Render config, a smoke test, a socket load-test harness and a UI fixture script.                                                                                              |
| 3.8.0   | **31-Oct-2026** | Integration tests against a real Postgres (skipped unless `RUN_DB_TESTS=1`), covering rating commits and single-use email tokens.                                                       |
| 4.0.0   | **01-Nov-2026** | Final pass: the homepage now shows every time control instead of pushing a single 10+5, private games let you pick the mode, the footer credits the author and links the repo. Done.     |
| 4.0.1   | **02-Nov-2026** | Phone pass. The board was dropping frames because of a fixed background, a shadow filter on all 32 pieces and a redraw on every render, so all of that went. Coordinates moved into a gutter (the letters were being painted on top of the bottom rank), and the computer page lost its duplicate start buttons. |
| 4.1.0   | **02-Nov-2026** | Real sounds at last: recorded move, capture, check and castle clips instead of oscillators, and the loud piece-dropping start cue replaced with the old quiet chord. Games end with a colour-coded result banner that also shows the rating change, and the computer takes a beat to think instead of answering on the same frame as your move. |
| 4.2.0   | **02-Nov-2026** | UX pass. The game screen is now one locked viewport on phone and desktop, with no page scrolling: result banners can be dismissed, the phone dock carries the main actions and the More sheet is grouped and thumb-sized, chat and draw offers finally sound different, and there's a fullscreen toggle. The computer screen uses the same fixed layout, challenges ask which time control to send, a declined challenge tells the challenger instead of leaving "Sent" hanging, and the friends list shows a skeleton instead of claiming you have no friends while it loads. |
| 4.3.0   | **03-Nov-2026** | Computer games get the fullscreen toggle they were missing, and the computer board gains move navigation: first, previous, next and latest buttons under the board, arrow and Home/End keys, and a move list you can click to jump to any ply. Stepping back pauses board input until you return to the live position, and the layout reserves room for the extra row on phone and desktop. |
| 4.3.1      | **03-Nov-2026** | Lag compensation was quietly punishing honest bullet players. The quota was a flat 800 ms pool refilling 50 ms a move, so at 150 ms round-trip it was empty after about six moves and every later move was billed its full network time, costing roughly five seconds over a 1+0 game. The quota is now a per-game budget sized to the time control (6 s bullet, 9 s blitz, 12 s rapid and classical), still capped per move, with the quota itself bounded.                                                                                                                       |
| 4.3.2      | **03-Nov-2026** | The analysis page finally fits in one view like a game does. It was a normal scrolling page, so the board, the grade for the move you selected and the move list could never be seen together — on phones the accuracy cards pushed the move list past the fold entirely. The page is now locked to the viewport: board, navigation and a compact evaluation graph in one column, with a verdict row (move, best/good/inaccuracy/mistake/blunder, accuracy, eval) and a scrolling move list beside it on tablet and desktop and directly beneath it on phones, where both players' accuracy shrinks to a single line. The board steps with arrow keys and Home/End, matching the computer screen, and the header and footer get out of the way. |
| 4.3.3      | **03-Nov-2026** | Guests can review a computer game without making an account. The review link only existed for archived games and archiving needs an account, so a guest's finished game offered nothing but "Save this game" — even though the engine runs locally and the server is not needed for the review. A finished guest game is now kept in the tab (the last six, in sessionStorage) and the analysis page reads it from a `local-` id, with a line saying the game lives in that tab. Making an account from that page archives the stored game to it and swaps the short local URL for the real one, so the review joins their history instead of dying with the tab. Accounts still archive to the server as before. |
| 4.3.4      | **03-Nov-2026** | The analysis page can copy the game as PGN, which it was missing even though the game screen has offered that for a while. The PGN is built in the browser from the move list in the same shape the server writes, so it also covers a guest's game that was never archived.                                                                                                                       |
| 4.3.5      | **03-Nov-2026** | The board's squares were the wrong colours. The checkerboard is one conic-gradient tile and its stops started at the top-right with the light shade, so every square sat one step out of phase: a1 was light and h1 dark, which also put both queens on the wrong colour. The tile is flipped so a1 is dark and h1 light, and a test reads the CSS rule and checks all 64 squares.                                                                                                                       |

## Running it yourself

You need Node 22.5+ (it uses the built-in `process.loadEnvFile`) and a Postgres 14+ database.

```bash
npm install
cp .env.example .env        # then set DATABASE_URL and SESSION_SECRET
npx prisma migrate deploy   # create the tables
npm run dev                 # server on :3000, client on :5173
```

Open <http://localhost:5173>. For a production-style run, `npm run build && npm start` serves the
built client and the API from a single process on `:3000`.

The important variables are `DATABASE_URL`, `APP_ORIGIN` (which defaults to localhost), and in
production `SESSION_SECRET`. That last one is currently a deployment guard rather than a cryptographic
key; sessions use random tokens and SHA-256 storage. `DIRECT_URL` helps if your host gives you a
pooler, `EMAIL_API_KEY` and the `EMAIL_*` variables turn on verification and reset mail, and
`METRICS_TOKEN` protects `/api/metrics`. With the email variables unset everything else still works,
accounts just can't verify or recover.

## Licence

[AGPL-3.0-or-later](LICENSE). I picked AGPL over plain GPL on purpose: GPL only kicks in when someone
*distributes* the code, so with GPL alone anyone could run a modified ChessForge as a public service
and never publish their changes. The Affero network clause closes that hole, which matters a lot for
something that lives in a browser.

The bundled third-party bits keep their own licences: chessground (GPL-2.0+), the cburnett piece SVGs
(GPL-2.0+) and Stockfish (GPL-3.0, full text in `client/public/engine/COPYING.txt`). Mixing GPL-3.0
code in is exactly why the combined work can't just be MIT.

The board sounds ship with PyChess and are licensed GPL-3.0-or-later. They're peak-normalised to sit
at a consistent volume and live in `client/public/sounds`. Lichess's `standard` set is listed under
its non-free exceptions, and its free sets are synthesised, so neither of those is used here.
