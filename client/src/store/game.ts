import { create } from 'zustand';
import type {
  ChatMessageView,
  ClaimKind,
  Color,
  EndReason,
  GameResult,
  GameSnapshot,
} from '@shared/protocol';
import { connectSocket, socket } from '../lib/socket';
import { playSound, type SoundName } from '../lib/sounds';
import { useSession } from './session';

interface EndedInfo {
  result: GameResult;
  reason: EndReason;
  ratings: GameSnapshot['ratings'];
  at: number;
}

interface GameState {
  gameId: string | null;
  snapshot: GameSnapshot | null;
  myColor: Color | null;
  offset: number;
  ended: EndedInfo | null;
  error: string | null;
  loading: boolean;
  missing: boolean;
  rematchGameId: string | null;
  chatUnread: number;
  lastEvent: { type: string; at: number } | null;
  /** Socket connectivity, so the page can say when moves are not being sent. */
  connected: boolean;

  join: (gameId: string) => Promise<void>;
  leave: () => void;
  move: (uci: string) => void;
  resign: () => void;
  abort: () => void;
  offerDraw: () => void;
  acceptDraw: () => void;
  declineDraw: () => void;
  claim: (kind: ClaimKind) => void;
  offerRematch: () => void;
  acceptRematch: () => void;
  requestChat: () => void;
  acceptChat: () => void;
  declineChat: () => void;
  sendChat: (body: string) => void;
  markChatRead: () => void;
  clearError: () => void;
  clearEnded: () => void;
}

const soundOffsets = new Map<number, number>();

function chooseSound(move: { san: string; uci: string }, check: boolean): SoundName {
  if (check) return 'check';
  if (move.san.includes('O-O')) return 'castle';
  if (move.san.includes('x')) return 'capture';
  return 'move';
}

