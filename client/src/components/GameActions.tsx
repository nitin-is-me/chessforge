import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { GameSnapshot } from '@shared/protocol';
import { useGame } from '../store/game';
import { api, ApiError } from '../lib/api';

interface GameActionsProps {
  snapshot: GameSnapshot;
  myColor: 'w' | 'b' | null;
  onCopyPgn?: () => void;
  onCopyLink?: () => void;
  onFlip?: () => void;
  copiedLink?: boolean;
  copiedPgn?: boolean;
  /** `menu` renders the grouped phone menu used by the mobile More sheet. */
  variant?: 'full' | 'menu';
}

const GROUP = 'divide-y divide-forge-line-soft overflow-hidden rounded-xl border border-forge-line bg-forge-panel/70';
const SECTION_LABEL = 'px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-forge-faint';
const ROW =
  'flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[13px] font-medium text-forge-text transition-colors hover:bg-white/[0.04] active:bg-white/[0.06] disabled:opacity-40';

function MenuRow({
  onClick,
  disabled,
  tone = 'default',
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${ROW} ${tone === 'danger' ? 'text-[#e79a94]' : ''}`}
    >
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

export function GameActions({
  snapshot,
  myColor,
  onCopyPgn,
  onCopyLink,
  onFlip,
  copiedLink = false,
  copiedPgn = false,
  variant = 'full',
}: GameActionsProps) {
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
  const rematchFromOpponent = snapshot.rematch && Boolean(myColor) && snapshot.rematch.offerBy !== myColor;
  const rematchFromMe = snapshot.rematch && Boolean(myColor) && snapshot.rematch.offerBy === myColor;
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

  // Board-level controls live in the phone menu: flipping and sharing are
  // things a player wants while looking at the board, not hidden buttons.
  const boardGroup = (
    <section>
      <p className={SECTION_LABEL}>Board</p>
      <div className={GROUP}>
        {onFlip ? <MenuRow onClick={onFlip}>Flip board</MenuRow> : null}
        {onCopyLink ? (
          <MenuRow onClick={onCopyLink}>{copiedLink ? 'Link copied' : 'Share game link'}</MenuRow>
        ) : null}
        {onCopyPgn ? <MenuRow onClick={onCopyPgn}>{copiedPgn ? 'PGN copied' : 'Copy PGN'}</MenuRow> : null}
      </div>
    </section>
  );

  const claimRows = (
    <>
      {snapshot.canClaim.threefold ? (
        <MenuRow onClick={() => claim('threefold')}>Claim threefold repetition</MenuRow>
      ) : null}
      {snapshot.canClaim.fiftyMoves ? (
        <MenuRow onClick={() => claim('fifty-moves')}>Claim fifty-move rule</MenuRow>
      ) : null}
      {snapshot.canClaim.absence ? (
        <MenuRow onClick={() => claim('absence')}>Claim win — opponent left</MenuRow>
      ) : null}
    </>
  );

  if (menu) {
    if (finished) {
      return (
        <div className="space-y-3 pt-1">
          {boardGroup}
          <section>
            <p className={SECTION_LABEL}>Game</p>
            <div className={GROUP}>
              {/* Rematch and New game live on the dock; this menu only holds
                  secondary and destructive actions. */}
              <MenuRow tone="danger" onClick={() => setReportOpen(true)}>
                Report opponent
              </MenuRow>
            </div>
          </section>
          {reportDialog}
        </div>
      );
    }

    if (!isPlayer) {
      return (
        <div className="space-y-3 pt-1">
          {boardGroup}
          <p className="px-1 text-xs text-forge-muted">
            You are watching this game. Moves are applied live from the server.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-3 pt-1">
        {boardGroup}
        <section>
          <p className={SECTION_LABEL}>Game</p>
          <div className={GROUP}>
            {claimRows}
            {running && snapshot.abortable ? <MenuRow onClick={abort}>Abort game</MenuRow> : null}
            <MenuRow tone="danger" onClick={() => setReportOpen(true)}>
              Report opponent
            </MenuRow>
          </div>
        </section>
        {reportDialog}
      </div>
    );
  }

  if (finished) {
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
              {copiedPgn ? 'PGN copied' : 'Copy PGN'}
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
