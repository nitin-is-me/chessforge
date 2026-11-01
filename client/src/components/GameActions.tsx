import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { GameSnapshot } from '@shared/protocol';
import { useGame } from '../store/game';
import { api, ApiError } from '../lib/api';

interface GameActionsProps {
  snapshot: GameSnapshot;
  myColor: 'w' | 'b' | null;
  onCopyPgn?: () => void;
  /** `menu` renders only the secondary actions (used by the mobile More sheet). */
  variant?: 'full' | 'menu';
}

export function GameActions({ snapshot, myColor, onCopyPgn, variant = 'full' }: GameActionsProps) {
  const resign = useGame((state) => state.resign);
  const abort = useGame((state) => state.abort);
  const offerDraw = useGame((state) => state.offerDraw);
  const claim = useGame((state) => state.claim);
  const offerRematch = useGame((state) => state.offerRematch);
  const acceptRematch = useGame((state) => state.acceptRematch);

  const [confirmResign, setConfirmResign] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const handleReport = async (opponentName: string) => {
    setReportBusy(true);
    setReportError(null);
    try {
      await api.report(opponentName, reportReason, snapshot.id);
      setReportOpen(false);
      setReportReason('');
    } catch (err) {
      setReportError(err instanceof ApiError ? err.message : 'Could not submit report');
    } finally {
      setReportBusy(false);
    }
  };

  const isPlayer = Boolean(myColor);
  const running = snapshot.status === 'started';
  const finished = snapshot.status === 'finished' || snapshot.status === 'aborted';
  const menu = variant === 'menu';
  const offerFromOpponent = snapshot.drawOfferBy && snapshot.drawOfferBy !== myColor;
  const offerFromMe = snapshot.drawOfferBy && snapshot.drawOfferBy === myColor;
  const rematchFromOpponent = snapshot.rematch && snapshot.rematch.offerBy !== myColor;
  const rematchFromMe = snapshot.rematch && snapshot.rematch.offerBy === myColor;
  const opponentName =
    myColor === 'w' ? snapshot.black?.displayName : myColor === 'b' ? snapshot.white?.displayName : undefined;

  const reportButton = isPlayer ? (
    <button type="button" className="btn btn-ghost w-full" onClick={() => setReportOpen(true)}>
      Report opponent
    </button>
  ) : null;

  const reportDialog = reportOpen ? (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={() => setReportOpen(false)}
    >
      <div
        className="w-full max-w-md rounded-xl border border-forge-line bg-forge-panel-2 p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="font-display text-lg">Report opponent</h3>
        <p className="mt-2 text-sm text-forge-muted">
          Report {opponentName ?? 'your opponent'}. This will be reviewed by moderators.
        </p>
        <textarea
          className="field mt-3 !min-h-[100px]"
          placeholder="Describe the reason for this report (required)"
          value={reportReason}
          onChange={(event) => setReportReason(event.target.value)}
          maxLength={500}
        />
        {reportError ? <p className="mt-2 text-sm text-forge-danger">{reportError}</p> : null}
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn btn-secondary flex-1" onClick={() => setReportOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1"
            onClick={() =>
              handleReport(myColor === 'w' ? (snapshot.black?.username ?? '') : (snapshot.white?.username ?? ''))
            }
            disabled={reportBusy || !reportReason.trim()}
          >
            {reportBusy ? 'Sending…' : 'Submit report'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const claims =
    snapshot.canClaim.threefold || snapshot.canClaim.fiftyMoves || snapshot.canClaim.absence ? (
      <div className="rounded-xl border border-forge-line bg-forge-panel-2/80 p-3">
        <p className="mb-2 text-xs uppercase tracking-wider text-forge-muted">Available claims</p>
        <div className="flex flex-wrap gap-2">
          {snapshot.canClaim.threefold ? (
            <button type="button" className="btn btn-secondary" onClick={() => claim('threefold')}>
              Claim threefold
            </button>
          ) : null}
          {snapshot.canClaim.fiftyMoves ? (
            <button type="button" className="btn btn-secondary" onClick={() => claim('fifty-moves')}>
              Claim fifty moves
            </button>
          ) : null}
          {snapshot.canClaim.absence ? (
            <button type="button" className="btn btn-secondary" onClick={() => claim('absence')}>
              Claim win — opponent left
            </button>
          ) : null}
        </div>
      </div>
    ) : null;

  if (finished) {
    if (menu) {
      return (
        <div className="space-y-2">
          {isPlayer ? (
            rematchFromOpponent ? (
              <button type="button" className="btn btn-primary w-full" onClick={acceptRematch}>
                Accept rematch
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary w-full"
                onClick={offerRematch}
                disabled={Boolean(rematchFromMe)}
              >
                {rematchFromMe ? 'Rematch offered' : 'Offer rematch'}
              </button>
            )
          ) : null}
          <Link to="/" className="btn btn-secondary w-full">
            New game
          </Link>
          {onCopyPgn ? (
            <button type="button" className="btn btn-ghost w-full" onClick={onCopyPgn}>
              Copy PGN
            </button>
          ) : null}
          {reportButton}
          {reportDialog}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Link to={`/analysis/${snapshot.id}`} className="btn btn-primary flex-1">
            Analyse game
          </Link>
          {isPlayer ? (
            rematchFromOpponent ? (
              <button type="button" className="btn btn-secondary" onClick={acceptRematch}>
                Accept rematch
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={offerRematch}
                disabled={Boolean(rematchFromMe)}
              >
                {rematchFromMe ? 'Rematch offered' : 'Rematch'}
              </button>
            )
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/" className="btn btn-ghost flex-1">
            New game
          </Link>
          {onCopyPgn ? (
            <button type="button" className="btn btn-ghost" onClick={onCopyPgn}>
              Copy PGN
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!isPlayer) {
    return (
      <p className="text-center text-sm text-forge-muted">
        You are watching this game. Moves are applied live from the server.
      </p>
    );
  }

  if (menu) {
    return (
      <div className="space-y-2">
        {claims}
        {running && snapshot.abortable ? (
          <button type="button" className="btn btn-secondary w-full" onClick={abort}>
            Abort game
          </button>
        ) : null}
        {reportButton}
        {reportDialog}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {rematchFromOpponent ? (
        <div className="rounded-xl border border-forge-accent/30 bg-forge-accent/[0.07] p-3">
          <p className="mb-2 text-sm text-forge-text">Rematch?</p>
          <button type="button" className="btn btn-primary w-full" onClick={acceptRematch}>
            Play again with colours swapped
          </button>
        </div>
      ) : null}

      {claims}

      <div className="flex flex-wrap gap-2">
        {running && snapshot.abortable ? (
          <button type="button" className="btn btn-secondary flex-1" onClick={abort}>
            Abort
          </button>
        ) : null}
        {running ? (
          <button
            type="button"
            className="btn btn-secondary flex-1"
            onClick={offerDraw}
            disabled={Boolean(offerFromMe)}
          >
            {offerFromMe ? 'Draw offered' : 'Offer draw'}
          </button>
        ) : null}
        {running ? (
          confirmResign ? (
            <button type="button" className="btn btn-danger flex-1" onClick={resign}>
              Confirm resign
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-danger flex-1"
              onClick={() => {
                setConfirmResign(true);
                window.setTimeout(() => setConfirmResign(false), 4000);
              }}
            >
              Resign
            </button>
          )
        ) : null}
      </div>

      {reportButton}

      {reportDialog}
    </div>
  );
}
