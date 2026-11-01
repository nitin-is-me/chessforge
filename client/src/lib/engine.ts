/**
 * Stockfish 19 lite (single-threaded WASM) running in a Web Worker.
 *
 * The engine is served from /engine and speaks UCI over postMessage. No
 * cross-origin isolation headers are required because this build is
 * single-threaded.
 */
export interface EngineLine {
  depth: number;
  /** Score in centipawns from the side-to-move's perspective. */
  cp: number | null;
  mate: number | null;
  pv: string[];
}

const ENGINE_URL = '/engine/stockfish-19-lite-single.js';

type Listener = (line: string) => void;

export class Engine {
  private worker: Worker | null = null;
  private listeners = new Set<Listener>();
  private ready = false;
  private queue: Promise<unknown> = Promise.resolve();

  async init(): Promise<void> {
    if (this.ready && this.worker) return;
    this.worker = new Worker(ENGINE_URL);
    this.worker.onmessage = (event: MessageEvent) => {
      const data = event.data;
      const text = typeof data === 'string' ? data : String(data ?? '');
      for (const listener of this.listeners) listener(text);
    };
    this.worker.onerror = () => {
      this.ready = false;
    };
    await this.waitFor('uciok', () => this.send('uci'), 15_000);
    await this.waitFor('readyok', () => this.send('isready'), 15_000);
    this.send('setoption name Hash value 16');
    this.ready = true;
  }

  private send(command: string): void {
    this.worker?.postMessage(command);
  }

  private waitFor(token: string, trigger: () => void, timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`Engine did not respond with ${token}`));
      }, timeoutMs);

      const listener: Listener = (line) => {
        if (line.includes(token)) {
          window.clearTimeout(timer);
          this.listeners.delete(listener);
          resolve();
        }
      };

      this.listeners.add(listener);
      trigger();
    });
  }

  /** Runs a fixed-depth search and returns the final evaluation. */
  analyse(fen: string, depth: number, onProgress?: (line: EngineLine) => void): Promise<EngineLine> {
    const run = async (): Promise<EngineLine> => {
      await this.init();
      return new Promise<EngineLine>((resolve, reject) => {
        let last: EngineLine = { depth: 0, cp: null, mate: null, pv: [] };
        const timer = window.setTimeout(() => {
          cleanup();
          reject(new Error('Engine search timed out'));
        }, 30_000);

        const listener: Listener = (line) => {
          if (line.startsWith('info ') && line.includes(' pv ')) {
            const parsed = parseInfo(line, fen);
            if (parsed) {
              last = { ...parsed, pv: parsed.pv };
              onProgress?.(last);
            }
          }
          if (line.startsWith('bestmove')) {
            cleanup();
            resolve(last);
          }
        };

        const cleanup = () => {
          window.clearTimeout(timer);
          this.listeners.delete(listener);
          this.send('stop');
        };

        this.listeners.add(listener);
        this.send('position fen ' + fen);
        this.send(`go depth ${depth}`);
      });
    };

    // Serialise searches: one engine, one position at a time.
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Picks a move for the computer opponent at a given strength. */
  async bestMove(fen: string, level: number): Promise<string | null> {
    const depth = Math.max(1, Math.min(16, level));
    const skill = Math.max(0, Math.min(20, level * 2 - 1));
    await this.init();
    return new Promise<string | null>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('Engine move timed out'));
      }, 20_000);

      const listener: Listener = (line) => {
        if (line.startsWith('bestmove')) {
          const move = line.split(' ')[1];
          cleanup();
          resolve(move && move !== '(none)' ? move : null);
        }
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        this.listeners.delete(listener);
        this.send('stop');
      };

      this.listeners.add(listener);
      this.send(`setoption name Skill Level value ${skill}`);
      this.send('position fen ' + fen);
      this.send(`go depth ${depth}`);
    });
  }

  stop(): void {
    this.send('stop');
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.listeners.clear();
  }
}

function parseInfo(line: string, fen: string): EngineLine | null {
  const depthMatch = line.match(/ depth (\d+)/);
  if (!depthMatch) return null;

  const sideToMove = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const mateMatch = line.match(/ score mate (-?\d+)/);
  const cpMatch = line.match(/ score cp (-?\d+)/);
  const pvMatch = line.match(/ pv (.+)$/);

  let cp: number | null = null;
  let mate: number | null = null;
  if (mateMatch) {
    mate = Number.parseInt(mateMatch[1]!, 10);
  } else if (cpMatch) {
    cp = Number.parseInt(cpMatch[1]!, 10);
  } else {
    return null;
  }

  // UCI reports from the mover's point of view; normalise to white.
  if (sideToMove === 'b') {
    if (cp !== null) cp = -cp;
    if (mate !== null) mate = -mate;
  }

  return {
    depth: Number.parseInt(depthMatch[1]!, 10),
    cp,
    mate,
    pv: pvMatch ? pvMatch[1]!.trim().split(/\s+/) : [],
  };
}

export const engine = new Engine();
