import { Link } from 'react-router-dom';
import { useSession } from '../store/session';
import { PRESETS } from '@shared/timeControl';

export default function WelcomePage() {
  const { user, guest } = useSession();
  const rating = user?.ratings.blitz?.rating ?? 1500;

  return (
    <div className="page py-10">
      <div className="mx-auto max-w-2xl">
        <span className="chip chip-accent">Account ready</span>
        <h1 className="mt-4 font-display text-4xl leading-tight sm:text-5xl">
          Welcome to the forge{user ? `, ${user.displayName}` : ''}.
        </h1>
        <p className="mt-3 text-forge-muted">
          {guest
            ? 'You are still browsing as a guest. Create an account to keep ratings and history.'
            : 'Your ratings start provisional at 1500 and settle as you play. Provisional results move faster, which is why the first games feel swingy.'}
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {PRESETS.filter((preset) => ['3+2', '5+3', '10+0'].includes(preset.id)).map((preset) => (
            <div key={preset.id} className="panel p-4">
              <div className="font-display text-2xl">{preset.label}</div>
              <div className="mt-1 text-xs uppercase tracking-wide text-forge-faint">{preset.category}</div>
              <div className="mt-2 text-sm text-forge-muted">
                Start rating {rating} · provisional
              </div>
            </div>
          ))}
        </div>

        <div className="panel mt-4 p-5">
          <h2 className="font-display text-xl">Three things worth knowing</h2>
          <ol className="mt-3 space-y-3 text-sm text-forge-muted">
            <li>
              <span className="text-forge-text">The server owns the clock.</span> Refreshing or losing
              Wi-Fi never costs you a game — rejoining restores the exact position and remaining time.
            </li>
            <li>
              <span className="text-forge-text">Chat is consent-based.</span> Your opponent must accept
              before messages are delivered, and you can always report abuse.
            </li>
            <li>
              <span className="text-forge-text">Analysis is local.</span> After a game, open analysis to
              run Stockfish in your browser and see accuracy per move.
            </li>
          </ol>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/" className="btn btn-primary px-5 py-3">
            Find a game
          </Link>
          <Link to="/computer" className="btn btn-secondary px-5 py-3">
            Practise vs engine
          </Link>
        </div>
      </div>
    </div>
  );
}
