import fs from 'node:fs';
import path from 'node:path';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  isProduction: boolean;
  appOrigin: string;
  sessionSecret: string;
  databaseUrl: string;
  clientDevOrigin: string;
  /** Brevo transactional email. Unset disables verification/reset mail. */
  emailApiKey: string;
  emailFromAddress: string;
  emailFromName: string;
}

let cached: AppConfig | null = null;

/**
 * Resolves the listen port. Hosting platforms inject PORT, but some sandboxes
 * inject an empty or `0` value; only a positive port is meaningful here.
 */
function resolvePort(fallback: number): number {
  const raw = process.env.PORT;
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Loads `.env` (if present) then reads configuration from the environment. */
export function loadConfig(): AppConfig {
  if (cached) return cached;

  const envFile = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(envFile);
    } catch {
      // A malformed .env should not stop the process before logging is ready.
    }
  }

  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';
  const sessionSecret = process.env.SESSION_SECRET ?? '';
  const databaseUrl = process.env.DATABASE_URL ?? '';

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required. Copy .env.example to .env and fill it in.');
  }
  if (!sessionSecret && isProduction) {
    throw new Error('SESSION_SECRET is required in production.');
  }

  const port = resolvePort(3000);
  const appOrigin = process.env.APP_ORIGIN ?? `http://localhost:${port}`;

  cached = {
    port,
    nodeEnv,
    isProduction,
    appOrigin,
    sessionSecret: sessionSecret || 'insecure-development-secret-do-not-use-in-production',
    databaseUrl,
    clientDevOrigin: process.env.CLIENT_DEV_ORIGIN ?? 'http://localhost:5173',
    emailApiKey: process.env.EMAIL_API_KEY ?? '',
    emailFromAddress: process.env.EMAIL_FROM_ADDRESS ?? '',
    emailFromName: process.env.EMAIL_FROM_NAME ?? 'ChessForge',
  };
  return cached;
}

/**
 * Origin users should be sent back to (links in email, redirects).
 *
 * In development the SPA runs on Vite's port, so a `localhost:3000` link would
 * hit the API server and 404. In production both are the same origin.
 */
export function publicOrigin(): string {
  const config = loadConfig();
  return config.isProduction ? config.appOrigin : config.clientDevOrigin;
}