export const useGame = create<GameState>((set, get) => {
  const syncClock = () => {
    for (let index = 0; index < 3; index += 1) {
      window.setTimeout(() => {
        const sentAt = Date.now();
        soundOffsets.set(sentAt, index);
        socket.emit('time:sync', { sentAt });
      }, index * 120);
    }
  };

  socket.on('time:sync', ({ sentAt, serverNow }) => {
    const now = Date.now();
    if (!soundOffsets.has(sentAt) && now - sentAt > 5000) return;
    soundOffsets.delete(sentAt);
    const offset = serverNow - (sentAt + (now - sentAt) / 2);
    set((state) => ({ offset: state.offset === 0 ? offset : state.offset * 0.6 + offset * 0.4 }));
  });

  socket.on('game:state', (snapshot) => {
    const previous = get().snapshot;
    if (previous && snapshot.id === previous.id && snapshot.ply > previous.ply) {
      const move = snapshot.moves[snapshot.moves.length - 1];
      if (move) playSound(chooseSound(move, Boolean(snapshot.check)));
    }
    if (previous?.id !== snapshot.id) {
      if (snapshot.status === 'started') playSound('start');
      soundOffsets.clear();
      syncClock();
    }

    const user = useSession.getState().user;
    let myColor: Color | null = null;
    if (user) {
      if (snapshot.white?.id === user.id) myColor = 'w';
      else if (snapshot.black?.id === user.id) myColor = 'b';
    }

    set({
      snapshot,
      myColor,
      loading: false,
      missing: false,
      gameId: snapshot.id,
    });
  });

  socket.on('game:move', (payload) => {
    const previous = get().snapshot;
    if (!previous || previous.id !== payload.id) return;
    if (payload.ply <= previous.ply) return;
    playSound(chooseSound(payload.move, payload.check !== null));
    const { move, ...rest } = payload;
    set({ snapshot: { ...rest, moves: [...previous.moves, move] } });
  });

  socket.on('game:ended', (payload) => {
    set({ ended: { result: payload.result, reason: payload.reason, ratings: payload.ratings, at: payload.serverNow } });
    set((state) => (state.snapshot ? { snapshot: { ...state.snapshot, result: payload.result, reason: payload.reason, ratings: payload.ratings } } : {}));
    playSound('end');
    void useSession.getState().refresh();
  });

  socket.on('game:event', (payload) => {
    set({ lastEvent: { type: payload.type, at: Date.now() } });
    if (payload.type === 'draw-offer' || payload.type === 'rematch-offer') playSound('notify');
  });

  socket.on('game:chat', (payload) => {
    if (payload.message) {
      // The room echoes our own messages back; those are never unread.
      const mine = useSession.getState().user?.id === payload.message.senderId;
      set((state) => {
        const snapshot = state.snapshot;
        if (!snapshot) return mine ? {} : { chatUnread: state.chatUnread + 1 };
        // Replace matching optimistic message or deduplicate
        const filtered = snapshot.chat.messages.filter((m) => {
          if (m.id.startsWith('optimistic-') && m.senderId === payload.message!.senderId && m.body === payload.message!.body) {
            return false;
          }
          return m.id !== payload.message!.id;
        });
        filtered.push(payload.message!);
        return {
          chatUnread: mine ? state.chatUnread : state.chatUnread + 1,
          snapshot: {
            ...snapshot,
            chat: {
              ...snapshot.chat,
              state: payload.state ?? snapshot.chat.state,
              messages: filtered,
            },
          },
        };
      });        playSound('chat');
      } else if (payload.state) {
      set((state) => {
        const snapshot = state.snapshot;
        if (!snapshot) return {};
        return {
          snapshot: {
            ...snapshot,
            chat: {
              ...snapshot.chat,
              state: payload.state,
            },
          },
        };
      });
      if (payload.state === 'requested') playSound('chat');
    }
  });

  socket.on('game:rematch-started', (payload) => {
    set({ rematchGameId: payload.gameId });
  });

  socket.on('game:error', (error) => {
    set({ error: error.message });
    playSound('illegal');
  });

  socket.on('connect', () => {
    set({ connected: true });
    // Only re-join on reconnect if we were already in an active game
    const { gameId, snapshot } = get();
    if (gameId && snapshot) {
      socket.emit('game:join', { gameId }, () => undefined);
    }
  });

  socket.on('disconnect', () => {
    set({ connected: false });
  });

  return {
    gameId: null,
    snapshot: null,
    myColor: null,
    offset: 0,
    ended: null,
    error: null,
    loading: false,
    missing: false,
    rematchGameId: null,
    chatUnread: 0,
    lastEvent: null,
    connected: socket.connected,

    async join(gameId) {
      const previous = get().gameId;
      if (previous && previous !== gameId) socket.emit('game:leave', { gameId: previous });
      if (get().gameId !== gameId) {
        set({ snapshot: null, ended: null, myColor: null, gameId, loading: true, missing: false, error: null });
      }
      try {
        await connectSocket();
      } catch {
        set({ loading: false, missing: true, error: 'Could not reach the game server' });
        return;
      }
      socket.emit('game:join', { gameId }, (result) => {
        if (!result.ok) {
          if (get().snapshot) return;
          set({ loading: false, missing: true, error: result.error?.message ?? 'Game not found' });
        }
      });
    },

    leave() {
      const gameId = get().gameId;
      if (gameId) socket.emit('game:leave', { gameId });
      set({ gameId: null, snapshot: null, ended: null, myColor: null, rematchGameId: null, chatUnread: 0 });
    },

    move(uci) {
      const { gameId, snapshot } = get();
      if (!gameId || !snapshot) return;
      socket.emit('game:move', { gameId, uci, ply: snapshot.ply });
    },

    resign() {
      const { gameId } = get();
      if (gameId) socket.emit('game:resign', { gameId });
    },
    abort() {
      const { gameId } = get();
      if (gameId) socket.emit('game:abort', { gameId });
    },
    offerDraw() {
      const { gameId } = get();
      if (gameId) socket.emit('game:draw-offer', { gameId });
    },
    acceptDraw() {
      const { gameId } = get();
      if (gameId) socket.emit('game:draw-accept', { gameId });
    },
    declineDraw() {
      const { gameId } = get();
      if (gameId) socket.emit('game:draw-decline', { gameId });
    },
    claim(kind) {
      const { gameId } = get();
      if (gameId) socket.emit('game:claim', { gameId, kind });
    },
    offerRematch() {
      const { gameId } = get();
      if (gameId) socket.emit('game:rematch', { gameId });
    },
    acceptRematch() {
      const { gameId } = get();
      if (gameId) socket.emit('game:rematch-accept', { gameId });
    },
    requestChat() {
      const { gameId } = get();
      if (gameId) socket.emit('game:chat-request', { gameId });
    },
    acceptChat() {
      const { gameId } = get();
      if (gameId) socket.emit('game:chat-accept', { gameId });
    },
    declineChat() {
      const { gameId } = get();
      if (gameId) socket.emit('game:chat-decline', { gameId });
    },
    sendChat(body) {
      const { gameId, snapshot, myColor } = get();
      if (!gameId || !snapshot) return;
      socket.emit('game:chat-send', { gameId, body });

      const user = useSession.getState().user;
      if (user && myColor) {
        const optimisticId = `optimistic-${Date.now()}`;
        const optimisticMsg: ChatMessageView = {
          id: optimisticId,
          senderId: user.id,
          senderName: user.displayName || user.username,
          body,
          at: Date.now(),
        };
        set({
          snapshot: {
            ...snapshot,
            chat: {
              ...snapshot.chat,
              messages: [...snapshot.chat.messages, optimisticMsg],
            },
          },
        });
      }
    },
    markChatRead() {
      set({ chatUnread: 0 });
    },
    clearError() {
      set({ error: null });
    },
    clearEnded() {
      set({ ended: null });
    },
  };
});

export type { ChatMessageView };
