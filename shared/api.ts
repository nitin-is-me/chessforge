/**
 * REST response shapes. Kept separate from the socket protocol so both sides
 * can import them without pulling runtime validation into the client bundle.
 */
import type {
  EndReason,
  GameResult,
  GameStatus,
  RatingSummary,
  UserProfile,
} from './protocol.js';
import type { TimeCategory } from './timeControl.js';

export interface MeResponse {
  user: UserProfile;
  serverNow: number;
  guest: boolean;
}

export interface GameListItem {
  id: string;
  category: TimeCategory;
  rated: boolean;
  status: GameStatus;
  result: GameResult | null;
  reason: EndReason | null;
  whiteName: string | null;
  blackName: string | null;
  whiteRating: number | null;
  blackRating: number | null;
  whiteRatingAfter: number | null;
  blackRatingAfter: number | null;
  createdAt: string;
  endedAt: string | null;
  plyCount: number;
  opponent: 'human' | 'computer';
  engineLevel: number | null;
  /** Present when the list is requested for a specific player. */
  playerColor?: 'white' | 'black' | null;
  outcome?: 'win' | 'loss' | 'draw' | null;
}

export interface ProfileResponse {
  user: UserProfile;
  games: GameListItem[];
  stats: { games: number; wins: number; losses: number; draws: number };
  online: boolean;
  friendState: 'none' | 'friends' | 'requested' | 'incoming' | 'blocked';
}

export interface GamesResponse {
  games: GameListItem[];
}

export interface RoomResponse {
  id: string;
}

export interface ErrorResponse {
  error: string;
  message: string;
}

export type { RatingSummary };
