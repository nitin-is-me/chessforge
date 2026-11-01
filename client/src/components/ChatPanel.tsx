import { useEffect, useRef, useState } from 'react';
import type { GameSnapshot } from '@shared/protocol';
import { useGame } from '../store/game';

const QUICK_MESSAGES = ['Good luck!', 'Nice move.', 'Good game.', 'Thanks for the game.'];

interface ChatPanelProps {
  snapshot: GameSnapshot;
  myColor: 'w' | 'b' | null;
  opponentName: string;
}

export function ChatPanel({ snapshot, myColor, opponentName }: ChatPanelProps) {
  const requestChat = useGame((state) => state.requestChat);
  const acceptChat = useGame((state) => state.acceptChat);
  const declineChat = useGame((state) => state.declineChat);
  const sendChat = useGame((state) => state.sendChat);
  const markChatRead = useGame((state) => state.markChatRead);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const state = snapshot.chat.state;

  useEffect(() => {
    markChatRead();
  }, [snapshot.chat.messages.length, markChatRead]);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [snapshot.chat.messages.length, state]);

  const submit = (value: string) => {
    const body = value.trim();
    if (!body) return;
    sendChat(body);
    setDraft('');
  };

  return (
    <div className="panel-flat overflow-hidden flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between border-b border-forge-line-soft px-3 py-2 flex-shrink-0">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-forge-muted">Chat</span>
        <span className="text-[11px] text-forge-faint">
          {state === 'open' ? 'open' : state === 'requested' ? 'requested' : 'consent required'}
        </span>
      </div>

      {state === 'none' || state === 'declined' ? (
        <div className="space-y-2 p-3">
          <p className="text-sm text-forge-muted">
            {state === 'declined'
              ? 'Chat was declined. You can still report abusive behaviour.'
              : `Chat stays off until your opponent agrees. You can ask ${opponentName || 'your opponent'} to open it.`}
          </p>
          {state === 'none' && myColor ? (
            <button type="button" className="btn btn-secondary w-full" onClick={requestChat}>
              Request chat
            </button>
          ) : null}
        </div>
      ) : null}

      {state === 'requested' ? (
        <div className="space-y-2 p-3">
          {myColor === null ? (
            <p className="text-xs text-forge-faint">
              A chat request is pending. Spectators cannot join the chat.
            </p>
          ) : snapshot.chat.requestedBy === myColor ? (
            <p className="text-sm text-forge-muted">
              Waiting for {opponentName || 'your opponent'} to respond.
            </p>
          ) : (
            <>
              <p className="text-sm text-forge-muted">
                {opponentName || 'Your opponent'} would like to open chat. Messages appear once you
                both agree.
              </p>
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary flex-1" onClick={acceptChat}>
                  Accept
                </button>
                <button type="button" className="btn btn-secondary flex-1" onClick={declineChat}>
                  Decline
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {state === 'open' ? (
        <div className="flex flex-1 min-h-0 flex-col">
          <div ref={listRef} className="flex-1 min-h-[90px] space-y-2 overflow-y-auto px-3 py-2">
            {snapshot.chat.messages.length === 0 ? (
              <p className="text-xs text-forge-faint">Say hello — keep it friendly.</p>
            ) : null}
            {snapshot.chat.messages.map((message) => {
              const mine = snapshot.white?.id === message.senderId;
              const isMine = myColor ? (myColor === 'w') === mine : false;
              return (
                <div key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-xl px-2.5 py-1.5 text-sm ${
                      isMine
                        ? 'bg-forge-accent/15 text-forge-text'
                        : 'bg-forge-panel-3 text-forge-text/90'
                    }`}
                  >
                    <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-forge-faint">
                      {message.senderName}
                    </span>
                    {message.body}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-forge-line-soft p-2 flex-shrink-0 bg-forge-panel-2/30">
            <div className="mb-1.5 flex gap-1 overflow-x-auto pb-0.5 scrollbar-none">
              {QUICK_MESSAGES.map((message) => (
                <button
                  key={message}
                  type="button"
                  onClick={() => submit(message)}
                  className="shrink-0 rounded-full border border-forge-line px-2 py-0.5 text-[11px] text-forge-muted transition-colors hover:border-forge-accent/40 hover:text-forge-accent whitespace-nowrap"
                >
                  {message}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                submit(draft);
              }}
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={300}
                placeholder="Message"
                className="field !py-1.5 !text-sm flex-1 min-w-0"
                aria-label="Chat message"
              />
              <button type="submit" className="btn btn-secondary !px-3 shrink-0" disabled={!draft.trim()}>
                Send
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
