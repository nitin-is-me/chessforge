/** Tracks which users are connected and what they are playing. */
export class PresenceService {
  private readonly sockets = new Map<string, Set<string>>();
  private readonly games = new Map<string, string>();

  add(userId: string, socketId: string): void {
    let set = this.sockets.get(userId);
    if (!set) {
      set = new Set();
      this.sockets.set(userId, set);
    }
    set.add(socketId);
  }

  /** Removes the socket; returns true when the user went offline. */
  remove(userId: string, socketId: string): boolean {
    const set = this.sockets.get(userId);
    if (!set) return false;
    set.delete(socketId);
    if (set.size === 0) {
      this.sockets.delete(userId);
      this.games.delete(userId);
      return true;
    }
    return false;
  }

  online(userId: string): boolean {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }

  setPlaying(userId: string, gameId: string | null): void {
    if (gameId) this.games.set(userId, gameId);
    else this.games.delete(userId);
  }

  playing(userId: string): boolean {
    return this.games.has(userId);
  }

  gameOf(userId: string): string | null {
    return this.games.get(userId) ?? null;
  }

  get onlineCount(): number {
    return this.sockets.size;
  }
}
